# 中文语音 → 英文原声配音开发方案

## 1. 架构结论

项目使用可控级联架构，不依赖需要人工审批的端到端模型：

```text
中文 Voice In
      ↓
中文 ASR + 说话人信息
      ↓
上下文、实体和术语约束翻译
      ↓
CosyVoice 3 跨语言声音克隆
      ↓
英文 Voice Candidate
      ↓
英文反识别 + 内容 / 音色 / 时长质量闸门
      ↓
通过 ───────────────→ 混音与交付
      │
      └─ 不通过 → 修改译文或使用 Qwen3-TTS 生成备用候选
```

系统将“说什么”和“怎么说”拆开：

- Qwen3-ASR 提供源中文和目标英文的可检查文本；
- 翻译层保证事实、术语、数字和否定关系准确；
- CosyVoice 3 负责用原说话人的声音生成英文；
- Qwen3-TTS 提供独立的备用声音候选；
- 质量闸门决定候选能否进入最终时间线。

## 2. 产品范围

### 输入

- WAV、MP3、M4A 中文音频；
- MP4、MOV 中文视频；
- 单人讲话或多人采访；
- 普通话为主，可包含背景音乐与环境音。

### 输出

```text
output/
├── translated_voice.wav
├── translated_video.mp4
├── source_transcript.json
├── target_transcript.json
├── subtitles/
│   ├── target.en.srt
│   ├── bilingual.zh-en.srt
│   └── target.en.vtt
├── quality_report.json
├── review_segments.json
└── segments/
    ├── seg_0001_source.wav
    └── seg_0001_target.wav
```

### 质量目标

| 维度 | 目标 |
| --- | --- |
| 翻译准确 | 不漏译、不增译，不改变数字、否定、时间和因果 |
| 英文自然 | 符合英语口语，不做中文句法直译 |
| 音色保留 | 英文听感保持原说话人的主要声音特征 |
| 表达保留 | 通过参考片段、速度和情绪指令保留表达倾向 |
| 时间轴可用 | 不截断、不抢话，匹配原片段时间槽 |
| 可复核 | 可查看源中文、锁定英文和风险原因 |
| 可恢复 | 任意片段可以修改译文或更换 TTS 路线 |

## 3. 最小模型组合

### 3.1 语音识别

首版选择：

```text
Qwen3-ASR-0.6B
```

同一模型同时用于：

- 中文原音识别；
- 英文候选反识别；
- 中英文语言检测。

对复杂背景、专业内容或高准确率场景，可替换为 Qwen3-ASR-1.7B。调用方契约保持不变。

### 3.2 翻译

翻译层支持两种配置：

```text
方案 A：TRANSLATION_API_BASE
方案 B：QWEN_TRANSLATION_MODEL_DIR
```

首版可以使用已存在的大模型 API，避免增加本地权重。完全离线时再接入支持中英翻译的本地指令模型。

翻译输入必须包含：

- 当前中文片段；
- 前后片段上下文；
- 说话人信息；
- 项目术语表；
- 实体、数字、日期与否定标记；
- 目标时长。

### 3.3 主声音生成

```text
Fun-CosyVoice3-0.5B
```

用途：

- 中文参考语音到英文的跨语言声音克隆；
- 速度、情绪和音量指令；
- 数字、专名和音素级发音控制；
- 流式或批量生成。

### 3.4 备用声音生成

```text
Qwen3-TTS Base
```

当 CosyVoice 3 出现音色、稳定性或发音问题时，生成独立候选供人工比较。它不是内容翻译器，只接收已经锁定的英文文本。

### 3.5 首版不需要

- 强制对齐模型；
- 严格时长专用 TTS；
- XCOMET / BLASER；
- 默认人声分离；
- 默认说话人分离。

这些能力在真实验证集暴露明确问题后再加入。

## 4. 九阶段流水线

```text
01 预处理       音频标准化与输入质量检测
02 音源分离     仅在强背景音乐时分离人声
03 语义分段     VAD、标点、语义和说话人边界
04 中文识别     Qwen3-ASR
05 可控翻译     上下文、术语、实体和目标时长
06 声音克隆     CosyVoice 3
07 英文反识别   Qwen3-ASR
08 质量闸门     内容、音色、节奏和时长
09 混音输出     时间线、ducking、响度和视频封装
```

Qwen3-TTS 不占固定阶段；它是阶段 06 的备用生成器。

### 背景音保留是不变量

系统不能用英文人声覆盖整条原始音轨。原始音频始终保留为只读母版：

```text
原始音轨
├── vocals.wav       → 识别、翻译、英文声音克隆
└── background.wav   → 原样进入最终混音

英文人声 + background.wav
→ 人声出现时动态 ducking
→ 峰值限制与响度标准化
→ 最终英文音轨
```

- 有背景音乐或明显环境声时，分离人声与背景轨；
- 干净语音不强制分离，避免分离伪影；
- 无法可靠分离时，从原音提取 room tone，并将该片段标记为人工复核；
- 背景轨不得经过语音降噪链路；
- 动态 ducking 只在人声出现时适度压低背景，不能全局降低；
- 任何阶段失败都可以从只读原始音轨重新生成。

## 5. 音频处理规则

### 5.1 预处理

```bash
ffmpeg -i input.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le work/source_16k.wav
ffmpeg -i input.mp4 -map 0:v:0 -c:v copy -an work/video_only.mp4
```

检查削波、低音量、强背景音乐、混响、重叠说话和信噪比。干净语音不默认经过分离模型，避免引入齿音损伤和相位伪影。

### 5.2 分段

| 参数 | 初始值 |
| --- | ---: |
| 最短片段 | 1.5 秒 |
| 推荐片段 | 3～8 秒 |
| 最长片段 | 12 秒 |
| 前后静音 | 100～200ms |
| 重叠上下文 | 100～300ms |
| 说话人变化 | 强制切段 |

切分必须同时考虑静音、标点、语义完整性和说话人变化。

### 5.3 Voice Profile

每个说话人维护独立档案：

```json
{
  "speaker_id": "speaker_01",
  "reference_audio": [
    "speaker_01_clean_01.wav",
    "speaker_01_clean_02.wav"
  ],
  "primary_tts": "cosyvoice3",
  "secondary_tts": "qwen3_tts"
}
```

参考音频建议使用 10～30 秒有效语音，无其他说话人、无强背景音乐、音量稳定，并覆盖至少两种自然语气。

## 6. 翻译质量闸门

翻译输出结构：

```json
{
  "translation": "",
  "required_facts": [],
  "entities": [],
  "numbers": [],
  "uncertainties": [],
  "needs_review": false
}
```

必须通过的确定性规则：

- 数字、日期、金额、人名和产品名一致；
- 否定、条件和因果关系不允许翻转；
- 核心事实完整率不低于 95%；
- 英文候选反识别正确率不低于 95%；
- Critical 与 Major error 为 0。

以下错误直接阻断生成或进入人工复核：

```text
原文：旧版本不会停止维护
译文：The previous version will stop being maintained
结果：NEGATION_ERROR / critical
```

## 7. 声音与时间质量

初始阈值：

| 指标 | 阈值 |
| --- | ---: |
| 目标 / 原始时长比 | 0.90～1.10 |
| 说话风格相似度 | ≥0.75 |
| 语速匹配 | ≥0.80 |
| 停顿匹配 | ≥0.75 |
| 截断、重复、幻觉 | 0 |

时长路由：

| 比率 | 操作 |
| ---: | --- |
| 0.92～1.08 | 直接使用 |
| 0.85～0.92 | 放慢或增加自然停顿 |
| 1.08～1.15 | 轻微加速或重新生成 |
| >1.15 | 在不损失事实的前提下缩短译文 |
| <0.85 | 使用更完整表达或保留停顿 |

最终不变调变速控制在约 ±8% 内。禁止截断句尾、删除数字或否定、覆盖下一位说话人。

## 8. 核心数据结构

```ts
interface Segment {
  id: string;
  speakerId: string;
  startMs: number;
  endMs: number;
  sourceText: string;
  targetText: string;
  route: "cosyvoice3" | "qwen3_tts";
  status: "approved" | "review" | "processing";
  translationLocked: boolean;
  quality: {
    semantic: number;
    voice: number;
    timing: number;
    factsPassed: boolean;
  };
}
```

任务状态机：

```text
UPLOADED
→ PREPROCESSING
→ SEGMENTING
→ SOURCE_ASR
→ TRANSLATING
→ VOICE_CLONING
→ TARGET_ASR
→ QUALITY_GATE
→ MIXING
→ FINAL_REVIEW
→ COMPLETED
```

## 9. 桌面与服务架构

```text
Electron Desktop
├── React Renderer
└── FastAPI Local Service
    ├── Settings Store
    ├── Model Manager
    │   └── Resumable Download Worker
    └── Job Orchestrator（下一阶段）
        ├── Preprocess Worker
        ├── ASR / Translation Worker
        ├── CosyVoice / Qwen3-TTS Worker
        ├── Quality Worker
        └── Render Worker
```

Electron 和 API 服务不直接加载 GPU 权重。每个推理 Worker 只读取明确配置的本地模型目录。模型下载是独立的、必须由用户点击触发的系统能力。

| 模块 | 技术 |
| --- | --- |
| Windows GUI | Electron + React + TypeScript |
| 本地 API | FastAPI + PyInstaller |
| 本地配置 | JSON + platformdirs |
| 模型下载 | huggingface_hub cache + 独立进程 |
| 本地任务状态 | 当前 localStorage；后续 SQLite |
| 音频 | FFmpeg、torchaudio |
| 安装包 | electron-builder + NSIS |

PostgreSQL、Redis、对象存储和分布式队列仅在未来服务端多人部署时引入，Windows 单机版不预装这些基础设施。

## 10. API

```http
POST /api/v1/voice-translation/jobs
GET /api/v1/voice-translation/jobs/{job_id}/segments
PATCH /api/v1/voice-translation/segments/{segment_id}
POST /api/v1/voice-translation/segments/{segment_id}/regenerate
GET /api/v1/voice-translation/jobs/{job_id}/quality-report
GET /api/v1/voice-translation/jobs/{job_id}/subtitles?format=srt&track=target
GET /api/v1/models/readiness
POST /api/v1/models/{model_id}/download
POST /api/v1/models/{model_id}/pause
GET /api/v1/settings
PATCH /api/v1/settings
```

备用候选：

```json
{
  "route": "qwen3_tts",
  "candidate_count": 1,
  "target_duration_ms": 3470
}
```

## 11. 开发阶段

1. Qwen3-ASR 中文与英文识别验证；
2. 翻译 Prompt、术语表和确定性规则；
3. CosyVoice 3 单说话人中文参考到英文克隆；
4. Qwen3-TTS 备用候选与逐句比较；
5. 多说话人、背景音、时间线与最终视频。

当前仓库已完成不依赖权重的 Web 工作台、Windows Electron 外壳、fixture 流程、浏览器持久化、质量报告、SRT / WebVTT 字幕交付、本地配置、可暂停/续传模型下载和 NSIS 打包链路。真实推理 Worker 尚未接入。

## 12. 参考资料

- [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)
- [CosyVoice](https://github.com/FunAudioLLM/CosyVoice)
- [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)
