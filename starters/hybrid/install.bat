@echo off
title Open Mercato - Hybrid Install
setlocal
rem Hybrid dev environment installer (app + MCP native, infra in containers).
rem Double-click this file (repo path: starters\hybrid\). When run standalone
rem it downloads install.ps1 from the main branch first.

set "PS1=%~dp0install.ps1"
if not exist "%PS1%" (
  echo Downloading the Open Mercato hybrid installer...
  set "PS1=%TEMP%\open-mercato-hybrid-install.ps1"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/open-mercato/open-mercato/main/starters/hybrid/install.ps1' -OutFile ($env:TEMP + '\open-mercato-hybrid-install.ps1')"
  if errorlevel 1 (
    echo Download failed. Check your internet connection or proxy and retry.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
