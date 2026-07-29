from __future__ import annotations

from types import SimpleNamespace

import pytest

from server.subtitles import render_subtitles


SEGMENTS = [
    SimpleNamespace(
        id="SEG001",
        start_ms=0,
        end_ms=4280,
        source_text="大家好。",
        target_text="Hello everyone.",
    ),
    SimpleNamespace(
        id="SEG002",
        start_ms=4280,
        end_ms=9720,
        source_text="欢迎。",
        target_text="Welcome.",
    ),
]


def test_renders_utf8_bilingual_srt() -> None:
    result = render_subtitles(SEGMENTS, "srt", "bilingual")
    assert result.startswith("\ufeff1\n00:00:00,000 --> 00:00:04,280")
    assert "大家好。\nHello everyone." in result
    assert "\n\n2\n00:00:04,280 --> 00:00:09,720" in result


def test_renders_target_webvtt() -> None:
    result = render_subtitles(SEGMENTS, "vtt", "target")
    assert result.startswith("WEBVTT\n\nSEG001")
    assert "00:00:00.000 --> 00:00:04.280" in result
    assert "大家好。" not in result


def test_rejects_invalid_timing() -> None:
    broken = [
        SimpleNamespace(
            id="BROKEN",
            start_ms=1000,
            end_ms=1000,
            source_text="内容",
            target_text="Content",
        )
    ]
    with pytest.raises(ValueError, match="invalid_segment_timing:BROKEN"):
        render_subtitles(broken, "srt", "target")


def test_skips_empty_text_without_leaving_number_gaps() -> None:
    segments = [
        SimpleNamespace(
            id="EMPTY",
            start_ms=0,
            end_ms=1000,
            source_text="",
            target_text="",
        ),
        SEGMENTS[1],
    ]
    result = render_subtitles(segments, "srt", "target")
    assert result.startswith("\ufeff1\n00:00:04,280")
    assert "\n2\n" not in result
