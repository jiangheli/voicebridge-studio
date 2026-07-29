from __future__ import annotations

from typing import Iterable, Literal, Protocol


SubtitleFormat = Literal["srt", "vtt"]
SubtitleTrack = Literal["source", "target", "bilingual"]


class SubtitleSegment(Protocol):
    id: str
    start_ms: int
    end_ms: int
    source_text: str
    target_text: str


def _timestamp(milliseconds: int, separator: str) -> str:
    hours, remainder = divmod(max(0, milliseconds), 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}{separator}{millis:03d}"


def _clean(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n").strip()


def _cue_text(segment: SubtitleSegment, track: SubtitleTrack) -> str:
    source = _clean(segment.source_text)
    target = _clean(segment.target_text)
    if track == "source":
        return source
    if track == "bilingual":
        return f"{source}\n{target}"
    return target


def render_subtitles(
    segments: Iterable[SubtitleSegment],
    subtitle_format: SubtitleFormat,
    track: SubtitleTrack,
) -> str:
    cues: list[str] = []
    for segment in segments:
        if segment.end_ms <= segment.start_ms:
            raise ValueError(f"invalid_segment_timing:{segment.id}")
        text = _cue_text(segment, track)
        if not text:
            continue
        cue_number = len(cues) + 1
        if subtitle_format == "srt":
            timing = (
                f"{_timestamp(segment.start_ms, ',')} --> "
                f"{_timestamp(segment.end_ms, ',')}"
            )
            cues.append(f"{cue_number}\n{timing}\n{text}")
        else:
            timing = (
                f"{_timestamp(segment.start_ms, '.')} --> "
                f"{_timestamp(segment.end_ms, '.')}"
            )
            cues.append(f"{segment.id}\n{timing}\n{text}")

    body = "\n\n".join(cues) + ("\n" if cues else "")
    if subtitle_format == "vtt":
        return f"WEBVTT\n\n{body}"
    # BOM improves UTF-8 Chinese detection in common Windows subtitle players.
    return f"\ufeff{body}"
