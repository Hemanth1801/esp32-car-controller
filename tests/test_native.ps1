$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Path 'artifacts' -Force | Out-Null
$locator = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $locator)) { throw 'Visual Studio C++ tools are required for the native test.' }
$installation = & $locator -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'Install the Visual Studio C++ build tools.' }
$vcvars = Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
# Use a batch file so paths with spaces survive Windows PowerShell argument quoting.
@(
    '@echo off',
    ('call "{0}" >nul' -f $vcvars),
    'if errorlevel 1 exit /b 1',
    'cl /nologo /EHsc /std:c++17 tests\test_safety.cpp /Fe:artifacts\test_safety.exe /Fo:artifacts\test_safety.obj',
    'if errorlevel 1 exit /b 1',
    'artifacts\test_safety.exe',
    'exit /b %errorlevel%'
) | Set-Content -LiteralPath 'artifacts\test_native.cmd' -Encoding ASCII
& cmd.exe /d /c artifacts\test_native.cmd
if ($LASTEXITCODE -ne 0) { throw 'Native safety regression failed.' }
