@echo off
rem Open Mercato starter — double-click entry for Windows.
rem Runs the PowerShell bootstrap next to this file, which guarantees Node 24
rem (portable, no admin) and hands off to the cross-platform starter CLI.
title Open Mercato Starter
setlocal
set "PS1=%~dp0start.ps1"
if not exist "%PS1%" (
  echo start.ps1 was not found next to this launcher.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo The starter exited with code %RC%. Review the messages above.
  pause
)
endlocal & exit /b %RC%
