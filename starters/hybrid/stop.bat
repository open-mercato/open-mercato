@echo off
title Open Mercato - Stop Hybrid Infra
setlocal
rem Stop the hybrid infra containers (data preserved in volumes).
cd /d "%~dp0..\.."
node starters\lib\stop.mjs %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
