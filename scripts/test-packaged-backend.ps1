$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $projectRoot "build\backend\voicebridge-api.exe"
if (-not (Test-Path -LiteralPath $backend -PathType Leaf)) {
  throw "Packaged backend is missing: $backend"
}

$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$smokeRoot = Join-Path $temporaryRoot "voicebridge-packaged-backend-smoke"
$stdoutLog = Join-Path $smokeRoot "stdout.log"
$stderrLog = Join-Path $smokeRoot "stderr.log"
$port = Get-Random -Minimum 20000 -Maximum 40000
New-Item -ItemType Directory -Force -Path $smokeRoot | Out-Null

$env:VOICEBRIDGE_API_PORT = [string]$port
$env:VOICEBRIDGE_DATA_DIR = Join-Path $smokeRoot "data"
$env:VOICEBRIDGE_LOG_LEVEL = "warning"
$process = Start-Process `
  -FilePath $backend `
  -PassThru `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog

try {
  $health = $null
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    if ($process.HasExited) {
      $stderr = Get-Content -LiteralPath $stderrLog -Raw -ErrorAction SilentlyContinue
      throw "Packaged backend exited before readiness. Exit $($process.ExitCode). $stderr"
    }
    try {
      $health = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$port/api/v1/health" `
        -TimeoutSec 2
      break
    }
    catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $health -or $health.status -ne "ok") {
    throw "Packaged backend did not become ready."
  }

  $runtime = Invoke-RestMethod `
    -Uri "http://127.0.0.1:$port/api/v1/video-cleanup/runtime" `
    -TimeoutSec 15
  if (
    $runtime.state -notin @(
      "not_prepared",
      "preparing",
      "ready",
      "failed",
      "cancelled"
    )
  ) {
    throw "Packaged video-cleanup API returned an invalid state."
  }

  $missingInspection = $null
  try {
    Invoke-RestMethod `
      -Method Post `
      -Uri "http://127.0.0.1:$port/api/v1/video-cleanup/jobs" `
      -ContentType "application/json" `
      -Body '{"inspection_id":"missing","cleanup_kind":"subtitle","language":"en","region_mode":"auto","regions":[]}' `
      -TimeoutSec 5
  }
  catch {
    $missingInspection = $_.ErrorDetails.Message
  }
  if ($missingInspection -notmatch "inspection_not_found") {
    throw "Packaged video-cleanup validation endpoint was not reachable."
  }

  Write-Host "Packaged backend smoke test passed."
  Write-Host "Health: $($health.status)"
  Write-Host "Video cleanup runtime: $($runtime.state)"
}
finally {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
  }
}
