$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$configDirectory = Join-Path $projectRoot "config"
Set-Location $projectRoot

python -m pip install --disable-pip-version-check -r server/requirements.txt pyinstaller
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install backend build dependencies."
}

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
  --add-data "$configDirectory;config" `
  server/__main__.py
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller failed to build the backend."
}

New-Item -ItemType Directory -Force -Path "build/backend" | Out-Null
Copy-Item -Force "build/pyinstaller-dist/voicebridge-api.exe" "build/backend/voicebridge-api.exe"
