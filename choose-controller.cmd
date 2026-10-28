@echo off
setlocal
echo.
echo Choose car controller
echo   1. Old ESP32 - existing package, localhost:8765
echo   2. New ESP32-S3 + camera - separate package, localhost:8865
echo   3. Old ESP32 motors + ESP32-S3 camera - two-board mode
choice /c 123 /n /m "Board [1/2/3]: "
set "selectedBoard=%errorlevel%"
set "dualMode="
if "%selectedBoard%"=="3" set "dualMode=yes"
set "controllerFolder=%~dp0esp32-s3"
if "%selectedBoard%"=="1" set "controllerFolder=%~dp0"
echo.
echo   1. Computer wheel / keyboard
echo   2. Phone tilt controls
echo   3. Quest VR cockpit
choice /c 123 /n /m "Controls [1/2/3]: "
if errorlevel 3 goto quest
if errorlevel 2 goto mobile
if defined dualMode goto dualDesktop
call "%controllerFolder%\start.cmd"
goto done
:mobile
if defined dualMode goto dualPhone
call "%controllerFolder%\start-mobile.cmd"
goto done
:quest
if defined dualMode goto dualQuest
call "%controllerFolder%\start-quest.cmd"
goto done
:dualDesktop
call "%controllerFolder%\start-dual.cmd" -Controls desktop
goto done
:dualPhone
call "%controllerFolder%\start-dual.cmd" -Controls phone
goto done
:dualQuest
call "%controllerFolder%\start-dual.cmd" -Controls quest
:done
endlocal
