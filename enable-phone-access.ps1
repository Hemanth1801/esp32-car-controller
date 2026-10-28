param([string]$Address)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not $Address) {
    $Address = python prepare_mobile.py --print-address
    if ($LASTEXITCODE -ne 0) { throw 'Join the shared Wi-Fi first.' }
}
$parsedAddress = [System.Net.IPAddress]::Parse($Address)
$addressBytes = $parsedAddress.GetAddressBytes()
$privateAddress = $addressBytes.Length -eq 4 -and ($addressBytes[0] -eq 10 -or ($addressBytes[0] -eq 172 -and $addressBytes[1] -ge 16 -and $addressBytes[1] -le 31) -or ($addressBytes[0] -eq 192 -and $addressBytes[1] -eq 168))
if (-not $privateAddress) { throw 'Use this computer''s private Wi-Fi IPv4 address.' }
$localAddress = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address -ErrorAction SilentlyContinue
if (-not $localAddress) { throw 'That IPv4 address is not assigned to this computer.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal $identity
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script in an Administrator PowerShell window to allow the phone through Windows Firewall.'
}
$pythonPath = (Get-Command python.exe).Source
$ruleName = 'ESPCarPhoneController'
$existingRule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
    $existingRule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -LocalAddress $Address -RemoteAddress LocalSubnet | Out-Null
    $existingRule | Get-NetFirewallApplicationFilter | Set-NetFirewallApplicationFilter -Program $pythonPath | Out-Null
} else {
    New-NetFirewallRule -Name $ruleName -DisplayName 'ESP Car phone controller (local Wi-Fi)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8767,8768 -LocalAddress $Address -RemoteAddress LocalSubnet -Program $pythonPath -Profile Any | Out-Null
}
Write-Host "Allowed phone HTTPS/setup ports only on $Address for local subnet clients."
