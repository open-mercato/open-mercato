@echo off
setlocal
rem Open Mercato dev environment - Rancher Desktop edition.
rem Same one-command setup as start-windows.bat, but pinned to Rancher
rem Desktop (the usual choice on enterprise machines where Docker Desktop
rem licensing is not permitted). When WSL2 is already present, Rancher
rem installs per-user - no administrator rights needed at all.

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

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -LauncherPath "%~f0" -Runtime rancher %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" if not "%RC%"=="10" pause
endlocal & exit /b %RC%
