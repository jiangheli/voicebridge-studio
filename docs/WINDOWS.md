# Windows GUI、打包与本地目录

## 1. 进程结构

```text
VoiceBridge Studio.exe（Electron）
├── React Renderer
│   └── 只通过 HTTP 与 preload 白名单能力通信
├── voicebridge-api.exe（FastAPI / 127.0.0.1:8765）
└── voicebridge-api.exe download-worker（仅下载期间存在）
```

安装包还会在 `resources/runtime/` 携带经过 SHA-256 校验的 Windows x64 LGPL shared FFmpeg 及其 DLL。版本、哈希和对应源码记录在 `THIRD_PARTY_NOTICES.md`。目标电脑无需安装 Node、Python、Git、FFmpeg 或模型下载 CLI。

Electron 不加载模型，也不执行音频推理。桌面壳只负责窗口生命周期、选择目录、打开本地路径和启动/停止 API。

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
3. electron-builder 将 UI、Electron 壳和后端 EXE 写入 NSIS 安装包。

结果：

```text
release\VoiceBridge-Studio-0.3.0-Windows-x64.exe
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

## 6. 干净 Windows 验收

支持目标：

- Windows 10/11 x64；
- 普通用户安装，不要求管理员权限；
- 未安装 Python、Node、Git、FFmpeg、CUDA Toolkit；
- 首次启动即可进入 GUI；
- 可通过 GUI 下载模型或引入已有仓库；
- 没有 NVIDIA GPU/驱动时进入 CPU 模式；
- 有兼容 NVIDIA 驱动时显示 GPU 候选模式。

应用不能打包或替代显卡驱动。GPU 推理依赖系统已有 NVIDIA 驱动；CUDA Toolkit 本身不要求用户单独安装，后续推理运行时应携带所需 CUDA DLL。

## 7. 发布前检查

```powershell
npm run build
npm run test:api
node --check desktop/main.cjs
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
