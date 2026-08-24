# Coralogix CSV normalizer + web viewer

Normalizes Coralogix log exports and provides a local web UI to upload, filter, and export CSV data.

## Web viewer

```powershell
cd C:\Users\berna\coralogix-viewer
.\serve.ps1
```

Abra **http://localhost:8080** no browser.

- Upload do export **bruto** (coluna `Source`) ou CSV **normalizado**
- Filtros por bookmaker, mercado, tipo de log e busca livre
- Exportar linhas filtradas para CSV

## CLI normalizer (PowerShell)

```powershell
.\normalize_coralogix_export.ps1 `
  -InputPath "C:\Users\berna\Downloads\Export_19-08-2026.csv" `
  -OutputPath "C:\Users\berna\Downloads\Export_normalized.csv"

# Optional bookmaker filter
.\normalize_coralogix_export.ps1 `
  -InputPath "export.csv" `
  -Bookmaker "Novibet"
```

## CLI normalizer (Python)

```bash
pip install -r requirements.txt
python normalize_coralogix_export.py export.csv output.csv Novibet
```
## Output columns

`timestamp`, `log_type`, `application`, `msg_guid`, `fixture_id`, `market`, `market_id`, `line_type`, `line_parameter`, `bookmaker`, `home_team`, `away_team`, `competition`, `country`, `start_time`, `odds_json`, `odd_1`, `odd_x`, `odd_2`, `odd_under`, `odd_over`, `odd_yes`, `odd_no`, `odd_1x`, `odd_12`, `odd_x2`

## Supported log types

- **replicator** — `LSport.RabbitMQReplicator` (RabbitMQ / LSports native format)
- **scanner** — `Scanners.LSports.Push.Prematch.EKS` (WCF / Sportifier format)
