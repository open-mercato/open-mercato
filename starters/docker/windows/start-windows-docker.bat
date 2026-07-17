@echo off
title Open Mercato - Dev Environment (Docker Desktop)
setlocal
rem Open Mercato dev environment - Docker Desktop edition.
rem Same one-command setup as start-windows.bat, but pinned to Docker
rem Desktop (mind its licensing terms for large organizations - if that is
rem a problem, use start-windows-rancher.bat instead).

set "PS1=%~dp0start-dev.ps1"
if not exist "%PS1%" (
  echo Downloading the Open Mercato Windows launcher...
  set "PS1=%TEMP%\open-mercato-start-dev.ps1"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/open-mercato/open-mercato/main/starters/docker/windows/start-dev.ps1' -OutFile ($env:TEMP + '\open-mercato-start-dev.ps1')"
  if errorlevel 1 (
    echo Download failed. Check your internet connection or proxy and retry.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -LauncherPath "%~f0" -Runtime docker %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" if not "%RC%"=="10" pause
endlocal & exit /b %RC%
