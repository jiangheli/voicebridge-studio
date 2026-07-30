from pathlib import Path

import pytest

from server.local_config import SettingsStore
from server.video_cleanup import (
    IMAGE_DIGESTS,
    InspectionRecord,
    VideoCleanupService,
    build_container_command,
    image_reference,
    normalized_regions_to_pixels,
    select_variant,
)


def test_cuda_variant_matches_nvidia_generation() -> None:
    assert select_variant("auto", "NVIDIA GeForce RTX 5090") == "cuda12.8"
    assert select_variant("auto", "NVIDIA GeForce RTX 4090") == "cuda12.6"
    assert select_variant("auto", "NVIDIA GeForce RTX 3080") == "cuda11.8"
    assert select_variant("cuda12.6", "NVIDIA GeForce RTX 5090") == "cuda12.6"


def test_normalized_regions_are_bounded_and_converted_to_cli_order() -> None:
    assert normalized_regions_to_pixels(
        [{"x": 0.1, "y": 0.75, "width": 0.8, "height": 0.2}],
        1920,
        1080,
    ) == [(810, 1026, 192, 1728)]

    with pytest.raises(ValueError, match="region_out_of_bounds"):
        normalized_regions_to_pixels(
            [{"x": 0.9, "y": 0.1, "width": 0.2, "height": 0.1}],
            1920,
            1080,
        )


def test_container_contract_is_pinned_offline_and_source_is_read_only(
    tmp_path: Path,
) -> None:
    source = tmp_path / "中文 English clip.mp4"
    source.touch()
    output = tmp_path / ".processed.mp4"
    command = build_container_command(
        "docker.exe",
        "cuda12.6",
        "voicebridge-cleanup-abc123",
        source,
        output,
        [(800, 1020, 100, 1800)],
        "sttn-det",
    )

    assert command[:5] == ["docker.exe", "run", "--rm", "--pull", "never"]
    assert "--gpus" in command
    assert any("target=/input,readonly" in item for item in command)
    assert image_reference("cuda12.6") in command
    assert IMAGE_DIGESTS["cuda12.6"] in image_reference("cuda12.6")
    assert command[-5:] == [
        "--subtitle-area-coords",
        "800",
        "1020",
        "100",
        "1800",
    ]


def test_chinese_and_english_share_language_independent_cleanup_contract(
    tmp_path: Path,
) -> None:
    service = VideoCleanupService(SettingsStore(tmp_path / "data"))
    video = tmp_path / "bilingual.mp4"
    video.write_bytes(b"video")
    inspection = InspectionRecord(
        id="inspect-1",
        source_path=str(video),
        source_name=video.name,
        width=1920,
        height=1080,
        duration_seconds=10,
        size_bytes=video.stat().st_size,
        preview_url="/api/v1/video-cleanup/previews/inspect-1",
        preview_path=str(tmp_path / "preview.jpg"),
    )
    service._inspections[inspection.id] = inspection

    for language in ("zh", "en"):
        with pytest.raises(ValueError, match="watermark_requires_manual_region"):
            service.start_job(
                inspection.id,
                "watermark",
                language,
                "auto",
                [],
            )


def test_automatic_mode_rejects_regions_before_starting_runtime(
    tmp_path: Path,
) -> None:
    service = VideoCleanupService(SettingsStore(tmp_path / "data"))
    video = tmp_path / "sample.mp4"
    video.write_bytes(b"video")
    service._inspections["inspect-1"] = InspectionRecord(
        id="inspect-1",
        source_path=str(video),
        source_name=video.name,
        width=1280,
        height=720,
        duration_seconds=3,
        size_bytes=5,
        preview_url="/api/v1/video-cleanup/previews/inspect-1",
        preview_path=str(tmp_path / "preview.jpg"),
    )

    with pytest.raises(ValueError, match="automatic_mode_rejects_regions"):
        service.start_job(
            "inspect-1",
            "subtitle",
            "auto",
            "auto",
            [{"x": 0.1, "y": 0.7, "width": 0.8, "height": 0.2}],
        )
