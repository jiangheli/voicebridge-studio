# 视频硬字幕与文字水印清理

## 能力边界

“视频清理”页集成
[video-subtitle-remover 1.4.0](https://github.com/YaoFANGUK/video-subtitle-remover/releases/tag/1.4.0)
的文字检测和 STTN 视频修复能力，支持：

- 中文硬字幕；
- 英文硬字幕；
- 中英混合字幕；
- 固定位置的文字水印；
- 全画面文字自动检测。

PaddleOCR 组件只输出文字区域，不负责识别文字内容，因此中文和英文共用
同一套检测模型。“中文 / English / 自动”用于记录任务意图和质量验收，
不会重复下载模型。

不处理播放器可开关的 SRT、ASS 或 WebVTT 软字幕；这类字幕应直接删除或
替换字幕轨，不应修复视频像素。

## Windows 运行方式

模型和 Python/CUDA 依赖位于固定摘要的上游 Docker 镜像中，不写入
VoiceBridge EXE：

| 显卡 | 镜像变体 | OCI 索引摘要 | 下载估算 |
| --- | --- | --- | ---: |
| RTX 10/20/30 | CUDA 11.8 | `sha256:a09797f…380135` | 6.1 GB |
| RTX 40 | CUDA 12.6 | `sha256:e58f9854…ae76a` | 6.4 GB |
| RTX 50 | CUDA 12.8 | `sha256:7a9c720c…be99a` | 7.3 GB |

GUI 根据 `nvidia-smi` 返回的显卡名称自动选择，也允许手动覆盖。下载必须
由用户点击“预下载运行资源”触发。Docker 按层保存已完成内容，中断后再次
点击可以复用已有层。

创建任务使用相同的固定镜像引用，并带有：

```text
docker run --pull never --gpus all …
```

因此处理阶段不会隐式联网或改用同名的新镜像。当前不承诺 CPU 模式：
上游 1.4.0 的 CPU 镜像构建配置无法确认，且长视频在 CPU 上不具备可接受
的生产速度。

## 三种清理方式

### 硬字幕

- 手动选区：只检测框选区域中的文字，适合底部字幕；
- 全画面自动：检测所有文字，可能同时移除标牌、片头和演职员表；
- 修复模式：`sttn-det`。

### 文字水印

- 必须手动框选，最多 8 个区域；
- 选区会在所有帧上持续修复；
- 修复模式：`sttn-auto`。

水印模式禁止无选区运行。上游在空选区时会把整个画面当作修复区域，
VoiceBridge 在 API 层拒绝这种危险请求。

### 全画面文字

- 使用文字检测后再修复，而不是整帧生成；
- 修复模式：`sttn-det`；
- 适合需要清理标题、字幕和画面文字的素材；
- 必须人工抽检误删和纹理重建质量。

## 文件和音轨策略

```text
源视频（只读挂载）
  → VSR 生成临时无文字视频
  → VoiceBridge FFmpeg 重新挂载源视频音轨
  → 校验分辨率与时长
  → %LOCALAPPDATA%\VoiceBridge\outputs\cleaned\*_cleaned_*.mp4
```

- 永不覆盖源文件；
- 优先无损复制原音轨，不兼容时回退到 AAC 192 kbps；
- 输出分辨率必须与源视频显示分辨率一致；
- 输出时长与源视频允许的差异为 2 秒或 5%，取较大值；
- 同一时间只运行一个清理任务，避免 GPU 显存溢出；
- 退出应用会停止当前下载和清理容器。

## API

```http
GET  /api/v1/video-cleanup/runtime
POST /api/v1/video-cleanup/runtime/prepare
POST /api/v1/video-cleanup/runtime/cancel
POST /api/v1/video-cleanup/inspect
GET  /api/v1/video-cleanup/previews/{inspection_id}
POST /api/v1/video-cleanup/jobs
GET  /api/v1/video-cleanup/jobs/{job_id}
POST /api/v1/video-cleanup/jobs/{job_id}/cancel
```

选区使用 `0..1` 归一化坐标，由后端根据实际显示分辨率转换成
`YMIN YMAX XMIN XMAX`。后端限制绝对本地文件、受支持的视频扩展名、50 GB
最大文件和 8 个选区，不接受客户端指定输出路径或容器名称。

## 验收素材

发布前至少在 Windows NVIDIA 电脑验证：

1. 中文白字黑边底部字幕；
2. 英文两行字幕；
3. 同时包含中文和英文的字幕；
4. 静态右上文字水印；
5. 运动背景、镜头切换和人物遮挡；
6. 横屏、竖屏和带旋转元数据的视频；
7. AAC、Opus 和无音轨输入；
8. 下载中断、继续、任务取消和应用退出；
9. 自动模式对路牌、片头和演职员表的误删风险。

Windows GitHub Runner 不能提供 Docker Desktop NVIDIA GPU，因此 CI 只验证
命令安全合同、选区换算、API、桌面 IPC 和安装包；最终画质必须在真实
NVIDIA 机器上签收。
