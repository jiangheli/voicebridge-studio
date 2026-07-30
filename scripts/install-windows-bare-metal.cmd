@echo off
setlocal
title VoiceBridge Studio Bare-Metal Installer

set "LOCAL_SCRIPT=%~dp0install-windows-local-gpu.ps1"
set "DOWNLOADED_SCRIPT=%TEMP%\VoiceBridge-install-windows-local-gpu.ps1"
set "SCRIPT_URL=https://raw.githubusercontent.com/jiangheli/voicebridge-studio/main/scripts/install-windows-local-gpu.ps1"

if exist "%LOCAL_SCRIPT%" (
    set "INSTALL_SCRIPT=%LOCAL_SCRIPT%"
) else (
    echo Downloading the VoiceBridge installer...
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
      "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%SCRIPT_URL%' -OutFile '%DOWNLOADED_SCRIPT%'"
    if errorlevel 1 (
        echo.
        echo Unable to download the installer. Check the network and try again.
        pause
        exit /b 1
    )
    set "INSTALL_SCRIPT=%DOWNLOADED_SCRIPT%"
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_SCRIPT%" %*
if errorlevel 1 (
    echo.
    echo Installation paused or failed. Read the message above before closing this window.
    pause
)

endlocal
