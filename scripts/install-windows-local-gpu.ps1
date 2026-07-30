[CmdletBinding()]
param(
    [string]$ModelRoot = "",
    [string]$ImportModelDirectory = "",
    [switch]$SkipDockerInstall,
    [switch]$SkipApplicationInstall,
    [switch]$InstallerMode,
    [switch]$SkipSelfUpdate,
    [switch]$KeepDownloadCache,
    [string]$OfflinePayloadDirectory = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ApplicationVersion = "0.6.3"
$ApplicationRepository = "jiangheli/voicebridge-studio"
$ApplicationInstallerName = "VoiceBridge-Studio-$ApplicationVersion-Windows-x64.exe"
$ApplicationInstallerSha256 = "3dd0ad029a5d012fba96996913f528a0c7eb008ee3e264c0e4884ed1f7164b52"
$ReleaseTag = "seamless-expressive-2023-11-29"
$ModelRepository = "RSXLX/voicebridge-models-private"
$ArchiveName = "SeamlessExpressive.tar.gz"
$ArchiveSha256 = "2cd92745b5f16587bd249829cf528afa455b073ac5fa5e182969953a7b255d07"
$ArchiveParts = @(
    "SeamlessExpressive.tar.gz.part-00",
    "SeamlessExpressive.tar.gz.part-01"
)
$RequiredCheckpoints = @(
    "m2m_expressive_unity.pt",
    "pretssel_melhifigan_wm.pt",
    "pretssel_melhifigan_wm-16khz.pt"
)
$ImageName = "voicebridge-seamless-sidecar:0.5.0"
$ContainerName = "voicebridge-seamless-sidecar"
$ServiceBase = "http://127.0.0.1:8787"
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$ResumeRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce"
$ResumeRegistryName = "VoiceBridgeBareMetalSetup"

function ConvertTo-SingleQuotedPowerShellLiteral {
    param([string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-ForwardedCommand {
    param([string]$ScriptPath)
    $Command = "& " + (ConvertTo-SingleQuotedPowerShellLiteral -Value $ScriptPath)
    if ($ModelRoot) {
        $Command += " -ModelRoot " + (ConvertTo-SingleQuotedPowerShellLiteral -Value $ModelRoot)
    }
    if ($ImportModelDirectory) {
        $Command += " -ImportModelDirectory " +
            (ConvertTo-SingleQuotedPowerShellLiteral -Value $ImportModelDirectory)
    }
    if ($SkipDockerInstall) {
        $Command += " -SkipDockerInstall"
    }
    if ($SkipApplicationInstall) {
        $Command += " -SkipApplicationInstall"
    }
    if ($InstallerMode) {
        $Command += " -InstallerMode"
    }
    if ($SkipSelfUpdate) {
        $Command += " -SkipSelfUpdate"
    }
    if ($KeepDownloadCache) {
        $Command += " -KeepDownloadCache"
    }
    if ($OfflinePayloadDirectory) {
        $Command += " -OfflinePayloadDirectory " +
            (ConvertTo-SingleQuotedPowerShellLiteral -Value $OfflinePayloadDirectory)
    }
    return $Command
}

function Get-InteractiveInstallerCommand {
    param([string]$ScriptPath)
    $Invocation = Get-ForwardedCommand -ScriptPath $ScriptPath
    return "try { $Invocation } catch { " +
        "Write-Host ''; " +
        "Write-Host (`$_.Exception.Message) -ForegroundColor Red; " +
        "Read-Host '按 Enter 关闭窗口'; exit 1 }"
}

function ConvertTo-EncodedPowerShellCommand {
    param([string]$Command)
    return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Administrator {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
    return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-VoiceBridgeExecutable {
    $Candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\VoiceBridge Studio\VoiceBridge Studio.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\voicebridge-studio\VoiceBridge Studio.exe"),
        (Join-Path $env:ProgramFiles "VoiceBridge Studio\VoiceBridge Studio.exe")
    )
    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
            return $Candidate
        }
    }
    return $null
}

function Get-DockerExecutable {
    $Candidates = @(
        (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\resources\bin\docker.exe")
    )
    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
            return $Candidate
        }
    }
    $Command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($Command) {
        return $Command.Source
    }
    return $null
}

function Get-DockerDesktopExecutable {
    $Candidates = @(
        (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\Docker Desktop.exe")
    )
    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
            return $Candidate
        }
    }
    return $null
}

function Invoke-CurlDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    $DestinationDirectory = Split-Path -Parent $Destination
    if ($DestinationDirectory) {
        New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null
    }
    $Curl = Get-Command curl.exe -ErrorAction SilentlyContinue
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
    try {
        Invoke-WebRequest -Uri $Uri -OutFile $Destination -UseBasicParsing
    }
    catch {
        throw "下载失败：$Uri"
    }
}

function Get-LatestVoiceBridgeRelease {
    try {
        return Invoke-RestMethod `
            -Uri "https://api.github.com/repos/$ApplicationRepository/releases/latest" `
            -Headers @{
                "Accept" = "application/vnd.github+json"
                "User-Agent" = "VoiceBridge-Windows-Installer"
            } `
            -UseBasicParsing
    }
    catch {
        Write-Host "无法读取最新发布信息，将使用安装器内置版本。" -ForegroundColor Yellow
        return $null
    }
}

function Get-AssetSha256 {
    param($Asset)
    if ($Asset -and "$($Asset.digest)" -match "^sha256:([0-9a-fA-F]{64})$") {
        return $Matches[1].ToLowerInvariant()
    }
    return ""
}

function Get-OfflinePayloadPath {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not $OfflinePayloadDirectory) {
        throw "当前安装未启用离线 payload。"
    }
    $Path = Join-Path $OfflinePayloadDirectory $Name
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "离线包缺少文件：$Name"
    }
    return $Path
}

function Test-OfflinePayload {
    if (-not $OfflinePayloadDirectory) {
        return
    }
    if (-not (Test-Path -LiteralPath $OfflinePayloadDirectory -PathType Container)) {
        throw "找不到离线 payload 目录：$OfflinePayloadDirectory"
    }
    $ManifestPath = Get-OfflinePayloadPath -Name "offline-manifest.json"
    try {
        $Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    }
    catch {
        throw "离线包清单无法解析：offline-manifest.json"
    }
    if ($Manifest.schema_version -ne 1 -or -not $Manifest.files) {
        throw "离线包清单格式不受支持。"
    }
    $RequiredNames = @(
        "Docker-Desktop-Installer.exe",
        "wsl-x64.msi",
        "VoiceBridge-Studio-Windows-x64.exe",
        "SeamlessExpressive.tar.gz.part-00",
        "SeamlessExpressive.tar.gz.part-01",
        "SEAMLESS_LICENSE",
        "NOTICE",
        "voicebridge-seamless-sidecar-amd64.tar"
    )
    $ManifestNames = @($Manifest.files | ForEach-Object { "$($_.name)" })
    foreach ($RequiredName in $RequiredNames) {
        if ($ManifestNames -notcontains $RequiredName) {
            throw "离线包清单缺少条目：$RequiredName"
        }
    }
    foreach ($Entry in $Manifest.files) {
        $PayloadPath = Get-OfflinePayloadPath -Name "$($Entry.name)"
        $Item = Get-Item -LiteralPath $PayloadPath
        if ([int64]$Entry.size -ne $Item.Length) {
            throw "离线文件大小不正确：$($Entry.name)"
        }
        $ActualHash = (
            Get-FileHash -LiteralPath $PayloadPath -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if ($ActualHash -ne "$($Entry.sha256)".ToLowerInvariant()) {
            throw "离线文件校验失败：$($Entry.name)"
        }
    }
}

function Merge-BinaryFiles {
    param(
        [Parameter(Mandatory = $true)][string[]]$Sources,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    $Output = [System.IO.File]::Open(
        $Destination,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    try {
        foreach ($Source in $Sources) {
            $Input = [System.IO.File]::OpenRead($Source)
            try {
                $Input.CopyTo($Output)
            }
            finally {
                $Input.Dispose()
            }
        }
    }
    finally {
        $Output.Dispose()
    }
}

function Set-JsonProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Value
    )
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Test-ModelDirectory {
    param([string]$Directory)
    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
        return $false
    }
    foreach ($Checkpoint in $RequiredCheckpoints) {
        $CheckpointPath = Join-Path $Directory $Checkpoint
        if (
            -not (Test-Path -LiteralPath $CheckpointPath -PathType Leaf) -or
            (Get-Item -LiteralPath $CheckpointPath).Length -le 1MB
        ) {
            return $false
        }
    }
    return $true
}

if (-not [Environment]::Is64BitOperatingSystem) {
    throw "只支持 Windows 10/11 x64。"
}
if ($OfflinePayloadDirectory) {
    $OfflinePayloadDirectory = [System.IO.Path]::GetFullPath(
        $OfflinePayloadDirectory
    )
    $SkipSelfUpdate = $true
}
$WindowsBuild = [Environment]::OSVersion.Version.Build
if ($WindowsBuild -lt 19045 -or ($WindowsBuild -ge 22000 -and $WindowsBuild -lt 22631)) {
    throw "当前 Windows build 为 $WindowsBuild。请先通过 Windows Update 升级到 Windows 10 22H2 build 19045，或 Windows 11 23H2 build 22631 以上。"
}
$ComputerSystem = Get-CimInstance -ClassName Win32_ComputerSystem
$MemoryGb = [Math]::Round($ComputerSystem.TotalPhysicalMemory / 1GB, 1)
if ($MemoryGb -lt 8) {
    throw "物理内存只有 $MemoryGb GB；Docker Desktop 至少需要 8 GB。"
}
if ($MemoryGb -lt 16) {
    Write-Host "警告：物理内存为 $MemoryGb GB，建议至少 16 GB。" -ForegroundColor Yellow
}
$Processor = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1
if ($null -ne $Processor.VirtualizationFirmwareEnabled -and -not $Processor.VirtualizationFirmwareEnabled) {
    throw "BIOS/UEFI 尚未开启 CPU 虚拟化。请开启 Intel VT-x/VT-d 或 AMD-V/SVM 后再运行。"
}
if (-not (Test-Administrator)) {
    if (-not $PSCommandPath) {
        throw "脚本必须保存为 .ps1 文件后再运行。"
    }
    $ElevationCommand = Get-InteractiveInstallerCommand -ScriptPath $PSCommandPath
    $ElevationEncoded = ConvertTo-EncodedPowerShellCommand -Command $ElevationCommand
    Start-Process `
        -FilePath "powershell.exe" `
        -Verb RunAs `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-EncodedCommand", $ElevationEncoded
        )
    exit 0
}
if (Get-Process -Name "VoiceBridge Studio" -ErrorAction SilentlyContinue) {
    throw "请先退出 VoiceBridge Studio，避免配置文件在安装过程中被覆盖。"
}

$BootstrapDirectory = Join-Path $env:ProgramData "VoiceBridge"
$ResumeScriptPath = Join-Path $BootstrapDirectory "install-windows-local-gpu.ps1"
New-Item -ItemType Directory -Force -Path $BootstrapDirectory | Out-Null
if (
    -not (Test-Path -LiteralPath $ResumeScriptPath -PathType Leaf) -or
    [System.IO.Path]::GetFullPath($PSCommandPath) -ne
        [System.IO.Path]::GetFullPath($ResumeScriptPath)
) {
    Copy-Item -LiteralPath $PSCommandPath -Destination $ResumeScriptPath -Force
}

$LatestRelease = $null
if (-not $OfflinePayloadDirectory) {
    $LatestRelease = Get-LatestVoiceBridgeRelease
}
if (-not $SkipSelfUpdate -and $LatestRelease) {
    $LogicAsset = $LatestRelease.assets |
        Where-Object { $_.name -eq "VoiceBridge-Windows-Install-Logic.ps1" } |
        Select-Object -First 1
    $LogicSha256 = Get-AssetSha256 -Asset $LogicAsset
    if ($LogicAsset -and $LogicSha256) {
        $LogicDirectory = Join-Path $BootstrapDirectory "updates\$($LatestRelease.tag_name)"
        $LatestLogicPath = Join-Path $LogicDirectory "install-windows-local-gpu.ps1"
        $NeedsLogicDownload = $true
        if (Test-Path -LiteralPath $LatestLogicPath -PathType Leaf) {
            $CachedLogicSha256 = (
                Get-FileHash -LiteralPath $LatestLogicPath -Algorithm SHA256
            ).Hash.ToLowerInvariant()
            $NeedsLogicDownload = $CachedLogicSha256 -ne $LogicSha256
        }
        if ($NeedsLogicDownload) {
            Invoke-CurlDownload `
                -Uri $LogicAsset.browser_download_url `
                -Destination $LatestLogicPath
        }
        $DownloadedLogicSha256 = (
            Get-FileHash -LiteralPath $LatestLogicPath -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if ($DownloadedLogicSha256 -ne $LogicSha256) {
            throw "安装逻辑自动更新校验失败。"
        }
        $CurrentLogicSha256 = (
            Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if ($CurrentLogicSha256 -ne $DownloadedLogicSha256) {
            Write-Step "切换到最新安装逻辑 $($LatestRelease.tag_name)"
            $UpdatedCommand = (
                Get-ForwardedCommand -ScriptPath $LatestLogicPath
            ) + " -SkipSelfUpdate"
            $UpdatedEncoded = ConvertTo-EncodedPowerShellCommand -Command $UpdatedCommand
            & powershell.exe `
                -NoProfile `
                -ExecutionPolicy Bypass `
                -EncodedCommand $UpdatedEncoded
            exit $LASTEXITCODE
        }
    }
}

Remove-ItemProperty `
    -Path $ResumeRegistryPath `
    -Name $ResumeRegistryName `
    -ErrorAction SilentlyContinue

if ($OfflinePayloadDirectory) {
    Write-Step "校验离线安装包"
    Test-OfflinePayload
}

if ($ModelRoot -and $ImportModelDirectory) {
    throw "ModelRoot 和 ImportModelDirectory 不能同时使用。"
}

if (-not $ModelRoot -and -not $ImportModelDirectory) {
    if (Test-Path -LiteralPath "D:\") {
        $ModelRoot = "D:\VoiceBridge\Models"
    }
    else {
        $ModelRoot = Join-Path $env:LOCALAPPDATA "VoiceBridge\models"
    }
}
$UsingImportedModel = -not [string]::IsNullOrWhiteSpace($ImportModelDirectory)
if ($UsingImportedModel) {
    $ModelDirectory = [System.IO.Path]::GetFullPath($ImportModelDirectory)
    $ModelRoot = Split-Path -Parent $ModelDirectory
}
else {
    $ModelRoot = [System.IO.Path]::GetFullPath($ModelRoot)
    $ModelDirectory = Join-Path $ModelRoot "SeamlessExpressive"
}
$DownloadDirectory = Join-Path $ModelRoot ".downloads\SeamlessExpressive"
$DataDirectory = Join-Path $env:LOCALAPPDATA "VoiceBridge"
$CacheDirectory = Join-Path $DataDirectory "cache"
$SettingsPath = Join-Path $DataDirectory "settings.json"

Write-Step "检查 NVIDIA Windows 驱动"
$NvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if (-not $NvidiaSmi) {
    if ($OfflinePayloadDirectory) {
        $OfflineDriver = Join-Path $OfflinePayloadDirectory "NVIDIA-Driver.exe"
        if (Test-Path -LiteralPath $OfflineDriver -PathType Leaf) {
            Write-Host "正在安装离线 NVIDIA 驱动。"
            $DriverProcess = Start-Process `
                -FilePath $OfflineDriver `
                -ArgumentList @("-s", "-noreboot") `
                -Wait `
                -PassThru
            if ($DriverProcess.ExitCode -notin @(0, 1, 3010)) {
                throw "NVIDIA 驱动安装失败，退出码：$($DriverProcess.ExitCode)"
            }
            throw "NVIDIA 驱动已安装，请重启 Windows 后再次运行离线安装入口。"
        }
        throw "当前电脑没有可用的 NVIDIA 驱动。请把适配此显卡的安装包命名为 NVIDIA-Driver.exe 放进 payload，或先离线安装驱动。"
    }
    Write-Host "未找到 NVIDIA 驱动。正在打开 NVIDIA 官方驱动下载页面。" -ForegroundColor Yellow
    Start-Process "https://www.nvidia.com/Download/index.aspx"
    throw "请按显卡型号安装最新 NVIDIA Windows 驱动，重启 Windows，然后再次双击安装入口。"
}
& $NvidiaSmi.Source --query-gpu=name,driver_version --format=csv,noheader
if ($LASTEXITCODE -ne 0) {
    throw "NVIDIA 驱动不可用。"
}

Write-Step "检查并启用 WSL2"
$WslFeature = Get-WindowsOptionalFeature `
    -Online `
    -FeatureName Microsoft-Windows-Subsystem-Linux
$VmFeature = Get-WindowsOptionalFeature `
    -Online `
    -FeatureName VirtualMachinePlatform
$RestartRequired = $false

if ($WslFeature.State -ne "Enabled" -or $VmFeature.State -ne "Enabled") {
    Enable-WindowsOptionalFeature `
        -Online `
        -FeatureName Microsoft-Windows-Subsystem-Linux `
        -All `
        -NoRestart | Out-Null
    Enable-WindowsOptionalFeature `
        -Online `
        -FeatureName VirtualMachinePlatform `
        -All `
        -NoRestart | Out-Null
    $RestartRequired = $true
}

if ($RestartRequired) {
    $ResumeCommand = Get-InteractiveInstallerCommand -ScriptPath $ResumeScriptPath
    $ResumeEncoded = ConvertTo-EncodedPowerShellCommand -Command $ResumeCommand
    $ResumeValue = "powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand $ResumeEncoded"
    New-Item -Path $ResumeRegistryPath -Force | Out-Null
    New-ItemProperty `
        -Path $ResumeRegistryPath `
        -Name $ResumeRegistryName `
        -Value $ResumeValue `
        -PropertyType String `
        -Force | Out-Null
    Write-Host ""
    Write-Host "WSL2 已启用，需要重启 Windows。" -ForegroundColor Yellow
    Write-Host "重启并登录后，Windows 会自动继续安装；届时只需确认一次 UAC。"
    if (-not $InstallerMode) {
        $RestartChoice = Read-Host "输入 R 并按 Enter 立即重启；直接按 Enter 可稍后手动重启"
        if ($RestartChoice.Trim().ToUpperInvariant() -eq "R") {
            Restart-Computer
        }
    }
    exit 3010
}

if ($OfflinePayloadDirectory) {
    $WslInstaller = Get-OfflinePayloadPath -Name "wsl-x64.msi"
    $WslProcess = Start-Process `
        -FilePath "msiexec.exe" `
        -ArgumentList @("/i", "`"$WslInstaller`"", "/qn", "/norestart") `
        -Wait `
        -PassThru
    if ($WslProcess.ExitCode -notin @(0, 3010, 1641)) {
        throw "WSL 离线安装失败，退出码：$($WslProcess.ExitCode)"
    }
}
else {
    & wsl.exe --update
    if ($LASTEXITCODE -ne 0) {
        throw "WSL 更新失败。"
    }
}
& wsl.exe --set-default-version 2
if ($LASTEXITCODE -ne 0) {
    throw "无法把 WSL 默认版本设置为 2。"
}

Write-Step "检查 Docker Desktop"
$Docker = Get-DockerExecutable
if (-not $Docker -and -not $SkipDockerInstall) {
    if ($OfflinePayloadDirectory) {
        $Installer = Get-OfflinePayloadPath -Name "Docker-Desktop-Installer.exe"
        $Signature = Get-AuthenticodeSignature -LiteralPath $Installer
        if ($Signature.Status -ne "Valid") {
            throw "Docker Desktop 离线安装程序数字签名无效。"
        }
        $DockerProcess = Start-Process `
            -FilePath $Installer `
            -ArgumentList @(
                "install",
                "--user",
                "--backend=wsl-2",
                "--accept-license",
                "--quiet"
            ) `
            -Wait `
            -PassThru
        if ($DockerProcess.ExitCode -notin @(0, 3010)) {
            throw "Docker Desktop 离线安装失败，退出码：$($DockerProcess.ExitCode)"
        }
    }
    else {
        $Winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($Winget) {
            & $Winget.Source install `
                --exact `
                --id Docker.DockerDesktop `
                --accept-package-agreements `
                --accept-source-agreements
            if ($LASTEXITCODE -ne 0) {
                throw "winget 安装 Docker Desktop 失败。"
            }
        }
        else {
            $Installer = Join-Path $env:TEMP "DockerDesktopInstaller.exe"
            Invoke-CurlDownload `
                -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" `
                -Destination $Installer
            $Signature = Get-AuthenticodeSignature -LiteralPath $Installer
            if ($Signature.Status -ne "Valid") {
                throw "Docker Desktop 安装程序数字签名无效。"
            }
            Start-Process `
                -FilePath $Installer `
                -ArgumentList @("install", "--user", "--backend=wsl-2") `
                -Wait
        }
    }
    $Docker = Get-DockerExecutable
}
if (-not $Docker) {
    throw "没有找到 Docker Desktop。请安装后重新运行脚本。"
}

$DockerDesktop = Get-DockerDesktopExecutable
if ($DockerDesktop -and -not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $DockerDesktop
}

Write-Host "正在等待 Docker Desktop Linux 引擎；首次启动时请在窗口中接受 Docker 条款。"
$DockerReady = $false
for ($Attempt = 0; $Attempt -lt 90; $Attempt++) {
    $ServerOs = & $Docker version --format "{{.Server.Os}}" 2>$null
    if ($LASTEXITCODE -eq 0 -and "$ServerOs".Trim().ToLowerInvariant() -eq "linux") {
        $DockerReady = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $DockerReady) {
    throw "Docker Linux 引擎未就绪。请打开 Docker Desktop、完成条款确认并切换到 Linux containers，然后重新运行脚本。"
}

Write-Step "安装或验证 SeamlessExpressive 模型"
if ($UsingImportedModel -and -not (Test-ModelDirectory -Directory $ModelDirectory)) {
    throw "引入目录缺少三个完整的 SeamlessExpressive checkpoint：$ModelDirectory"
}
if (-not $UsingImportedModel) {
    New-Item -ItemType Directory -Force -Path $ModelDirectory | Out-Null
    New-Item -ItemType Directory -Force -Path $DownloadDirectory | Out-Null
}

if (-not (Test-ModelDirectory -Directory $ModelDirectory)) {
    $DownloadedParts = @()
    foreach ($Part in $ArchiveParts) {
        if ($OfflinePayloadDirectory) {
            $PartPath = Get-OfflinePayloadPath -Name $Part
            Write-Host "使用离线模型分卷 $Part"
        }
        else {
            $PartPath = Join-Path $DownloadDirectory $Part
            $PartUri = "https://github.com/$ModelRepository/releases/download/$ReleaseTag/$Part"
            Write-Host "下载 $Part"
            Invoke-CurlDownload -Uri $PartUri -Destination $PartPath
        }
        $DownloadedParts += $PartPath
    }

    $ArchivePath = Join-Path $DownloadDirectory $ArchiveName
    Write-Host "合并模型分卷"
    Merge-BinaryFiles -Sources $DownloadedParts -Destination $ArchivePath

    Write-Host "校验完整归档 SHA-256"
    $ActualSha256 = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualSha256 -ne $ArchiveSha256) {
        throw "模型校验失败。期望 $ArchiveSha256，实际 $ActualSha256。下载分卷已保留，可重新执行继续下载。"
    }

    $ExtractDirectory = Join-Path $DownloadDirectory "extracted"
    if (Test-Path -LiteralPath $ExtractDirectory) {
        Remove-Item -LiteralPath $ExtractDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $ExtractDirectory | Out-Null

    Write-Host "解压模型"
    & tar.exe -xzf $ArchivePath -C $ExtractDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "模型解压失败。"
    }

    $CheckpointAliases = @{
        "m2m_expressive_unity.pt" = @("m2m_expressive_unity.pt")
        "pretssel_melhifigan_wm.pt" = @(
            "pretssel_melhifigan_wm.pt",
            "pretssel_melhifigan_wm-final.pt"
        )
        "pretssel_melhifigan_wm-16khz.pt" = @(
            "pretssel_melhifigan_wm-16khz.pt"
        )
    }
    foreach ($DestinationName in $CheckpointAliases.Keys) {
        $Source = $null
        foreach ($Alias in $CheckpointAliases[$DestinationName]) {
            $Source = Get-ChildItem `
                -LiteralPath $ExtractDirectory `
                -Recurse `
                -File `
                -Filter $Alias |
                Select-Object -First 1
            if ($Source) {
                break
            }
        }
        if (-not $Source) {
            throw "归档中缺少权重：$DestinationName"
        }
        Move-Item `
            -LiteralPath $Source.FullName `
            -Destination (Join-Path $ModelDirectory $DestinationName) `
            -Force
    }

    $LicenseSource = Get-ChildItem `
        -LiteralPath $ExtractDirectory `
        -Recurse `
        -File `
        -Filter "SEAMLESS_LICENSE" |
        Select-Object -First 1
    if ($LicenseSource) {
        Copy-Item `
            -LiteralPath $LicenseSource.FullName `
            -Destination (Join-Path $ModelDirectory "SEAMLESS_LICENSE") `
            -Force
    }

    if (-not (Test-ModelDirectory -Directory $ModelDirectory)) {
        throw "模型文件安装后验证失败。"
    }

    if (-not $KeepDownloadCache) {
        Remove-Item -LiteralPath $DownloadDirectory -Recurse -Force
    }
}

if (-not $UsingImportedModel) {
    foreach ($LegalFile in @("SEAMLESS_LICENSE", "NOTICE")) {
        $LegalPath = Join-Path $ModelDirectory $LegalFile
        if (-not (Test-Path -LiteralPath $LegalPath -PathType Leaf)) {
            if ($OfflinePayloadDirectory) {
                Copy-Item `
                    -LiteralPath (Get-OfflinePayloadPath -Name $LegalFile) `
                    -Destination $LegalPath `
                    -Force
            }
            else {
                Invoke-CurlDownload `
                    -Uri "https://github.com/$ModelRepository/releases/download/$ReleaseTag/$LegalFile" `
                    -Destination $LegalPath
            }
        }
    }

    $Marker = @{
        model_id = "seamless_expressive"
        repo_id = $ModelRepository
        release_tag = $ReleaseTag
    } | ConvertTo-Json
    [System.IO.File]::WriteAllText(
        (Join-Path $ModelDirectory ".voicebridge-model.json"),
        $Marker,
        $Utf8NoBom
    )
}

Write-Step "准备 SeamlessExpressive Sidecar"
$SidecarDirectory = Join-Path $DataDirectory "sidecar\0.6.3"
New-Item -ItemType Directory -Force -Path $SidecarDirectory | Out-Null
$SidecarFiles = @("Dockerfile", "requirements.txt", "app.py")
if (-not $OfflinePayloadDirectory) {
    foreach ($SidecarFile in $SidecarFiles) {
        $SidecarPath = Join-Path $SidecarDirectory $SidecarFile
        if (-not (Test-Path -LiteralPath $SidecarPath -PathType Leaf)) {
            $SidecarUri = "https://raw.githubusercontent.com/jiangheli/voicebridge-studio/v0.6.3/services/seamless-sidecar/$SidecarFile"
            Invoke-CurlDownload -Uri $SidecarUri -Destination $SidecarPath
        }
    }
}

$ExistingImage = & $Docker image inspect $ImageName --format "{{.Id}}" 2>$null
if ($LASTEXITCODE -ne 0 -or -not "$ExistingImage".Trim()) {
    if ($OfflinePayloadDirectory) {
        Write-Host "导入离线 GPU 推理镜像。"
        $ImageArchive = Get-OfflinePayloadPath `
            -Name "voicebridge-seamless-sidecar-amd64.tar"
        & $Docker load --input $ImageArchive
    }
    else {
        Write-Host "首次构建 GPU 推理镜像，通常需要 10–30 分钟。"
        & $Docker build --tag $ImageName $SidecarDirectory
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Sidecar Docker 镜像准备失败。"
    }
    $ExistingImage = & $Docker image inspect $ImageName --format "{{.Id}}" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not "$ExistingImage".Trim()) {
        throw "离线镜像中没有找到 $ImageName。"
    }
}

Write-Step "启动本机 GPU 推理服务"
$ExistingContainer = & $Docker ps -a --filter "name=^/$ContainerName$" --format "{{.Names}}"
if ("$ExistingContainer".Trim() -eq $ContainerName) {
    & $Docker rm --force $ContainerName | Out-Null
}

& $Docker run `
    --detach `
    --name $ContainerName `
    --restart unless-stopped `
    --gpus all `
    --publish "127.0.0.1:8787:8787" `
    --mount "type=bind,source=$ModelDirectory,target=/models/SeamlessExpressive,readonly" `
    $ImageName
if ($LASTEXITCODE -ne 0) {
    throw "GPU 容器启动失败。请检查 Docker Desktop 的 GPU/WSL2 支持和 NVIDIA 驱动。"
}

$Health = $null
for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
    try {
        $Health = Invoke-RestMethod `
            -Uri "$ServiceBase/health" `
            -Method Get `
            -TimeoutSec 3
        if ($Health.model_ready -and $Health.cuda_ready) {
            break
        }
    }
    catch {
        # Container is still starting.
    }
    Start-Sleep -Seconds 2
}
if (-not $Health -or -not $Health.model_ready -or -not $Health.cuda_ready) {
    & $Docker logs --tail 100 $ContainerName
    throw "Sidecar 健康检查失败。"
}

Write-Step "写入 VoiceBridge 本机配置"
New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $CacheDirectory | Out-Null

if (Test-Path -LiteralPath $SettingsPath -PathType Leaf) {
    try {
        $Settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
    }
    catch {
        $Settings = [PSCustomObject]@{}
    }
}
else {
    $Settings = [PSCustomObject]@{}
}

Set-JsonProperty -Object $Settings -Name "data_dir" -Value $DataDirectory
Set-JsonProperty -Object $Settings -Name "models_dir" -Value $ModelRoot
Set-JsonProperty -Object $Settings -Name "cache_dir" -Value $CacheDirectory
Set-JsonProperty -Object $Settings -Name "seamless_api_base" -Value $ServiceBase
Set-JsonProperty -Object $Settings -Name "seamless_api_key" -Value ""
if (-not ($Settings.PSObject.Properties.Name -contains "translation_api_base")) {
    Set-JsonProperty -Object $Settings -Name "translation_api_base" -Value ""
}
if (-not ($Settings.PSObject.Properties.Name -contains "translation_api_key")) {
    Set-JsonProperty -Object $Settings -Name "translation_api_key" -Value ""
}
if (-not ($Settings.PSObject.Properties.Name -contains "model_paths")) {
    Set-JsonProperty -Object $Settings -Name "model_paths" -Value ([PSCustomObject]@{})
}
Set-JsonProperty `
    -Object $Settings.model_paths `
    -Name "seamless_expressive" `
    -Value $ModelDirectory

$SettingsJson = $Settings | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($SettingsPath, $SettingsJson, $Utf8NoBom)

Write-Step "安装 VoiceBridge Studio"
$VoiceBridgeExecutable = Get-VoiceBridgeExecutable
if (-not $VoiceBridgeExecutable -and -not $SkipApplicationInstall) {
    if ($OfflinePayloadDirectory) {
        $ApplicationInstaller = Get-OfflinePayloadPath `
            -Name "VoiceBridge-Studio-Windows-x64.exe"
    }
    else {
        $ApplicationInstallerUri = "https://github.com/$ApplicationRepository/releases/download/v$ApplicationVersion/$ApplicationInstallerName"
        if ($LatestRelease) {
            $LatestInstallerAsset = $LatestRelease.assets |
                Where-Object {
                    $_.name -match "^VoiceBridge-Studio-[0-9]+\.[0-9]+\.[0-9]+-Windows-x64\.exe$"
                } |
                Select-Object -First 1
            $LatestInstallerSha256 = Get-AssetSha256 -Asset $LatestInstallerAsset
            if ($LatestInstallerAsset -and $LatestInstallerSha256) {
                $ApplicationVersion = "$($LatestRelease.tag_name)".TrimStart("v")
                $ApplicationInstallerName = $LatestInstallerAsset.name
                $ApplicationInstallerSha256 = $LatestInstallerSha256
                $ApplicationInstallerUri = $LatestInstallerAsset.browser_download_url
            }
        }
        $ApplicationDownloadDirectory = Join-Path $BootstrapDirectory "downloads"
        $ApplicationInstaller = Join-Path $ApplicationDownloadDirectory $ApplicationInstallerName
        Invoke-CurlDownload `
            -Uri $ApplicationInstallerUri `
            -Destination $ApplicationInstaller
    }

    $ActualInstallerSha256 = (
        Get-FileHash -LiteralPath $ApplicationInstaller -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    if ($ActualInstallerSha256 -ne $ApplicationInstallerSha256) {
        throw "VoiceBridge 安装包校验失败，已停止执行。"
    }

    $InstallerProcess = Start-Process `
        -FilePath $ApplicationInstaller `
        -ArgumentList "/S" `
        -Wait `
        -PassThru
    if ($InstallerProcess.ExitCode -ne 0) {
        throw "VoiceBridge Studio 安装失败，退出码：$($InstallerProcess.ExitCode)"
    }
    $VoiceBridgeExecutable = Get-VoiceBridgeExecutable
    if (-not $VoiceBridgeExecutable) {
        throw "安装程序已结束，但没有找到 VoiceBridge Studio。"
    }
    if (-not $OfflinePayloadDirectory) {
        Remove-Item -LiteralPath $ApplicationInstaller -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "安装完成。" -ForegroundColor Green
Write-Host "GPU: $($Health.gpu_name)"
Write-Host "模型目录: $ModelDirectory"
Write-Host "服务地址: $ServiceBase"
Write-Host "配置文件: $SettingsPath"
Write-Host ""
if ($VoiceBridgeExecutable) {
    Write-Host "正在启动 VoiceBridge Studio。"
    Start-Process -FilePath $VoiceBridgeExecutable
    Write-Host "进入 [模型与运行]，点击 [刷新环境]。"
    Write-Host "然后进入 [快速直译]，选择中文媒体并开始生成英文 WAV。"
}
else {
    Write-Host "已跳过 VoiceBridge Studio 安装。"
}
