# 模型下载与接入

## 1. 当前模型清单

| ID | 官方仓库 | 用途 | 首版 |
| --- | --- | --- | --- |
| `qwen3_asr` | `Qwen/Qwen3-ASR-0.6B` | 中文 ASR 与英文反识别，共用一份权重 | 必需 |
| `translation_provider` | OpenAI 兼容 API | 可控中英翻译 | 必需配置 |
| `cosyvoice3` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` | 主声音克隆 | 必需 |
| `qwen3_tts` | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | 备用声音候选 | 可选 |
| `qwen3_translation` | `Qwen/Qwen3-4B-Instruct-2507` | 完全本地翻译 | 可选 |
| `qwen3_aligner` | `Qwen/Qwen3-ForcedAligner-0.6B` | 词级时间戳和严格对齐 | 可选 |

模型仓库元数据位于 `config/models.json`。其中体积是用于 GUI 进度展示的估算值，安装完成后的本地实际体积可能不同。

## 2. 最小可运行配置

推荐先走翻译 API：

```text
Qwen3-ASR 0.6B（下载）
Translation Provider（填写 API 地址）
CosyVoice 3（下载）
```

Qwen3-ASR 同时完成正向中文识别和英文反识别，不需要下载两份。Qwen3-TTS 仅在 CosyVoice 候选失败时使用。

## 3. Windows 本地目录

默认目录由 `platformdirs` 解析：

```text
%LOCALAPPDATA%\VoiceBridge\
├── settings.json
├── models\
└── cache\
```

模型目录和缓存目录可以在 GUI 中改到其他磁盘。`VOICEBRIDGE_DATA_DIR` 可覆盖整个数据根目录，旧版环境变量仍可作为手动模型路径：

```text
QWEN_ASR_MODEL_DIR
COSYVOICE_MODEL_DIR
QWEN_TTS_MODEL_DIR
QWEN_TRANSLATION_MODEL_DIR
QWEN_ALIGNER_MODEL_DIR
TRANSLATION_API_BASE
```

### 引入已有仓库

Windows GUI 中的“引入”按钮只记录已有模型目录，不复制权重：

1. 选择仓库根目录；
2. 检查模型配置文件；
3. 检查与模型类型匹配的权重文件；
4. 拒绝小于 1MB 的 Git LFS 指针或不完整权重；
5. 将绝对路径写入 `settings.json` 的 `model_paths`；
6. 解除引入时只删除路径引用，不删除仓库。

Qwen 系列需要 `config.json` 和实际权重；CosyVoice 需要 `cosyvoice.yaml`/`config.yaml` 以及 `llm.pt`、`flow.pt` 或 `hift.pt`。

## 4. 断点续传

下载器不在 API 进程中直接传输大文件：

```text
GUI 点击安装
→ POST /api/v1/models/{id}/download
→ API 启动独立 download-worker
→ huggingface_hub.snapshot_download
→ 模型目录 + Hugging Face cache
```

- 暂停：终止 worker，保留模型目录中的临时内容和 cache；
- 继续：使用相同仓库、目标目录与 cache 重启 worker；
- 应用退出：下载进程随本地 API 退出，缓存不删除；
- 安装完成：写入 `.voicebridge-model.json` 标记；
- 启动检查：只读本地标记和配置，不访问网络。

Hugging Face Hub 的缓存负责分块复用和已有文件校验。网络中断后可直接点击“继续”。

## 5. API

```http
GET   /api/v1/models/readiness
POST  /api/v1/models/{model_id}/download
POST  /api/v1/models/{model_id}/pause
POST  /api/v1/models/{model_id}/import
POST  /api/v1/models/{model_id}/unlink
GET   /api/v1/settings
PATCH /api/v1/settings
GET   /api/v1/runtime
```

响应中的关键字段：

```json
{
  "id": "qwen3_asr",
  "required": true,
  "downloadable": true,
  "configured": false,
  "state": "paused",
  "progress": 42,
  "local_path": "D:\\VoiceBridgeModels\\Qwen3-ASR-0.6B"
}
```

`state` 取值为 `not_installed`、`queued`、`downloading`、`paused`、`installed` 或 `failed`。

## 6. 下载策略

1. 启动、打开项目和创建翻译任务均不得触发下载；
2. 只有显式点击“安装/继续”才允许联网；
3. `MODEL_DOWNLOAD_DISABLED=1` 可完全禁用下载接口；
4. 不提供“删除模型”接口，避免误删大体积本地数据；
5. 私有或受限仓库后续通过用户令牌接入，令牌不得写入日志；
6. 模型安装完成不等于推理适配完成，两者必须分别显示状态。

## 7. 真实推理适配顺序

1. Qwen3-ASR 中文与英文识别；
2. 翻译 API、术语表与事实校验；
3. CosyVoice 3 单说话人中文参考到英文克隆；
4. Qwen3-TTS 备用候选；
5. ForcedAligner、多说话人和严格时间线；
6. 音源分离、背景回混和最终视频封装。

每一步都先用小规模中文验证集检查准确率、延迟、显存、声音相似度和失败模式。
