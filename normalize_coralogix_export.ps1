param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [string]$OutputPath,
    [string]$Bookmaker
)

$ErrorActionPreference = "Stop"

function Get-Prop {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

function Get-Array {
    param($Value)
    if ($null -eq $Value) { return @() }
    return @($Value)
}

function Parse-JsonMaybe {
    param([object]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [hashtable] -or $Value -is [System.Collections.IDictionary]) { return $Value }
    if ($Value -is [pscustomobject]) { return $Value }
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    return ($text | ConvertFrom-Json)
}

function Unwrap-Serilog {
    param([object]$Value)
    $current = Parse-JsonMaybe $Value
    for ($depth = 0; $depth -lt 5; $depth++) {
        if ($null -eq $current) { return $null }
        $hasTemplate = $null -ne (Get-Member -InputObject $current -Name MessageTemplate -ErrorAction SilentlyContinue)
        $hasProps = $null -ne (Get-Member -InputObject $current -Name Properties -ErrorAction SilentlyContinue)
        if ($hasTemplate -or $hasProps) { return $current }
        if ($null -ne (Get-Member -InputObject $current -Name text -ErrorAction SilentlyContinue) -and $null -ne $current.text) {
            $current = Parse-JsonMaybe $current.text
            continue
        }
        $logRecord = $null
        if ($null -ne (Get-Member -InputObject $current -Name logRecord -ErrorAction SilentlyContinue)) {
            $logRecord = $current.logRecord
        }
        if ($null -ne $logRecord -and $null -ne (Get-Member -InputObject $logRecord -Name body -ErrorAction SilentlyContinue) -and $null -ne $logRecord.body) {
            $current = Parse-JsonMaybe $logRecord.body
            continue
        }
        break
    }
    return $current
}

function Detect-LogType {
    param($Serilog)
    $template = [string]$Serilog.MessageTemplate
    if ($template -like "*received message from LS*") { return "replicator" }
    if ($template -like "*sent {updateType}*") { return "scanner" }
    $app = [string]$Serilog.Properties.Application
    if ($app -like "*RabbitMQReplicator*") { return "replicator" }
    if ($app -like "*Push.Prematch*" -or $app -like "*Push.Live*") { return "scanner" }
    return "unknown"
}

function Extract-TagField {
    param([string]$Tag, [string]$Field)
    if ([string]::IsNullOrWhiteSpace($Tag)) { return $null }
    $pattern = [regex]::Escape($Field) + ":([^;]+)"
    $match = [regex]::Match($Tag, $pattern)
    if ($match.Success) { return $match.Groups[1].Value.Trim() }
    return $null
}

function Get-BetName {
    param($Bet)
    $name = Get-Prop $Bet "Name"
    if ($name -is [string]) { return $name.Trim() }
    $value = Get-Prop $name "m_Value"
    if ($null -ne $value) { return [string]$value.Trim() }
    return $null
}

function Test-YesNoMarket {
    param([string]$MarketName)
    if ([string]::IsNullOrWhiteSpace($MarketName)) { return $false }
    return $MarketName -match 'to score|both teams|btts|clean sheet|win to nil|to win to nil|score first|score 1st|score 2nd|penalty|send off|red card|extra time|own goal'
}

function Normalize-YesNoKeys {
    param([hashtable]$Odds)
    $yesAliases = @('Yes', 'YES', 'Sim', 'SIM', 'Y')
    $noAliases = @('No', 'NO', 'Nao', 'Não', 'NAO', 'N')
    foreach ($alias in $yesAliases) {
        if ($Odds.ContainsKey($alias) -and -not $Odds.ContainsKey('Yes')) {
            $Odds['Yes'] = $Odds[$alias]
        }
    }
    foreach ($alias in $noAliases) {
        if ($Odds.ContainsKey($alias) -and -not $Odds.ContainsKey('No')) {
            $Odds['No'] = $Odds[$alias]
        }
    }
    return $Odds
}

function Bets-ToDict {
    param($Bets)
    $out = @{}
    if ($null -eq $Bets) { return $out }
    foreach ($bet in Get-Array $Bets) {
        $name = Get-BetName $bet
        $price = Get-Prop $bet "Price"
        if ($null -eq $price) { $price = Get-Prop $bet "Rate" }
        if ([string]::IsNullOrWhiteSpace($name) -or $null -eq $price) { continue }
        $out[$name] = [double]$price
    }
    return Normalize-YesNoKeys $out
}

function Options-ArrayToDict {
    param($Options)
    $out = @{}
    foreach ($option in Get-Array $Options) {
        $name = Get-BetName $option
        $price = Get-Prop $option "Rate"
        if ($null -eq $price) { $price = Get-Prop $option "Price" }
        if ([string]::IsNullOrWhiteSpace($name) -or $null -eq $price) { continue }
        $out[$name] = [double]$price
    }
    return $out
}

function Get-OptionRate {
    param($Line, [string]$OptionName)
    $option = Get-Prop $Line $OptionName
    return Get-Prop $option "Rate"
}

function Scanner-OddsToDict {
    param($Line, [string]$MarketName)
    $out = @{}
    $pairs = @(
        @("1", "Option1"),
        @("X", "OptionX"),
        @("2", "Option2"),
        @("Under", "OptionUnder"),
        @("Over", "OptionOver"),
        @("1X", "Option1X"),
        @("12", "Option12"),
        @("X2", "OptionX2"),
        @("Yes", "OptionYes"),
        @("No", "OptionNo")
    )
    foreach ($pair in $pairs) {
        $rate = Get-OptionRate $Line $pair[1]
        if ($null -ne $rate) {
            $out[$pair[0]] = [double]$rate
        }
    }

    foreach ($entry in (Options-ArrayToDict (Get-Prop $Line "m_Options")).GetEnumerator()) {
        $out[$entry.Key] = $entry.Value
    }

    $out = Normalize-YesNoKeys $out

    $optionXRate = Get-OptionRate $Line "OptionX"
    if (-not $out.ContainsKey('Yes') -and -not $out.ContainsKey('No') -and (Test-YesNoMarket $MarketName)) {
        $option1Rate = Get-OptionRate $Line "Option1"
        $option2Rate = Get-OptionRate $Line "Option2"
        if ($null -ne $option1Rate -and $null -ne $option2Rate -and $null -eq $optionXRate) {
            $out['Yes'] = [double]$option1Rate
            $out['No'] = [double]$option2Rate
        }
    }

    return $out
}

function Build-OddsColumns {
    param([hashtable]$Odds)
    return @{
        odds_json  = ($Odds | ConvertTo-Json -Compress)
        odd_1      = Format-Decimal $Odds["1"]
        odd_x      = Format-Decimal $Odds["X"]
        odd_2      = Format-Decimal $Odds["2"]
        odd_under  = Format-Decimal $Odds["Under"]
        odd_over   = Format-Decimal $Odds["Over"]
        odd_1x     = Format-Decimal $Odds["1X"]
        odd_12     = Format-Decimal $Odds["12"]
        odd_x2     = Format-Decimal $Odds["X2"]
        odd_yes    = Format-Decimal $Odds["Yes"]
        odd_no     = Format-Decimal $Odds["No"]
    }
}

function Format-Decimal {
    param($Value)
    if ($null -eq $Value -or [string]$Value -eq "") { return $null }
    return ([double]$Value).ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

function New-Row {
    param([hashtable]$Fields)
    $row = [ordered]@{
        timestamp       = $null
        log_type        = $null
        application     = $null
        msg_guid        = $null
        fixture_id      = $null
        market          = $null
        market_id       = $null
        line_type       = $null
        line_parameter  = $null
        bookmaker       = $null
        home_team       = $null
        away_team       = $null
        competition     = $null
        country         = $null
        start_time      = $null
        odds_json       = $null
        odd_1           = $null
        odd_x           = $null
        odd_2           = $null
        odd_under       = $null
        odd_over        = $null
        odd_1x          = $null
        odd_12          = $null
        odd_x2          = $null
        odd_yes         = $null
        odd_no          = $null
    }
    foreach ($key in $Fields.Keys) {
        $row[$key] = $Fields[$key]
    }
    return [pscustomobject]$row
}

function Parse-ReplicatorRow {
    param($Serilog, [string]$CsvTimestamp)
    $rows = @()
    $props = $Serilog.Properties
    $msg = Parse-JsonMaybe $props.MSG
    if ($null -eq $msg) { return $rows }

    $msgGuid = Get-Prop $msg.Header "MsgGuid"
    foreach ($event in Get-Array (Get-Prop $msg.Body "Events")) {
        $fixtureId = Get-Prop $event "FixtureId"
        foreach ($market in Get-Array (Get-Prop $event "Markets")) {
            foreach ($provider in Get-Array (Get-Prop $market "ProviderMarkets")) {
                $odds = Bets-ToDict (Get-Prop $provider "Bets")
                $rows += New-Row (@{
                    timestamp      = if ($CsvTimestamp) { $CsvTimestamp } else { $Serilog.Timestamp }
                    log_type       = "replicator"
                    application    = [string]$props.Application
                    msg_guid       = [string]$msgGuid
                    fixture_id     = [string]$fixtureId
                    market         = [string](Get-Prop $market "Name")
                    market_id      = [string](Get-Prop $market "Id")
                    line_type      = $null
                    line_parameter = [string](Get-Prop $market "MainLine")
                    bookmaker      = [string](Get-Prop $provider "Name")
                } + (Build-OddsColumns $odds))
            }
        }
    }
    return $rows
}

function Parse-ScannerRow {
    param($Serilog, [string]$CsvTimestamp)
    $rows = @()
    $props = $Serilog.Properties
    $payload = Parse-JsonMaybe $props.object
    if ($null -eq $payload) { return $rows }

    $game = Get-Prop $payload "Game"
    $competitors = Get-Array (Get-Prop $game "m_Competitors")
    $homeTeam = if ($competitors.Count -ge 1) { [string](Get-Prop (Get-Prop $competitors[0] "Name") "m_Value") } else { $null }
    $awayTeam = if ($competitors.Count -ge 2) { [string](Get-Prop (Get-Prop $competitors[1] "Name") "m_Value") } else { $null }
    $partnerGames = Get-Array (Get-Prop $game "m_PartnerGames")
    $fixtureId = $null
    foreach ($partnerGame in $partnerGames) {
        $candidate = Get-Prop $partnerGame "GameID"
        if ($null -ne $candidate -and [string]$candidate -ne "") {
            $fixtureId = [string]$candidate
            break
        }
    }
    $msgGuid = ([string](Get-Prop $props "MsgGuid")).Trim()

    foreach ($line in Get-Array (Get-Prop $payload "m_Lines")) {
        $tag = [string](Get-Prop $line "Tag")
        $marketName = Extract-TagField $tag "Name"
        $odds = Scanner-OddsToDict $line $marketName
        $bookmakerObj = Get-Prop $line "Bookmaker"
        $rows += New-Row (@{
            timestamp      = if ($CsvTimestamp) { $CsvTimestamp } else { $Serilog.Timestamp }
            log_type       = "scanner"
            application    = [string]$props.Application
            msg_guid       = if ($msgGuid) { $msgGuid } else { Extract-TagField $tag "MsgGuid" }
            fixture_id     = $fixtureId
            market         = $marketName
            market_id      = Extract-TagField $tag "Id"
            line_type      = [string](Get-Prop $line "LineType")
            line_parameter = [string](Get-Prop $line "Parameter")
            bookmaker      = [string](Get-Prop $bookmakerObj "m_Value")
            home_team      = $homeTeam
            away_team      = $awayTeam
            competition    = [string](Get-Prop (Get-Prop $game "Competition") "m_Value")
            country        = [string](Get-Prop (Get-Prop $game "Country") "m_Value")
            start_time     = [string](Get-Prop $game "StartTime")
        } + (Build-OddsColumns $odds))
    }
    return $rows
}

if (-not (Test-Path $InputPath)) {
    throw "Input file not found: $InputPath"
}

if (-not $OutputPath) {
    $OutputPath = [System.IO.Path]::Combine(
        [System.IO.Path]::GetDirectoryName($InputPath),
        [System.IO.Path]::GetFileNameWithoutExtension($InputPath) + "_normalized.csv"
    )
}

$inputRows = Import-Csv -Path $InputPath
$allRows = @()
$errors = @()

for ($i = 0; $i -lt $inputRows.Count; $i++) {
    $row = $inputRows[$i]
    try {
        $serilog = Unwrap-Serilog $row.Source
        if ($null -eq $serilog) {
            $errors += "row $i : empty or invalid Source JSON"
            continue
        }

        $logType = Detect-LogType $serilog
        switch ($logType) {
            "replicator" { $parsed = Parse-ReplicatorRow $serilog $row.Timestamp }
            "scanner"    { $parsed = Parse-ScannerRow $serilog $row.Timestamp }
            default {
                $errors += "row $i : unknown log type"
                continue
            }
        }

        if (@($parsed).Count -eq 0) {
            $errors += "row $i : no rows extracted"
            continue
        }

        $allRows += $parsed
    }
    catch {
        $errors += "row $i : $($_.Exception.Message)"
    }
}

if ($Bookmaker) {
    $allRows = $allRows | Where-Object { $_.bookmaker -eq $Bookmaker }
}

$allRows | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

Write-Host "Input rows: $($inputRows.Count)"
Write-Host "Normalized rows: $($allRows.Count)"
Write-Host "Output: $OutputPath"
if ($errors.Count -gt 0) {
    Write-Host "Errors: $($errors.Count)"
    $errors | Select-Object -First 10 | ForEach-Object { Write-Host "  - $_" }
}
