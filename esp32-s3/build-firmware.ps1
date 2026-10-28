param([string]$Port, [switch]$NativeUSB, [switch]$CameraOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$toolRoot = Join-Path (Split-Path -Parent $PSScriptRoot) '.tools'
$cli = Join-Path $toolRoot 'arduino-cli\arduino-cli.exe'
$cliConfig = Join-Path $toolRoot 'arduino-cli.yaml'
if (-not (Test-Path -LiteralPath 'firmware\car_controller\config.h')) { throw 'Run python setup.py first.' }
if (-not (Test-Path -LiteralPath $cli)) { throw 'Shared Arduino CLI is missing; see README.md for Arduino IDE settings.' }
$cdc = if ($NativeUSB) { 'cdc' } else { 'default' }
$fqbn = "esp32:esp32:esp32s3:FlashSize=16M,FlashMode=qio,PSRAM=opi,PartitionScheme=app3M_fat9M_16MB,UploadSpeed=115200,USBMode=hwcdc,CDCOnBoot=$cdc"
$buildPath = if ($CameraOnly) { '.\artifacts\camera-only-firmware' } else { '.\artifacts\configured-firmware' }
$extraBuild = if ($CameraOnly) { @('--build-property', 'compiler.cpp.extra_flags=-DCAMERA_ONLY_BUILD=1') } else { @() }
& $cli compile --config-file $cliConfig --fqbn $fqbn @extraBuild --build-path $buildPath '.\firmware\car_controller'
if ($LASTEXITCODE -ne 0) { throw 'S3 firmware compilation failed.' }
if ($Port) {
    $esptool = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'arduino-data\packages\esp32\tools\esptool_py') -Filter 'esptool.exe' -File -Recurse | Select-Object -First 1
    if (-not $esptool) { throw 'esptool executable missing. No upload attempted.' }
    Write-Host 'Keep motor power OFF. Checking that the selected serial device is ESP32-S3...'
    & $esptool.FullName --chip esp32s3 --port $Port --baud 115200 chip-id
    if ($LASTEXITCODE -ne 0) { throw 'ESP32-S3 identity check failed. No firmware uploaded.' }
    & $cli upload --config-file $cliConfig --fqbn $fqbn --port $Port --input-dir $buildPath
    if ($LASTEXITCODE -ne 0) { throw 'S3 upload failed. Check the selected USB port/cable and BOOT sequence.' }
} else {
    Write-Host 'Compiled only. Use .\build-firmware.ps1 -Port COMx with the actual S3 port (motor power OFF).'
}
