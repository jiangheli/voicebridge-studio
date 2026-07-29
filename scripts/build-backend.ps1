$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

python -m pip install --disable-pip-version-check -r server/requirements.txt pyinstaller
python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name voicebridge-api `
  --distpath "build/pyinstaller-dist" `
  --workpath "build/pyinstaller-work" `
  --specpath "build" `
  --collect-all fastapi `
  --collect-all uvicorn `
  --collect-all huggingface_hub `
  --add-data "config;config" `
  server/__main__.py

New-Item -ItemType Directory -Force -Path "build/backend" | Out-Null
Copy-Item -Force "build/pyinstaller-dist/voicebridge-api.exe" "build/backend/voicebridge-api.exe"
