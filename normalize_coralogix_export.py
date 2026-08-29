#!/usr/bin/env python3
"""Normalize Coralogix CSV exports (Source column) into fixed tabular columns."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd


def parse_json_maybe(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        return json.loads(value)
    return None


def unwrap_serilog(value):
    """Peel Coralogix/OTel wrappers (`text`, `logRecord.body`) until Serilog fields appear."""
    current = parse_json_maybe(value)
    for _ in range(5):
        if not isinstance(current, dict):
            return None
        if current.get("MessageTemplate") is not None or current.get("Properties") is not None:
            return current
        if current.get("text") is not None:
            current = parse_json_maybe(current["text"])
            continue
        body = (current.get("logRecord") or {}).get("body")
        if body is not None:
            current = parse_json_maybe(body)
            continue
        break
    return current if isinstance(current, dict) else None


def detect_log_type(serilog: dict) -> str:
    template = serilog.get("MessageTemplate", "")
    if "received message from LS" in template:
        return "replicator"
    if "sent {updateType}" in template:
        return "scanner"
    app = serilog.get("Properties", {}).get("Application", "")
    if "RabbitMQReplicator" in app:
        return "replicator"
    if "Push.Prematch" in app or "Push.Live" in app:
        return "scanner"
    return "unknown"


def extract_tag_field(tag: str, field: str) -> str | None:
    if not tag:
        return None
    match = re.search(rf"{re.escape(field)}:([^;]+)", tag)
    return match.group(1).strip() if match else None


YES_NO_MARKET_PATTERN = re.compile(
    r"to score|both teams|btts|clean sheet|win to nil|to win to nil|score first|score 1st|score 2nd|penalty|send off|red card|extra time|own goal",
    re.IGNORECASE,
)


def bet_name(bet: dict) -> str | None:
    name = bet.get("Name")
    if isinstance(name, str):
        return name.strip() or None
    if isinstance(name, dict) and name.get("m_Value") is not None:
        return str(name["m_Value"]).strip() or None
    return None


def normalize_yes_no_keys(odds: dict[str, float]) -> dict[str, float]:
    out = dict(odds)
    for alias in ("Yes", "YES", "Sim", "SIM", "Y"):
        if alias in out and "Yes" not in out:
            out["Yes"] = out[alias]
    for alias in ("No", "NO", "Nao", "Não", "NAO", "N"):
        if alias in out and "No" not in out:
            out["No"] = out[alias]
    return out


def is_yes_no_market(market_name: str | None) -> bool:
    return bool(market_name and YES_NO_MARKET_PATTERN.search(str(market_name)))


def bets_to_dict(bets: list) -> dict[str, float]:
    out: dict[str, float] = {}
    for bet in bets or []:
        name = bet_name(bet)
        price = bet.get("Price") if bet.get("Price") is not None else bet.get("Rate")
        if name is None or price is None:
            continue
        out[name] = float(price)
    return normalize_yes_no_keys(out)


def options_array_to_dict(options: list) -> dict[str, float]:
    out: dict[str, float] = {}
    for option in options or []:
        name = bet_name(option)
        price = option.get("Rate") if option.get("Rate") is not None else option.get("Price")
        if name is None or price is None:
            continue
        out[name] = float(price)
    return out


def scanner_odds_to_dict(line: dict, market_name: str | None = None) -> dict[str, float]:
    pairs = [
        ("1", "Option1"),
        ("X", "OptionX"),
        ("2", "Option2"),
        ("Under", "OptionUnder"),
        ("Over", "OptionOver"),
        ("1X", "Option1X"),
        ("12", "Option12"),
        ("X2", "OptionX2"),
        ("Yes", "OptionYes"),
        ("No", "OptionNo"),
    ]
    out: dict[str, float] = {}
    for bet_name, option_key in pairs:
        option = line.get(option_key) or {}
        rate = option.get("Rate")
        if rate is not None:
            out[bet_name] = float(rate)

    out.update(options_array_to_dict(line.get("m_Options", [])))
    out = normalize_yes_no_keys(out)

    option_x = (line.get("OptionX") or {}).get("Rate")
    option_1 = (line.get("Option1") or {}).get("Rate")
    option_2 = (line.get("Option2") or {}).get("Rate")
    if (
        "Yes" not in out
        and "No" not in out
        and is_yes_no_market(market_name)
        and option_1 is not None
        and option_2 is not None
        and option_x is None
    ):
        out["Yes"] = float(option_1)
        out["No"] = float(option_2)

    return out


def odds_columns(odds: dict[str, float]) -> dict:
    return {
        "odds_json": json.dumps(odds, ensure_ascii=False),
        "odd_1": odds.get("1"),
        "odd_x": odds.get("X"),
        "odd_2": odds.get("2"),
        "odd_under": odds.get("Under"),
        "odd_over": odds.get("Over"),
        "odd_1x": odds.get("1X"),
        "odd_12": odds.get("12"),
        "odd_x2": odds.get("X2"),
        "odd_yes": odds.get("Yes"),
        "odd_no": odds.get("No"),
    }


def empty_row() -> dict:
    return {
        "timestamp": None,
        "log_type": None,
        "application": None,
        "msg_guid": None,
        "fixture_id": None,
        "market": None,
        "market_id": None,
        "line_type": None,
        "line_parameter": None,
        "bookmaker": None,
        "home_team": None,
        "away_team": None,
        "competition": None,
        "country": None,
        "start_time": None,
        "odds_json": None,
        "odd_1": None,
        "odd_x": None,
        "odd_2": None,
        "odd_under": None,
        "odd_over": None,
        "odd_1x": None,
        "odd_12": None,
        "odd_x2": None,
        "odd_yes": None,
        "odd_no": None,
    }


def build_row(**kwargs) -> dict:
    row = empty_row()
    row.update(kwargs)
    return row


def parse_replicator_row(serilog: dict, csv_timestamp: str) -> list[dict]:
    props = serilog.get("Properties", {})
    msg = parse_json_maybe(props.get("MSG"))
    if not msg:
        return []

    rows: list[dict] = []
    header = msg.get("Header", {})
    msg_guid = header.get("MsgGuid")

    for event in msg.get("Body", {}).get("Events", []):
        fixture_id = event.get("FixtureId")

        for market in event.get("Markets", []):
            market_name = market.get("Name")
            market_id = market.get("Id")
            main_line = market.get("MainLine")
            odds = bets_to_dict(market.get("Bets"))

            for provider in market.get("ProviderMarkets", []):
                provider_odds = bets_to_dict(provider.get("Bets"))
                rows.append(
                    build_row(
                        timestamp=csv_timestamp or serilog.get("Timestamp"),
                        log_type="replicator",
                        application=props.get("Application"),
                        msg_guid=msg_guid,
                        fixture_id=fixture_id,
                        market=market_name,
                        market_id=market_id,
                        line_type=None,
                        line_parameter=main_line,
                        bookmaker=provider.get("Name"),
                        **odds_columns(provider_odds),
                    )
                )

            if not market.get("ProviderMarkets"):
                rows.append(
                    build_row(
                        timestamp=csv_timestamp or serilog.get("Timestamp"),
                        log_type="replicator",
                        application=props.get("Application"),
                        msg_guid=msg_guid,
                        fixture_id=fixture_id,
                        market=market_name,
                        market_id=market_id,
                        line_type=None,
                        line_parameter=main_line,
                        bookmaker=None,
                        **odds_columns(odds),
                    )
                )

    return rows


def parse_scanner_row(serilog: dict, csv_timestamp: str) -> list[dict]:
    props = serilog.get("Properties", {})
    payload = parse_json_maybe(props.get("object"))
    if not payload:
        return []

    game = payload.get("Game", {})
    competitors = game.get("m_Competitors", [])
    home = competitors[0].get("Name", {}).get("m_Value") if len(competitors) > 0 else None
    away = competitors[1].get("Name", {}).get("m_Value") if len(competitors) > 1 else None

    partner_games = game.get("m_PartnerGames", [])
    fixture_id = partner_games[0].get("GameID") if partner_games else None

    rows: list[dict] = []
    msg_guid = (props.get("MsgGuid") or "").strip()

    for line in payload.get("m_Lines", []):
        tag = line.get("Tag", "")
        bookmaker = line.get("Bookmaker", {}).get("m_Value")
        market_name = extract_tag_field(tag, "Name")
        market_id = extract_tag_field(tag, "Id")
        odds = scanner_odds_to_dict(line, market_name)

        rows.append(
            build_row(
                timestamp=csv_timestamp or serilog.get("Timestamp"),
                log_type="scanner",
                application=props.get("Application"),
                msg_guid=msg_guid or extract_tag_field(tag, "MsgGuid"),
                fixture_id=fixture_id,
                market=market_name,
                market_id=market_id,
                line_type=line.get("LineType"),
                line_parameter=line.get("Parameter") or None,
                bookmaker=bookmaker,
                home_team=home,
                away_team=away,
                competition=game.get("Competition", {}).get("m_Value"),
                country=game.get("Country", {}).get("m_Value"),
                start_time=game.get("StartTime"),
                **odds_columns(odds),
            )
        )

    return rows


def normalize_csv(
    input_path: Path,
    output_path: Path | None = None,
    bookmaker: str | None = None,
) -> pd.DataFrame:
    df = pd.read_csv(input_path)
    if "Source" not in df.columns:
        raise ValueError("CSV must contain a 'Source' column")

    all_rows: list[dict] = []
    errors: list[dict] = []

    for idx, row in df.iterrows():
        try:
            serilog = unwrap_serilog(row["Source"])
            if not serilog:
                errors.append({"row": idx, "error": "empty or invalid Source JSON"})
                continue

            log_type = detect_log_type(serilog)
            ts = row.get("Timestamp")

            if log_type == "replicator":
                parsed = parse_replicator_row(serilog, ts)
            elif log_type == "scanner":
                parsed = parse_scanner_row(serilog, ts)
            else:
                errors.append({"row": idx, "error": "unknown log type"})
                continue

            if not parsed:
                errors.append({"row": idx, "error": "no rows extracted"})
                continue

            all_rows.extend(parsed)
        except Exception as exc:
            errors.append({"row": idx, "error": str(exc)})

    out = pd.DataFrame(all_rows)

    if bookmaker and not out.empty:
        out = out[out["bookmaker"].str.lower() == bookmaker.lower()]

    if output_path is None:
        output_path = input_path.with_name(input_path.stem + "_normalized.csv")

    out.to_csv(output_path, index=False, encoding="utf-8-sig")

    print(f"Input rows: {len(df)}")
    print(f"Normalized rows: {len(out)}")
    print(f"Output: {output_path}")
    if errors:
        print(f"Errors: {len(errors)}")
        for err in errors[:10]:
            print(f"  - row {err['row']}: {err['error']}")

    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Coralogix CSV export path")
    parser.add_argument("output", nargs="?", type=Path, help="Output CSV path")
    parser.add_argument("bookmaker", nargs="?", help="Optional bookmaker filter")
    args = parser.parse_args(argv)

    normalize_csv(args.input, args.output, bookmaker=args.bookmaker)
    return 0


if __name__ == "__main__":
    sys.exit(main())
