$ErrorActionPreference = 'Stop'
$keepaliveRoot = $PSScriptRoot
$keepalivePidPath = Join-Path $keepaliveRoot 'artifacts\idle-keepalive.pid'
if (-not (Test-Path -LiteralPath $keepalivePidPath)) { Write-Host 'No idle keepalive is recorded.'; exit }
$keepaliveProcessId = [int](Get-Content -LiteralPath $keepalivePidPath -Raw)
$keepaliveProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $keepaliveProcessId"
if ($keepaliveProcess) {
    $keepaliveScript = Join-Path $keepaliveRoot 'idle_keepalive.py'
    if ($keepaliveProcess.Name -notmatch '^python(w)?(\d+(\.\d+)*)?\.exe$' -or $keepaliveProcess.CommandLine -notlike ('*"' + $keepaliveScript + '"*')) {
        throw 'The recorded PID does not belong to this keepalive script; no process was stopped.'
    }
    Stop-Process -Id $keepaliveProcessId
}
Remove-Item -LiteralPath $keepalivePidPath
Write-Host 'Idle keepalive stopped. Wheel controls were not changed.'
