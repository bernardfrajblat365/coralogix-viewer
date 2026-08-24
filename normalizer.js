/** @typedef {Record<string, string | null>} NormalizedRow */

const OPTION_PAIRS = [
  ["1", "Option1"],
  ["X", "OptionX"],
  ["2", "Option2"],
  ["Under", "OptionUnder"],
  ["Over", "OptionOver"],
  ["1X", "Option1X"],
  ["12", "Option12"],
  ["X2", "OptionX2"],
  ["Yes", "OptionYes"],
  ["No", "OptionNo"],
];

const YES_NO_MARKET_PATTERN =
  /to score|both teams|btts|clean sheet|win to nil|to win to nil|score first|score 1st|score 2nd|penalty|send off|red card|extra time|own goal/i;

export const DISPLAY_COLUMNS = [
  { key: "timestamp", label: "Hora", className: "col-time", hint: "Timestamp", weight: 4 },
  { key: "log_type", label: "Tipo", className: "col-type", weight: 3 },
  { key: "market", label: "Mercado", className: "col-market", weight: 22 },
  { key: "bookmaker", label: "Book", className: "col-book", hint: "Bookmaker", weight: 6 },
  { key: "matchup", label: "Jogo", className: "col-matchup", hint: "Casa vs Fora", virtual: true, weight: 14 },
  { key: "competition", label: "Comp", className: "col-comp", hint: "Competição", weight: 8 },
  { key: "fixture_id", label: "Fixture", className: "col-fixture", hint: "Fixture ID", weight: 7 },
  { key: "odd_1", label: "1", className: "col-odd", weight: 4.5 },
  { key: "odd_x", label: "X", className: "col-odd", weight: 4.5 },
  { key: "odd_2", label: "2", className: "col-odd", weight: 4.5 },
  { key: "odd_under", label: "U", className: "col-odd", hint: "Under", weight: 4.5 },
  { key: "odd_over", label: "O", className: "col-odd", hint: "Over", weight: 4.5 },
  { key: "odd_yes", label: "S", className: "col-odd", hint: "Sim", weight: 4.5 },
  { key: "odd_no", label: "N", className: "col-odd", hint: "Não", weight: 4.5 },
  { key: "line_parameter", label: "Linha", className: "col-line", hint: "Handicap / linha", weight: 5 },
  { key: "msg_guid", label: "Guid", className: "col-guid", hint: "MsgGuid", weight: 9 },
];

/** @type {Set<string>} */
export const ALWAYS_VISIBLE_COLUMNS = new Set([
  "timestamp",
  "log_type",
  "market",
  "bookmaker",
  "fixture_id",
  "msg_guid",
]);

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseJsonMaybe(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  const text = String(value).trim();
  if (!text) return null;
  return JSON.parse(text);
}

function detectLogType(serilog) {
  const template = String(serilog.MessageTemplate || "");
  if (template.includes("received message from LS")) return "replicator";
  if (template.includes("sent {updateType}")) return "scanner";
  const app = String(serilog.Properties?.Application || "");
  if (app.includes("RabbitMQReplicator")) return "replicator";
  if (app.includes("Push.Prematch") || app.includes("Push.Live")) return "scanner";
  return "unknown";
}

function extractTagField(tag, field) {
  if (!tag) return null;
  const match = tag.match(new RegExp(`${field}:([^;]+)`));
  return match ? match[1].trim() : null;
}

function betName(bet) {
  const name = bet?.Name;
  if (typeof name === "string") return name.trim();
  if (name && typeof name === "object" && name.m_Value != null) return String(name.m_Value).trim();
  return null;
}

function normalizeYesNoKeys(odds) {
  /** @type {Record<string, number>} */
  const out = { ...odds };
  const yesAliases = ["Yes", "YES", "Sim", "SIM", "Y"];
  const noAliases = ["No", "NO", "Nao", "Não", "NAO", "N"];

  for (const alias of yesAliases) {
    if (out[alias] != null && out.Yes == null) out.Yes = out[alias];
  }
  for (const alias of noAliases) {
    if (out[alias] != null && out.No == null) out.No = out[alias];
  }
  return out;
}

function isYesNoMarket(marketName) {
  return Boolean(marketName && YES_NO_MARKET_PATTERN.test(String(marketName)));
}

function betsToDict(bets) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const bet of asArray(bets)) {
    const name = betName(bet);
    const price = bet?.Price ?? bet?.Rate;
    if (!name || price == null) continue;
    out[name] = Number(price);
  }
  return normalizeYesNoKeys(out);
}

function optionsArrayToDict(options) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const option of asArray(options)) {
    const name = betName(option);
    const price = option?.Rate ?? option?.Price;
    if (!name || price == null) continue;
    out[name] = Number(price);
  }
  return out;
}

function scannerOddsToDict(line, marketName) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [betName, optionKey] of OPTION_PAIRS) {
    const rate = line?.[optionKey]?.Rate;
    if (rate != null) out[betName] = Number(rate);
  }

  Object.assign(out, optionsArrayToDict(line?.m_Options));

  const normalized = normalizeYesNoKeys(out);
  if (
    normalized.Yes == null &&
    normalized.No == null &&
    isYesNoMarket(marketName) &&
    line?.Option1?.Rate != null &&
    line?.Option2?.Rate != null &&
    line?.OptionX?.Rate == null
  ) {
    normalized.Yes = Number(line.Option1.Rate);
    normalized.No = Number(line.Option2.Rate);
  }

  return normalized;
}

function formatDecimal(value) {
  if (value == null || value === "") return null;
  return Number(value).toString();
}

/** @param {Record<string, unknown>} fields @returns {NormalizedRow} */
function newRow(fields) {
  /** @type {NormalizedRow} */
  const row = {
    timestamp: null,
    log_type: null,
    application: null,
    msg_guid: null,
    fixture_id: null,
    market: null,
    market_id: null,
    line_type: null,
    line_parameter: null,
    bookmaker: null,
    home_team: null,
    away_team: null,
    competition: null,
    country: null,
    start_time: null,
    odds_json: null,
    odd_1: null,
    odd_x: null,
    odd_2: null,
    odd_under: null,
    odd_over: null,
    odd_1x: null,
    odd_12: null,
    odd_x2: null,
    odd_yes: null,
    odd_no: null,
  };
  return { ...row, ...fields };
}

function oddsColumns(odds) {
  return {
    odds_json: JSON.stringify(odds),
    odd_1: formatDecimal(odds["1"]),
    odd_x: formatDecimal(odds["X"]),
    odd_2: formatDecimal(odds["2"]),
    odd_under: formatDecimal(odds["Under"]),
    odd_over: formatDecimal(odds["Over"]),
    odd_1x: formatDecimal(odds["1X"]),
    odd_12: formatDecimal(odds["12"]),
    odd_x2: formatDecimal(odds["X2"]),
    odd_yes: formatDecimal(odds.Yes),
    odd_no: formatDecimal(odds.No),
  };
}

function parseReplicatorRow(serilog, csvTimestamp) {
  /** @type {NormalizedRow[]} */
  const rows = [];
  const props = serilog.Properties || {};
  const msg = parseJsonMaybe(props.MSG);
  if (!msg) return rows;

  const msgGuid = msg.Header?.MsgGuid;
  for (const event of asArray(msg.Body?.Events)) {
    const fixtureId = event.FixtureId;
    for (const market of asArray(event.Markets)) {
      for (const provider of asArray(market.ProviderMarkets)) {
        const odds = betsToDict(provider.Bets);
        rows.push(
          newRow({
            timestamp: csvTimestamp || serilog.Timestamp || null,
            log_type: "replicator",
            application: props.Application != null ? String(props.Application) : null,
            msg_guid: msgGuid != null ? String(msgGuid) : null,
            fixture_id: fixtureId != null ? String(fixtureId) : null,
            market: market.Name != null ? String(market.Name) : null,
            market_id: market.Id != null ? String(market.Id) : null,
            line_parameter: market.MainLine != null ? String(market.MainLine) : null,
            bookmaker: provider.Name != null ? String(provider.Name) : null,
            ...oddsColumns(odds),
          }),
        );
      }
    }
  }
  return rows;
}

function parseScannerRow(serilog, csvTimestamp) {
  /** @type {NormalizedRow[]} */
  const rows = [];
  const props = serilog.Properties || {};
  const payload = parseJsonMaybe(props.object);
  if (!payload) return rows;

  const game = payload.Game || {};
  const competitors = asArray(game.m_Competitors);
  const homeTeam =
    competitors[0]?.Name?.m_Value != null ? String(competitors[0].Name.m_Value) : null;
  const awayTeam =
    competitors[1]?.Name?.m_Value != null ? String(competitors[1].Name.m_Value) : null;

  let fixtureId = null;
  for (const partnerGame of asArray(game.m_PartnerGames)) {
    if (partnerGame?.GameID) {
      fixtureId = String(partnerGame.GameID);
      break;
    }
  }

  const msgGuid = String(props.MsgGuid || "").trim();

  for (const line of asArray(payload.m_Lines)) {
    const tag = String(line.Tag || "");
    const odds = scannerOddsToDict(line, extractTagField(tag, "Name"));
    rows.push(
      newRow({
        timestamp: csvTimestamp || serilog.Timestamp || null,
        log_type: "scanner",
        application: props.Application != null ? String(props.Application) : null,
        msg_guid: msgGuid || extractTagField(tag, "MsgGuid"),
        fixture_id: fixtureId,
        market: extractTagField(tag, "Name"),
        market_id: extractTagField(tag, "Id"),
        line_type: line.LineType != null ? String(line.LineType) : null,
        line_parameter: line.Parameter != null ? String(line.Parameter) : null,
        bookmaker: line.Bookmaker?.m_Value != null ? String(line.Bookmaker.m_Value) : null,
        home_team: homeTeam,
        away_team: awayTeam,
        competition: game.Competition?.m_Value != null ? String(game.Competition.m_Value) : null,
        country: game.Country?.m_Value != null ? String(game.Country.m_Value) : null,
        start_time: game.StartTime != null ? String(game.StartTime) : null,
        ...oddsColumns(odds),
      }),
    );
  }
  return rows;
}

/**
 * @param {Record<string, string>[]} csvRows
 * @returns {{ rows: NormalizedRow[], errors: string[] }}
 */
export function normalizeCoralogixRows(csvRows) {
  /** @type {NormalizedRow[]} */
  const rows = [];
  /** @type {string[]} */
  const errors = [];

  csvRows.forEach((row, index) => {
    try {
      const serilog = parseJsonMaybe(row.Source);
      if (!serilog) {
        errors.push(`Linha ${index + 1}: Source JSON inválido`);
        return;
      }

      const logType = detectLogType(serilog);
      let parsed = [];
      if (logType === "replicator") parsed = parseReplicatorRow(serilog, row.Timestamp);
      else if (logType === "scanner") parsed = parseScannerRow(serilog, row.Timestamp);
      else {
        errors.push(`Linha ${index + 1}: tipo de log desconhecido`);
        return;
      }

      if (!parsed.length) {
        errors.push(`Linha ${index + 1}: nenhum dado extraído`);
        return;
      }

      rows.push(...parsed);
    } catch (error) {
      errors.push(`Linha ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return { rows, errors };
}

/**
 * @param {Record<string, string>[]} csvRows
 * @returns {NormalizedRow[]}
 */
export function loadNormalizedRows(csvRows) {
  return csvRows.map((row) => {
    /** @type {NormalizedRow} */
    const normalized = newRow({});
    for (const key of Object.keys(normalized)) {
      normalized[key] = row[key] != null && row[key] !== "" ? String(row[key]) : null;
    }
    return normalized;
  });
}

export function isRawCoralogixExport(csvRows) {
  if (!csvRows.length) return false;
  const first = csvRows[0];
  return "Source" in first && !("market" in first);
}

export function isNormalizedExport(csvRows) {
  if (!csvRows.length) return false;
  const first = csvRows[0];
  return "market" in first && "bookmaker" in first;
}
