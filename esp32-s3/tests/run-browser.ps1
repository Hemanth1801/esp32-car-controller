param([string[]]$Suites = @('qa_browser', 'qa_phone', 'qa_quest', 'qa_s3', 'qa_camera_orientation'), [switch]$Dual)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chrome)) { throw 'Chrome is required for this browser QA helper.' }
$fixtureArguments = @('-X', 'utf8', 'tests/qa_server.py')
if ($Dual) { $fixtureArguments += '--dual' }
$fixture = Start-Process -WindowStyle Hidden -FilePath (Get-Command python.exe).Source -ArgumentList $fixtureArguments -WorkingDirectory (Get-Location).Path -RedirectStandardOutput 'artifacts/qa-fixture.log' -RedirectStandardError 'artifacts/qa-fixture-errors.log' -PassThru
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try { $null = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8866/' -TimeoutSec 1; $ready = $true; break } catch { Start-Sleep -Milliseconds 150 }
    }
    if (-not $ready) { throw 'Simulated ESP fixture failed to start; see artifacts/qa-fixture-errors.log.' }
    foreach ($suite in $Suites) {
        $profile = Join-Path (Get-Location).Path ('artifacts/browser-' + $suite + '-' + [guid]::NewGuid().ToString('N'))
        $arguments = @('--headless=new', '--remote-debugging-port=9337', ('--user-data-dir="' + $profile + '"'), '--no-first-run', '--no-default-browser-check', '--ignore-certificate-errors', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', 'about:blank')
        $browser = Start-Process -WindowStyle Hidden -FilePath $chrome -ArgumentList $arguments -PassThru
        try {
            $ready = $false
            for ($attempt = 0; $attempt -lt 40; $attempt++) {
                try { $null = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9337/json' -TimeoutSec 1; $ready = $true; break } catch { Start-Sleep -Milliseconds 150 }
            }
            if (-not $ready) { throw 'Isolated headless Chrome failed to start.' }
            & node ('tests/' + $suite + '.mjs')
            if ($LASTEXITCODE -ne 0) { throw "Browser QA failed: $suite" }
        } finally {
            if (-not $browser.HasExited) { Stop-Process -Id $browser.Id -ErrorAction SilentlyContinue }
        }
    }
} finally {
    if (-not $fixture.HasExited) { Stop-Process -Id $fixture.Id -ErrorAction SilentlyContinue }
}
