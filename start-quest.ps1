$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$running = $false
try {
    $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8765/quest' -TimeoutSec 2
    $running = $page.StatusCode -eq 200
} catch { }
if ($running -and (Test-Path -LiteralPath '.mobile\settings.json')) {
    @'
import json, ssl, urllib.request
from pathlib import Path
try:
    address = json.loads(Path('.mobile/settings.json').read_text())['address']
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile='.mobile/ca.pem')))
    with http.open(f'https://{address}:8767/quest', timeout=2) as response:
        assert response.status == 200
except Exception:
    raise SystemExit(1)
'@ | python -
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'The desktop relay is running, but its Quest HTTPS listener is unavailable.'
        Write-Host 'Stop the car, close the controller server window, then run start-quest.cmd again.'
        return
    }
    $questSettings = Get-Content -LiteralPath '.mobile\settings.json' -Raw | ConvertFrom-Json
    Write-Host ('Quest Browser: https://{0}:8767/quest' -f $questSettings.address)
    Write-Host ('Camera setup: http://localhost:8765/quest')
    Write-Host 'Practice works now without a camera. Keep the existing server running; Live car requires fresh video.'
    Start-Process 'http://localhost:8765/quest'
} elseif ($running) {
    Write-Host 'The desktop relay is running without phone/Quest HTTPS settings.'
    Write-Host 'Stop the car, close the controller server window, then run start-quest.cmd again.'
} else {
    Write-Host 'Starting the shared local relay for desktop, phone and Quest.'
    if (Test-Path -LiteralPath 'relay.local.json') {
        python prepare_connection.py
        if ($LASTEXITCODE -ne 0) { Write-Host 'ESP is offline. Practice still works; reconnect the ESP before using Live car.' }
    }
    python prepare_mobile.py
    if ($LASTEXITCODE -ne 0) { throw 'Join the shared Wi-Fi before starting Quest access.' }
    $questSettings = Get-Content -LiteralPath '.mobile\settings.json' -Raw | ConvertFrom-Json
    Write-Host ('Quest Browser: https://{0}:8767/quest' -f $questSettings.address)
    Write-Host 'Practice works without the ESP or a camera. Keep this window open.'
    python server.py --mobile-address $questSettings.address
}
