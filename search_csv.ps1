param([string]$InputPath)

$rows = Import-Csv $InputPath
$found = @()

for ($i = 0; $i -lt $rows.Count; $i++) {
    $src = $rows[$i].Source
    if ($null -eq $src -or $src -notmatch 'Bet365') { continue }

    $isPure1x2 = $false
    if ($src -match 'Name\\"":\\""1X2\\""' -or $src -match 'Name:1X2' -or $src -match '; Name:1X2') {
        if ($src -notmatch '1X2 And' -and $src -notmatch '1X2 and') {
            $isPure1x2 = $true
        }
    }

    if ($isPure1x2) {
        $logType = if ($src -match 'RabbitMQReplicator') { 'replicator' } elseif ($src -match 'Push.Prematch') { 'scanner' } else { 'other' }
        $found += [pscustomobject]@{
            CsvLine = $i + 2
            Timestamp = $rows[$i].Timestamp
            LogType = $logType
        }
    }
}

Write-Host "CSV rows: $($rows.Count)"
Write-Host "Bet365 + pure 1X2: $($found.Count)"
$found | Format-Table -AutoSize

# Also list distinct market names containing 1X2 with Bet365
Write-Host "`nMarkets with '1X2' in name + Bet365 (any):"
$markets = @{}
for ($i = 0; $i -lt $rows.Count; $i++) {
    $src = $rows[$i].Source
    if ($src -match 'Bet365' -and $src -match '1X2') {
        if ($src -match 'Name\\"":\\""([^""\\]+)\\""') {
            foreach ($m in [regex]::Matches($src, 'Name\\"":\\""([^""\\]+)\\""')) {
                $name = $m.Groups[1].Value
                if ($name -like '*1X2*') { $markets[$name] = $true }
            }
        }
        if ($src -match 'Name:([^;]+)') {
            foreach ($m in [regex]::Matches($src, 'Name:([^;]+)')) {
                $name = $m.Groups[1].Value.Trim()
                if ($name -like '*1X2*') { $markets[$name] = $true }
            }
        }
    }
}
$markets.Keys | Sort-Object | ForEach-Object { Write-Host "  - $_" }
