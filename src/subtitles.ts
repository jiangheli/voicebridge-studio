import type { Segment } from "./types";

export type SubtitleFormat = "srt" | "vtt";
export type SubtitleTrack = "target" | "bilingual" | "source";

function parseClock(value: string) {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`invalid_subtitle_timestamp:${value}`);
  }
  const seconds = parts.pop() ?? 0;
  const minutes = parts.pop() ?? 0;
  const hours = parts.pop() ?? 0;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function timestamp(milliseconds: number, separator: "," | ".") {
  const safe = Math.max(0, milliseconds);
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

function cueText(segment: Segment, track: SubtitleTrack) {
  const source = segment.source.replaceAll("\r", "").trim();
  const target = segment.target.replaceAll("\r", "").trim();
  if (track === "source") return source;
  if (track === "bilingual") return `${source}\n${target}`;
  return target;
}

export function serializeSubtitles(
  segments: Segment[],
  format: SubtitleFormat,
  track: SubtitleTrack,
) {
  const cues: string[] = [];
  for (const segment of segments) {
    const start = parseClock(segment.start);
    const end = parseClock(segment.end);
    if (end <= start) throw new Error(`invalid_segment_timing:${segment.id}`);
    const text = cueText(segment, track);
    if (!text) continue;
    const separator = format === "srt" ? "," : ".";
    const timing = `${timestamp(start, separator)} --> ${timestamp(end, separator)}`;
    cues.push(
      format === "srt"
        ? `${cues.length + 1}\n${timing}\n${text}`
        : `${segment.id.replaceAll(" ", "")}\n${timing}\n${text}`,
    );
  }
  const body = `${cues.join("\n\n")}${cues.length ? "\n" : ""}`;
  return format === "vtt" ? `WEBVTT\n\n${body}` : `\ufeff${body}`;
}

export function subtitleFilename(
  sourceFilename: string,
  format: SubtitleFormat,
  track: SubtitleTrack,
) {
  const base = sourceFilename.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*]/g, "_");
  const language = track === "source" ? "zh" : track === "target" ? "en" : "zh-en";
  return `${base}.${language}.${format}`;
}
