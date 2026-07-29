$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$buildDirectory = Join-Path $projectRoot "build"
$cacheDirectory = Join-Path $buildDirectory "cache"
$extractDirectory = Join-Path $buildDirectory "ffmpeg-extract"
$runtimeDirectory = Join-Path $buildDirectory "runtime"

$archiveName = "ffmpeg-N-125829-gfe953596e9-win64-lgpl-shared.zip"
$archiveUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-28-13-32/$archiveName"
$expectedSha256 = "51af6309b252e9eddb4a68b0c4b2122f4b1150a558ab390bbbb9e49cf3bc2d08"
$archivePath = Join-Path $cacheDirectory $archiveName

New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
if (-not (Test-Path $archivePath)) {
  Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath
}

$actualSha256 = (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
  throw "FFmpeg checksum mismatch. Expected $expectedSha256 but received $actualSha256."
}

if (Test-Path $extractDirectory) {
  Remove-Item -Recurse -Force $extractDirectory
}
New-Item -ItemType Directory -Force -Path $extractDirectory | Out-Null
Expand-Archive -Path $archivePath -DestinationPath $extractDirectory

$ffmpeg = Get-ChildItem -Path $extractDirectory -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
if (-not $ffmpeg) {
  throw "The verified FFmpeg archive did not contain ffmpeg.exe."
}

$sourceBin = $ffmpeg.Directory.FullName
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
Get-ChildItem -Path $runtimeDirectory -File | Remove-Item -Force
Copy-Item -Force (Join-Path $sourceBin "*.exe") $runtimeDirectory
Copy-Item -Force (Join-Path $sourceBin "*.dll") $runtimeDirectory

$license = Get-ChildItem -Path $extractDirectory -Filter "LICENSE.txt" -Recurse | Select-Object -First 1
if ($license) {
  Copy-Item -Force $license.FullName (Join-Path $runtimeDirectory "FFmpeg-LICENSE.txt")
}

$bundledFfmpeg = Join-Path $runtimeDirectory "ffmpeg.exe"
& $bundledFfmpeg -version | Select-Object -First 1
if ($LASTEXITCODE -ne 0) {
  throw "Bundled FFmpeg failed its startup check."
}
