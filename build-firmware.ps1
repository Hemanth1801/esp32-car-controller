param([string]$Port)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'firmware\car_controller\config.h')) {
    throw 'Run python setup.py first to generate paired local configuration.'
}
$cli = Join-Path $PSScriptRoot '.tools\arduino-cli\arduino-cli.exe'
if (-not (Test-Path -LiteralPath $cli)) { throw 'Workspace Arduino CLI not installed. Use Arduino IDE as described in README.md.' }
& $cli compile --config-file '.tools\arduino-cli.yaml' --fqbn 'esp32:esp32:esp32doit-devkit-v1' --build-path '.\artifacts\configured-firmware' '.\firmware\car_controller'
if ($LASTEXITCODE -ne 0) { throw 'Firmware compilation failed.' }
if ($Port) {
    & $cli upload --config-file '.tools\arduino-cli.yaml' --fqbn 'esp32:esp32:esp32doit-devkit-v1' --port $Port --input-dir '.\artifacts\configured-firmware'
    if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Check USB port, cable, and BOOT button.' }
} else {
    Write-Host 'Compiled only. To upload, run .\build-firmware.ps1 -Port COM5 (replace COM5 with your ESP USB port).'
}
