@echo off
rem Open Mercato starter — double-click entry for Windows.
rem Runs the PowerShell bootstrap next to this file, which guarantees Node 24
rem (portable, no admin) and hands off to the cross-platform starter CLI.
title Open Mercato Starter
setlocal
rem UTF-8 console first: cmd.exe decodes batch files with the code page it
rem started with, and Yarn Berry's temp .cmd wrappers embed UTF-8 paths —
rem OEM code pages mangle non-ASCII checkout paths into MODULE_NOT_FOUND.
chcp 65001 >nul
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
