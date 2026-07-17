@echo off
title Open Mercato - Machine Preflight (read-only)
setlocal
rem Open Mercato dev environment - Windows pre-flight check (READ-ONLY).
rem Run this BEFORE start-windows-rancher.bat to find out whether a locked-down
rem corporate machine will let the launcher succeed. It installs nothing,
rem enables no Windows features, and downloads no files - every check is a query.

set "PS1=%~dp0preflight-windows.ps1"
if not exist "%PS1%" (
  echo preflight-windows.ps1 was not found next to this script.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"
pause
endlocal & exit /b %RC%
