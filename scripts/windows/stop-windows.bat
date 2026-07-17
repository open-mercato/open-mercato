@echo off
title Open Mercato - Stop Dev Stack
setlocal
rem Stops the Open Mercato Docker dev stack. Data is preserved in volumes;
rem start again with start-windows.bat.

set "PS1=%~dp0start-dev.ps1"
if not exist "%PS1%" (
  echo start-dev.ps1 was not found next to this script.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Stop %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
