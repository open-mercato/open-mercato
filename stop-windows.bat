@echo off
setlocal
rem Stops the Open Mercato Docker dev stack. Data is preserved in volumes;
rem start again with start-windows.bat.

set "PS1=%~dp0scripts\windows\start-dev.ps1"
if not exist "%PS1%" (
  echo This script must be run from the Open Mercato repository root.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Stop %*
pause
endlocal & exit /b %ERRORLEVEL%
