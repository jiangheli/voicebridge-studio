# VoiceBridge Studio

中文语音转英文原声配音的 Windows 桌面工作台。界面使用 React，桌面壳使用 Electron，本地 API 使用 FastAPI；模型权重不打进安装包，由用户在“模型与运行”页明确安装。

系统同时提供两条路线：

```text
快速链路
中文语音 → SeamlessExpressive Linux GPU Sidecar → 英文表达式语音 WAV

可控链路
中文语音
→ Qwen3-ASR
→ 上下文与术语约束翻译
→ CosyVoice 3 跨语言声音克隆
→ Qwen3-ASR 英文反识别
→ 内容、音色和时长质量闸门
→ 背景轨回混与视频输出
```

## 当前状态

- Web 工作台、任务记录、分段审校和质量报告；
- 审校通过后导出英文、中文或中英双语 SRT / WebVTT；
- Windows Electron GUI 与本地 FastAPI 子进程；
- 模型目录、缓存目录和翻译 API 本地配置；
- 用户触发的模型安装、暂停与断点续传；
- 从 `RSXLX/voicebridge-models-private` 私有 Release 安装 SeamlessExpressive 分卷，支持 Range 续传、合并哈希校验和安全解压；
- “快速直译”独立页面和 Linux GPU SeamlessExpressive sidecar；
- 从已有 Hugging Face / ModelScope 仓库目录直接引入模型；
- 自带 FFmpeg，并自动检测 NVIDIA 驱动或使用 CPU 模式；
- Windows PyInstaller 后端和 NSIS 安装包脚本；
- 可控链路仍是 `fixture_no_download`；SeamlessExpressive 快速链路已接入真实 sidecar API 合同。

启动应用不会自动下载模型。点击安装后才会启动独立下载进程；暂停和退出不会删除下载缓存。私有 GitHub token 只通过子进程环境传递，不写入本地设置、命令行参数或日志。

## 最小模型

使用翻译 API 时，本地只需下载：

1. `Qwen/Qwen3-ASR-0.6B`
2. `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`

翻译 API 是第三个必需配置项，但不是模型文件。Qwen3-TTS、本地 Qwen3 翻译模型和 ForcedAligner 均为可选项。

快速链路只需要 SeamlessExpressive sidecar 在线。官方 `fairseq2` 没有 Windows x64 预编译包，因此实际推理运行在 Linux GPU 服务；Windows EXE 负责媒体预处理、提交、状态轮询和结果接收。

## 本地开发

```bash
npm install
python -m pip install -r server/requirements.txt pytest httpx
npm run dev:desktop
```

- Web：`http://127.0.0.1:4173`
- 本地 API：`http://127.0.0.1:8765`
- API 文档：`http://127.0.0.1:8765/docs`

也可以分别运行：

```bash
python -m server
npm run dev
```

## 构建与测试

```bash
npm run build
python -m pytest server -q
node --check desktop/main.cjs
```

Windows x64 安装包必须在 Windows 环境构建：

```powershell
npm ci
npm run package:win
```

输出位于 `release/VoiceBridge-Studio-*-Windows-x64.exe`。仓库中的 GitHub Actions 工作流也可执行同一构建。

目标安装包面向干净的 Windows 10/11 x64：运行端不需要 Node、Python、Git、FFmpeg、Hugging Face CLI 或管理员权限。NVIDIA 驱动是 GPU 模式唯一的系统级前置条件；没有兼容驱动时使用 CPU 模式。

## 文档

- [完整开发方案](docs/DEVELOPMENT.md)
- [模型下载与接入](docs/MODEL_INTEGRATION.md)
- [Windows 打包与本地目录](docs/WINDOWS.md)
- [字幕交付规范](docs/SUBTITLES.md)
- [SeamlessExpressive 快速链路](docs/SEAMLESS_EXPRESSIVE.md)

## 安全边界

- 下载必须由用户点击触发；
- Electron 使用上下文隔离、关闭 Node 集成并限制导航；
- API 只监听 `127.0.0.1`；
- 下载进程与桌面窗口、API 进程分离；
- 原始媒体和背景轨按只读母版处理；
- 私有仓库 token 不持久化；
- 快速链路只返回英文语音 WAV，不冒充已完成背景回混或字幕审校；
- 当前 fixture 结果不会冒充真实模型推理。
