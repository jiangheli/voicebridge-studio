[CmdletBinding()]
param(
    [string]$OutputDirectory = "offline-bundle",
    [switch]$SkipDownloads,
    [switch]$SkipImageBuild
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BundleVersion = "0.6.3"
$ImageName = "voicebridge-seamless-sidecar:0.5.0"
$RootDirectory = Split-Path -Parent $PSScriptRoot
$OutputDirectory = [System.IO.Path]::GetFullPath(
    (Join-Path (Get-Location) $OutputDirectory)
)
$PayloadDirectory = Join-Path $OutputDirectory "payload"
New-Item -ItemType Directory -Force -Path $PayloadDirectory | Out-Null

$Downloads = @(
    @{
        Name = "SeamlessExpressive.tar.gz.part-00"
        Uri = "https://github.com/RSXLX/voicebridge-models-private/releases/download/seamless-expressive-2023-11-29/SeamlessExpressive.tar.gz.part-00"
        Sha256 = "9bc8da0412ada21f17134633671448a4e9051f7b04a09267e99b12d6e0825732"
    },
    @{
        Name = "SeamlessExpressive.tar.gz.part-01"
        Uri = "https://github.com/RSXLX/voicebridge-models-private/releases/download/seamless-expressive-2023-11-29/SeamlessExpressive.tar.gz.part-01"
        Sha256 = "000bc9f9d63f7766946cab2decd61c6fdbac899459ba61738e3517cdf83e358c"
    },
    @{
        Name = "SEAMLESS_LICENSE"
        Uri = "https://github.com/RSXLX/voicebridge-models-private/releases/download/seamless-expressive-2023-11-29/SEAMLESS_LICENSE"
        Sha256 = "0a8e7e2656ad1fd13243a496be6aed6ba3e9e91bf7a597d538c4d3f30baefc82"
    },
    @{
        Name = "NOTICE"
        Uri = "https://github.com/RSXLX/voicebridge-models-private/releases/download/seamless-expressive-2023-11-29/NOTICE"
        Sha256 = "b1198a01da776f0ceac60a6b336a2ea5b5f166a7795a9cddf24b4c95cc271fd0"
    },
    @{
        Name = "VoiceBridge-Studio-Windows-x64.exe"
        Uri = "https://github.com/jiangheli/voicebridge-studio/releases/download/v0.6.3/VoiceBridge-Studio-0.6.3-Windows-x64.exe"
        Sha256 = "3dd0ad029a5d012fba96996913f528a0c7eb008ee3e264c0e4884ed1f7164b52"
    },
    @{
        Name = "wsl-x64.msi"
        Uri = "https://github.com/microsoft/WSL/releases/download/2.7.11/wsl.2.7.11.0.x64.msi"
        Sha256 = "a611ddacee689d2fb1fb5319e58af7f3998864d86cdce632eadd8e61614a0f9d"
    },
    @{
        Name = "Docker-Desktop-Installer.exe"
        Uri = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
        Sha256 = "fe54164c1ceb9e2004137e22e4013826baccf2352c1cedb27e8daa8e56230dd7"
    }
)

function Invoke-ResumableDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    $Curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $Curl) {
        $Curl = Get-Command curl -ErrorAction SilentlyContinue
    }
    if ($Curl) {
        & $Curl.Source `
            --fail `
            --location `
            --retry 5 `
            --continue-at - `
            --output $Destination `
            $Uri
        if ($LASTEXITCODE -ne 0) {
            throw "下载失败：$Uri"
        }
        return
    }
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination
}

if (-not $SkipDownloads) {
    foreach ($Download in $Downloads) {
        $Destination = Join-Path $PayloadDirectory $Download.Name
        Write-Host "准备 $($Download.Name)"
        if (
            (Test-Path -LiteralPath $Destination -PathType Leaf) -and
            $Download.Sha256 -and
            (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq
                $Download.Sha256
        ) {
            Write-Host "  已存在且校验通过"
            continue
        }
        Invoke-ResumableDownload -Uri $Download.Uri -Destination $Destination
        if ($Download.Sha256) {
            $ActualHash = (
                Get-FileHash -LiteralPath $Destination -Algorithm SHA256
            ).Hash.ToLowerInvariant()
            if ($ActualHash -ne $Download.Sha256) {
                throw "$($Download.Name) 校验失败。"
            }
        }
    }
}

$ImageArchive = Join-Path $PayloadDirectory "voicebridge-seamless-sidecar-amd64.tar"
if (-not $SkipImageBuild) {
    $Docker = Get-Command docker -ErrorAction Stop
    & $Docker.Source build `
        --platform linux/amd64 `
        --tag $ImageName `
        (Join-Path $RootDirectory "services\seamless-sidecar")
    if ($LASTEXITCODE -ne 0) {
        throw "离线 Sidecar 镜像构建失败。"
    }
    & $Docker.Source image save --output $ImageArchive $ImageName
    if ($LASTEXITCODE -ne 0) {
        throw "离线 Sidecar 镜像导出失败。"
    }
}

$RequiredFiles = @(
    "Docker-Desktop-Installer.exe",
    "wsl-x64.msi",
    "VoiceBridge-Studio-Windows-x64.exe",
    "SeamlessExpressive.tar.gz.part-00",
    "SeamlessExpressive.tar.gz.part-01",
    "SEAMLESS_LICENSE",
    "NOTICE",
    "voicebridge-seamless-sidecar-amd64.tar"
)
$ManifestFiles = @($RequiredFiles)
if (Test-Path -LiteralPath (Join-Path $PayloadDirectory "NVIDIA-Driver.exe")) {
    $ManifestFiles += "NVIDIA-Driver.exe"
}
$Files = foreach ($Name in $ManifestFiles) {
    $Path = Join-Path $PayloadDirectory $Name
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "离线包缺少文件：$Name"
    }
    $Item = Get-Item -LiteralPath $Path
    @{
        name = $Name
        size = $Item.Length
        sha256 = (
            Get-FileHash -LiteralPath $Path -Algorithm SHA256
        ).Hash.ToLowerInvariant()
    }
}
$Manifest = @{
    schema_version = 1
    bundle_version = $BundleVersion
    architecture = "windows-x64"
    image = $ImageName
    generated_at = [DateTime]::UtcNow.ToString("o")
    files = @($Files)
} | ConvertTo-Json -Depth 5
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText(
    (Join-Path $PayloadDirectory "offline-manifest.json"),
    $Manifest,
    $Utf8NoBom
)

Write-Host ""
Write-Host "离线 payload 已准备：$PayloadDirectory" -ForegroundColor Green
Write-Host "下一步使用 NSIS 编译 VoiceBridgeOfflineLauncher.nsi。"
