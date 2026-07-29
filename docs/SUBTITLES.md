# 字幕交付规范

## 1. 输出文件

每个完成复核的任务可以生成：

```text
subtitles/
├── <source>.en.srt       英文字幕
├── <source>.zh-en.srt    中文在上、英文在下
├── <source>.zh.srt       中文原文字幕
└── <source>.en.vtt       Web 播放器字幕
```

GUI 可组合选择字幕轨和格式，所以中文与双语内容同样可以导出为 WebVTT。

## 2. 时间码来源

字幕必须复用任务片段的 `start_ms` 和 `end_ms`，不得根据生成后文本长度重新估算：

```text
识别/分段时间线
→ 人工修改并锁定译文
→ TTS 候选与时间质量检查
→ 字幕序列化
```

如果后续 TTS 调整导致片段边界变化，应先更新任务时间线，再重新生成字幕、质量报告和最终媒体。

## 3. 交付闸门

- 任一片段为 `review` 或 `processing` 时禁止导出最终字幕；
- 只有所有片段为 `approved` 时允许下载；
- 字幕文本使用已锁定的 `target_text`；
- 中英双语轨固定为中文在上、英文在下；
- 空字幕片段不输出；
- 结束时间必须大于开始时间，否则字幕生成失败。

## 4. 编码与格式

### SRT

- UTF-8；
- 文件开头带 UTF-8 BOM，改善 Windows 播放器的中文编码识别；
- 时间格式为 `HH:MM:SS,mmm`；
- MIME：`application/x-subrip`。

### WebVTT

- UTF-8；
- 第一行为 `WEBVTT`；
- 时间格式为 `HH:MM:SS.mmm`；
- 每个 cue 使用片段 ID；
- MIME：`text/vtt`。

## 5. API

```http
GET /api/v1/voice-translation/jobs/{job_id}/subtitles
    ?format=srt|vtt
    &track=source|target|bilingual
```

未完成复核：

```json
{
  "detail": "subtitles_require_approved_segments"
}
```

响应通过 `Content-Disposition` 提供下载文件名。

## 6. 外挂与压制

首版默认交付外挂字幕，不修改视频画面，优点是：

- 可关闭或替换字幕；
- 可同时交付英文和双语版本；
- 修改错字不需要重新编码视频；
- 不影响原视频清晰度。

需要硬字幕时，在最终渲染阶段使用已批准的 SRT/ASS 文件进行压制。硬字幕属于视频渲染能力，不改变字幕文本和时间码的来源。
