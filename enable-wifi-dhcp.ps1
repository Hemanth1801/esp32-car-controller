# Restore automatic IPv4 addressing on the Wi-Fi adapter used by this project.
# The previous static settings are saved in artifacts/wifi-ip-before-dhcp-2026-10-25.json.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$resultPath = Join-Path $PSScriptRoot 'artifacts\wifi-dhcp-result.json'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal $identity
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Administrator rights are required to change Wi-Fi IPv4 settings.'
    }
    $adapter = Get-NetAdapter -Name 'Wi-Fi 2'
    if ([guid]$adapter.InterfaceGuid -ne [guid]'5afe91b4-d1be-4b50-babb-a9b23f2b0e11') {
        throw 'Wi-Fi adapter identity changed; refusing to modify another adapter.'
    }
    & netsh interface ipv4 set address 'name=Wi-Fi 2' source=dhcp
    # Some Windows versions return a warning even after DHCP was enabled.
    # Verify the actual adapter state before reporting failure.
    if ((Get-NetIPInterface -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi 2').Dhcp -ne 'Enabled') {
        throw 'Windows could not enable DHCP on Wi-Fi 2.'
    }
    & ipconfig /renew 'Wi-Fi 2'
    if ($LASTEXITCODE -ne 0) { throw 'DHCP enabled, but address renewal failed. Reconnect the Wi-Fi network.' }
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi 2' | Select-Object IPAddress,PrefixLength,PrefixOrigin)
    @{success=$true;addresses=$addresses} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $resultPath -Encoding UTF8
} catch {
    @{success=$false;error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
    exit 1
}
