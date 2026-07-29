# SeamlessExpressive 快速链路

## 架构决定

SeamlessExpressive 用一步 speech-to-speech 推理缩短预览流程：

```text
Windows GUI / EXE
→ 本地 FFmpeg 转 16 kHz 单声道 WAV
→ 本机 WSL2 Docker 或远程 Linux GPU sidecar
→ expressivity_predict（UnitY2 + PRETSSEL）
→ 英文表达式语音 WAV
→ Windows 本地 outputs 目录
```

官方 Seamless Communication 依赖 `fairseq2`。官方预编译包支持 Linux
x86-64 和 Apple Silicon，不支持 Windows x64，因此 v0.4 不把推理运行时
伪装成 Windows 原生能力。Windows 安装包保持自包含 GUI；实际
SeamlessExpressive 推理由 Linux GPU sidecar 执行。这个 Linux 环境可以
位于独立服务器，也可以由 EXE 在同一台 Windows NVIDIA 电脑的 Docker
Desktop / WSL2 中管理。

## 私有模型仓库

模型源：

```text
RSXLX/voicebridge-models-private
release: seamless-expressive-2023-11-29
archive: SeamlessExpressive.tar.gz
SHA-256: 2cd92745b5f16587bd249829cf528afa455b073ac5fa5e182969953a7b255d07
```

Release 由两个小于 GitHub 单资产限制的分卷组成。Windows GUI 的模型中心
支持：

1. 用户粘贴具有私有仓库读取权限的 GitHub token；
2. token 仅进入下载子进程环境，不写入设置、参数或日志；
3. 对每个分卷使用 HTTP Range 继续下载；
4. 合并后校验完整归档 SHA-256；
5. 拒绝绝对路径、`..`、符号链接、硬链接和设备文件；
6. 仅提取并验证三个 checkpoint；
7. 成功后删除临时归档和分卷，保留模型文件。

最终目录：

```text
SeamlessExpressive/
├── m2m_expressive_unity.pt
├── pretssel_melhifigan_wm.pt
├── pretssel_melhifigan_wm-16khz.pt
└── .voicebridge-model.json
```

也可以通过“引入”选择已经包含上述三个完整文件的目录。

## Windows 本机部署

v0.5 起，EXE 的“模型与运行”页提供四阶段检测：

```text
NVIDIA 驱动 → WSL2 → Docker Linux Engine → Expressive 容器
```

GUI 可以请求启用 WSL2，并通过 `winget` 启动 Docker Desktop 安装。系统
级安装始终显示管理员确认，可能要求重启。环境就绪后，点击“启动本机 GPU
服务”，EXE 会：

1. 验证三个 checkpoint；
2. 从安装包内的 sidecar 资源构建固定镜像；
3. 使用 `--gpus all` 启动容器；
4. 将模型目录只读挂载；
5. 只绑定 `127.0.0.1:8787`；
6. 检查模型和 CUDA 健康状态；
7. 自动保存本机 sidecar 地址。

## 独立 Linux 主机部署

实现位于 `services/seamless-sidecar/`。在 Linux NVIDIA 主机执行：

```bash
cd services/seamless-sidecar
docker build -t voicebridge-seamless-sidecar .
docker run --rm --gpus all -p 127.0.0.1:8787:8787 \
  -e VOICEBRIDGE_SIDECAR_API_KEY='replace-me' \
  -v /srv/voicebridge/models/SeamlessExpressive:/models/SeamlessExpressive:ro \
  voicebridge-seamless-sidecar
```

然后在 Windows GUI 的“模型与运行”中配置：

```text
SeamlessExpressive Sidecar 地址: http://127.0.0.1:8787
Sidecar API Key: replace-me
```

跨机器部署应使用可信局域网、VPN 或带 TLS 的反向代理，不能把未保护的
sidecar 直接暴露到公网。

## API

Windows 本地 API：

```http
GET  /api/v1/expressive/status
POST /api/v1/expressive/jobs
GET  /api/v1/expressive/jobs/{job_id}
```

Sidecar：

```http
GET  /health
POST /v1/translate?target_language=eng
Content-Type: audio/wav
Authorization: Bearer <optional key>
```

## 能力边界

- 当前只开放普通话到英文；
- 输出是英文语音 WAV；
- 快速链路不生成逐句可编辑字幕；
- 快速链路不执行背景音分离与回混；
- 需要事实复核、字幕或背景保留时，应使用可控级联链路；
- 模型和输出的使用必须遵守 Meta Seamless License 与 acceptable-use
  policy。
