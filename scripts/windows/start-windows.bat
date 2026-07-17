@echo off
title Open Mercato - Dev Environment
setlocal
rem One-command Open Mercato dev environment for Windows.
rem Double-click this file (repo path: scripts\windows\). It installs
rem missing prerequisites (Git, WSL2, a container runtime), clones the repo
rem when run standalone, and starts the fully containerized stack
rem (app :3000, MCP :3001, OpenCode :4096).
rem Auto-detects Docker Desktop vs Rancher Desktop; to force one, use
rem start-windows-rancher.bat or start-windows-docker.bat instead.

set "PS1=%~dp0start-dev.ps1"
if not exist "%PS1%" (
  echo Downloading the Open Mercato Windows launcher...
  set "PS1=%TEMP%\open-mercato-start-dev.ps1"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/open-mercato/open-mercato/main/scripts/windows/start-dev.ps1' -OutFile ($env:TEMP + '\open-mercato-start-dev.ps1')"
  if errorlevel 1 (
    echo Download failed. Check your internet connection or proxy and retry.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -LauncherPath "%~f0" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" if not "%RC%"=="10" pause
endlocal & exit /b %RC%
