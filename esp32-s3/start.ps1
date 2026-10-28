param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'relay.local.json')) {
    Write-Host 'Setup required: run python setup.py, then follow README.md to configure and flash the ESP32.'
}
if (Test-Path -LiteralPath 'relay.local.json') {
    python prepare_connection.py
    if ($LASTEXITCODE -ne 0) { Write-Host 'ESP not found yet. The site will open disarmed; check the shared Wi-Fi and restart.' }
}
if (-not $NoBrowser) {
    Start-Process -WindowStyle Hidden powershell.exe -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-Command', 'Start-Sleep -Seconds 2; Start-Process http://localhost:8865'
}
python server.py
