$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'relay.local.json')) { throw 'Run python setup.py and flash the ESP firmware first.' }
python prepare_connection.py
if ($LASTEXITCODE -ne 0) { Write-Host 'S3 offline; opening disarmed. Automatic discovery will retry.' }
python prepare_mobile.py
if ($LASTEXITCODE -ne 0) { throw 'Phone setup could not start. Join the shared Wi-Fi and check the message above.' }
$phoneSettings = Get-Content -LiteralPath '.mobile\settings.json' -Raw | ConvertFrom-Json
Write-Host 'ESP, this computer and the phone must join the same Wi-Fi. Keep this window open.'
Write-Host 'If the phone cannot reach these addresses, run enable-phone-access.ps1 as Administrator once.'
python server.py --mobile-address $phoneSettings.address
