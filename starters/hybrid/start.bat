@echo off
title Open Mercato - Hybrid Dev Stack
setlocal
rem Start the hybrid dev stack: infra containers + yarn dev (app + MCP).
cd /d "%~dp0..\.."
node starters\lib\start.mjs %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
