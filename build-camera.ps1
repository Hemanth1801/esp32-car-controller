$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'firmware\car_camera\config.h')) { throw 'Run python prepare_camera.py first.' }
$cameraCli = Join-Path $PSScriptRoot '.tools\arduino-cli\arduino-cli.exe'
if (-not (Test-Path -LiteralPath $cameraCli)) { throw 'Use Arduino IDE with board AI Thinker ESP32-CAM and firmware/car_camera.' }
& $cameraCli compile --config-file '.tools\arduino-cli.yaml' --fqbn 'esp32:esp32:esp32cam' --build-path '.\artifacts\camera-firmware' '.\firmware\car_camera'
if ($LASTEXITCODE -ne 0) { throw 'Camera firmware compilation failed.' }
Write-Host 'Camera firmware compiled only. Flash later to a separate, verified AI Thinker ESP32-CAM, never the motor-controller ESP.'
