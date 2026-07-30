# Windows GUI、打包与本地目录

## 1. 进程结构

```text
VoiceBridge Studio.exe（Electron）
├── React Renderer
│   └── 只通过 HTTP 与 preload 白名单能力通信
├── voicebridge-api.exe（FastAPI / 127.0.0.1:8765）
├── voicebridge-api.exe download-worker（仅下载期间存在）
└── Docker Desktop / WSL2 sidecar（仅启用本机 GPU 时）
```

安装包还会在 `resources/runtime/` 携带经过 SHA-256 校验的 Windows x64 LGPL shared FFmpeg 及其 DLL。版本、哈希和对应源码记录在 `THIRD_PARTY_NOTICES.md`。目标电脑无需安装 Node、Python、Git、FFmpeg 或模型下载 CLI。

Electron 不直接加载模型。桌面壳负责窗口生命周期、白名单文件操作、本地
API，以及本机 sidecar 的环境检测、构建、启动和停止。所有系统命令使用
固定可执行文件与参数数组，不经过 shell 拼接用户路径。

## 2. 源码目录

```text
desktop/                 Electron main / preload
src/                     React renderer
server/                  FastAPI、配置、模型管理与下载 worker
config/models.json       模型清单
scripts/build-backend.ps1
.github/workflows/windows-package.yml
```

## 3. 开发环境

要求：

- Windows 10/11 x64；
- Node.js 22；
- Python 3.12；
- npm；
- Git（仅开发时需要）。

```powershell
npm install
python -m pip install -r server/requirements.txt pytest httpx
npm run dev:desktop
```

开发时 Electron 自动启动 `python -m server`。如果需要指定 Python：

```powershell
$env:VOICEBRIDGE_PYTHON = "C:\Python312\python.exe"
npm run dev:desktop
```

## 4. 生成安装包

```powershell
npm ci
npm run package:win
```

过程：

1. TypeScript 检查和 Vite 生产构建；
2. PyInstaller 将 FastAPI、Hugging Face Hub 客户端与模型清单打成单文件 EXE；
3. SeamlessExpressive sidecar 的 Dockerfile、服务代码和固定依赖清单进入 resources；
4. electron-builder 将 UI、Electron 壳和后端 EXE 写入 NSIS 安装包。

结果：

```text
release\VoiceBridge-Studio-0.5.0-Windows-x64.exe
```

安装器允许修改程序安装目录。模型不在程序目录内，升级或卸载程序不会自动删除模型目录。

## 5. 运行数据

```text
%LOCALAPPDATA%\VoiceBridge\
├── settings.json
├── logs\api.log
├── models\
└── cache\
```

程序目录和模型目录分离，原因：

- 普通用户不需要管理员权限；
- 大模型可以放到其他磁盘；
- 升级 GUI 不需要重新下载权重；
- 下载中断后 cache 仍然可用。

## 6. 本机 NVIDIA GPU

在“模型与运行 → 在这台 Windows 电脑运行”中依次完成：

1. 安装或引入 SeamlessExpressive checkpoint；
2. 检查兼容的 NVIDIA Windows 驱动；
3. 由 GUI 请求启用 WSL2，按系统提示重启；
4. 由 GUI 调用 Windows Package Manager 安装 Docker Desktop；
5. 启动 Docker Desktop 并切换为 WSL2 Linux containers；
6. 点击“启动本机 GPU 服务”。

首次启动会从 EXE resources 构建固定的
`voicebridge-seamless-sidecar:0.5.0` 镜像。容器只绑定
`127.0.0.1:8787`，并将 Windows checkpoint 目录只读挂载到
`/models/SeamlessExpressive`。容器使用 `--restart unless-stopped`，
Docker Desktop 重启后可恢复服务。

WSL2 和 Docker Desktop 是系统级能力，安装时需要用户确认管理员窗口，
部分机器需要重启。EXE 不静默安装显卡驱动，也不绕过 Docker Desktop 的
许可条款。

## 7. 干净 Windows 验收

支持目标：

- Windows 10/11 x64；
- 普通用户安装，不要求管理员权限；
- 未安装 Python、Node、Git、FFmpeg、CUDA Toolkit；
- 首次启动即可进入 GUI；
- 可通过 GUI 下载模型或引入已有仓库；
- 没有 NVIDIA GPU/驱动时进入 CPU 模式；
- 有兼容 NVIDIA 驱动时显示 GPU 候选模式。
- WSL2 / Docker 缺失时提供对应安装动作，不误报 sidecar 已就绪；
- 本机 sidecar 启动后快速直译自动改用 `http://127.0.0.1:8787`；
- 停止 sidecar 不删除镜像或 checkpoint。

应用不能打包或替代显卡驱动。GPU 推理依赖系统已有 NVIDIA 驱动；CUDA Toolkit 本身不要求用户单独安装，后续推理运行时应携带所需 CUDA DLL。

## 8. 发布前检查

```powershell
npm run build
npm run test:api
node --check desktop/main.cjs
npm run test:desktop
npm run package:win
```

还需在一台干净 Windows 机器验证：

- 首次启动和防火墙提示；
- 安装目录包含中文或空格；
- 模型目录位于非系统盘；
- 中文、英文和双语字幕可由常见 Windows 播放器正确识别；
- 下载暂停、退出、重启和继续；
- 网络断开后错误提示；
- 安装包升级后模型仍存在；
- NVIDIA 驱动、CUDA 与 CPU fallback 的运行提示。

## 9. 全新 Windows 裸机一键安装

普通用户优先下载并运行图形化安装程序：

```text
VoiceBridge-Studio-GPU-OneClick-Setup-0.5.0.exe
```

安装程序会自动请求管理员权限，显示安装进度和 PowerShell 详细日志。
WSL2 首次启用后，安装程序会询问是否立即重启；登录后自动继续余下步骤。

CMD 和 PowerShell 是图形安装器不可用时的备用入口。

不需要预装 Git、Python、Node.js、CUDA Toolkit、WSL、Docker Desktop
或 VoiceBridge Studio。下载 `scripts` 目录中的以下两个文件并放在同一
文件夹，然后双击 CMD：

```text
install-windows-bare-metal.cmd
install-windows-local-gpu.ps1
```

```bat
install-windows-bare-metal.cmd
```

CMD 会调用 Windows 自带的 PowerShell，PowerShell 再通过 UAC 自动申请
管理员权限。脚本将依次完成：

1. 检查 NVIDIA Windows 驱动；
2. 启用 WSL 和 Virtual Machine Platform；
3. 注册登录后续装任务，并在需要时提示重启；
4. 更新 WSL2，并设置默认版本为 2；
5. 下载、安装和启动 Docker Desktop；
6. 确认 Docker Server OS 为 `linux`；
7. 下载、合并、校验并解压 SeamlessExpressive checkpoint；
8. 构建并以 `--gpus all` 启动 Sidecar；
9. 检查 CUDA、模型和 HTTP 健康状态；
10. 下载并校验 VoiceBridge Studio 0.5.0 安装包，静默安装并启动；
11. 写入模型目录和 `http://127.0.0.1:8787` 服务地址。

如果只拿到了 CMD，CMD 会尝试从公开 GitHub 仓库下载 PowerShell 主脚本。
也可以直接执行 PowerShell 主脚本：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows-local-gpu.ps1
```

脚本会自行请求管理员权限。首次启用 WSL2 后会要求重启；选择立即重启或
手动重启均可。登录后安装器会自动续装并再次显示 UAC。模型默认优先写入
`D:\VoiceBridge\Models`，没有 D 盘时写入
`%LOCALAPPDATA%\VoiceBridge\models`。也可以手动指定：

```powershell
.\scripts\install-windows-local-gpu.ps1 -ModelRoot "E:\VoiceBridge\Models"
```

如果三个 checkpoint 已在磁盘中，可直接引入，不复制权重：

```powershell
.\scripts\install-windows-local-gpu.ps1 `
  -ImportModelDirectory "E:\Models\SeamlessExpressive"
```

脚本不会自动接受 Docker Desktop 的许可条款。Docker Desktop 第一次启动
时需要用户在官方窗口中阅读并确认；确认后脚本会继续等待 Linux 引擎。

裸机仍须满足不可由通用脚本代替的硬件条件：x64 Windows 10/11、BIOS/UEFI
已开启 CPU 虚拟化、NVIDIA GPU、足够的显存和磁盘空间。如果没有 NVIDIA
驱动，脚本会打开 NVIDIA 官方页面；按显卡型号安装最新 Windows 驱动并
重启后，再次双击 CMD 即可继续。
