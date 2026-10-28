@echo off
cd /d "%~dp0"
python prepare_camera.py
if errorlevel 1 goto done
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-camera.ps1"
:done
pause
