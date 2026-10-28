param([ValidateSet('desktop','phone','quest')][string]$Controls = 'quest', [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$profile = $null
try { $profile = Invoke-RestMethod -Uri 'http://127.0.0.1:8865/api/profile' -TimeoutSec 1 } catch { }
if ($profile) {
    if ($profile.control_profile -ne 'dual') { throw 'Another S3 controller mode is running on 8865. Stop that server before switching to two-board mode.' }
    $settings = Get-Content -LiteralPath '.mobile\settings.json' -Raw | ConvertFrom-Json
    Write-Host ('Two-board controller already running. Quest: https://{0}:8867/quest' -f $settings.address)
    if (-not $NoBrowser) {
        $path = if ($Controls -eq 'desktop') { '/controls' } elseif ($Controls -eq 'phone') { '/phone' } else { '/quest' }
        Start-Process ('http://localhost:8865' + $path)
    }
    return
}
python prepare_dual.py
if ($LASTEXITCODE -ne 0) { throw 'Two-board pairing preparation failed.' }
python prepare_mobile.py
if ($LASTEXITCODE -ne 0) { throw 'Join the shared Wi-Fi to prepare HTTPS access.' }
$settings = Get-Content -LiteralPath '.mobile\settings.json' -Raw | ConvertFrom-Json
Write-Host ('Quest Browser: https://{0}:8867/quest' -f $settings.address)
Write-Host ('Phone: https://{0}:8867/phone | Setup: http://{0}:8868' -f $settings.address)
Write-Host 'Old ESP32 drives the L298N. S3 supplies camera video only. Keep this window open.'
if (-not $NoBrowser) {
    $path = if ($Controls -eq 'desktop') { '/controls' } elseif ($Controls -eq 'phone') { '/phone' } else { '/quest' }
    Start-Process -WindowStyle Hidden powershell.exe -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command',('Start-Sleep -Seconds 2; Start-Process http://localhost:8865' + $path)
}
python server.py --profile dual --mobile-address $settings.address
