import io
import json
import subprocess
import threading
import time
from pathlib import Path

import pytest

import server.video_cleanup as video_cleanup
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


class FakeProcess:
    def __init__(self, output: str = "", return_code: int = 0) -> None:
        self.stdout = io.StringIO(output)
        self._return_code = return_code
        self.returncode: int | None = None

    def wait(self) -> int:
        self.returncode = self._return_code
        return self._return_code

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.returncode = -15


class BlockingProcess:
    stdout = None

    def __init__(self) -> None:
        self._finished = threading.Event()
        self.returncode: int | None = None

    def wait(self) -> int:
        self._finished.wait(timeout=2)
        self.returncode = -15
        return self.returncode

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.returncode = -15
        self._finished.set()


def wait_for_terminal_job(
    service: VideoCleanupService, job_id: str
) -> dict[str, object]:
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        job = service.get_job(job_id)
        if job["state"] in {"completed", "failed", "cancelled"}:
            return job
        time.sleep(0.01)
    raise AssertionError("video cleanup worker did not reach a terminal state")


def add_inspection(service: VideoCleanupService, video: Path) -> None:
    service._inspections["inspect-1"] = InspectionRecord(
        id="inspect-1",
        source_path=str(video),
        source_name=video.name,
        width=1280,
        height=720,
        duration_seconds=3,
        size_bytes=video.stat().st_size,
        preview_url="/api/v1/video-cleanup/previews/inspect-1",
        preview_path=str(video.with_suffix(".jpg")),
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


def test_runtime_requires_running_docker_daemon_before_predownload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[list[str]] = []

    def fake_run(command: list[str], **_kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(command, 1, "", "daemon unavailable")

    monkeypatch.setattr(video_cleanup, "_docker_executable", lambda: "/docker")
    service = VideoCleanupService(SettingsStore(tmp_path / "data"), fake_run)

    status = service.runtime_status()
    assert status["docker_ready"] is False
    assert status["error"] == "docker_daemon_not_ready"
    assert not any(command[1:3] == ["image", "inspect"] for command in commands)
    with pytest.raises(ValueError, match="docker_not_ready"):
        service.prepare_runtime()


@pytest.mark.parametrize(
    ("language", "cleanup_kind", "region_mode", "regions", "inpaint_mode"),
    [
        ("en", "subtitle", "auto", [], "sttn-det"),
        (
            "zh",
            "watermark",
            "manual",
            [{"x": 0.72, "y": 0.05, "width": 0.23, "height": 0.16}],
            "sttn-auto",
        ),
    ],
)
def test_worker_completes_bilingual_cleanup_and_remuxes_audio(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    language: str,
    cleanup_kind: str,
    region_mode: str,
    regions: list[dict[str, float]],
    inpaint_mode: str,
) -> None:
    commands: list[list[str]] = []
    data_dir = tmp_path / "data"
    source = tmp_path / f"{language}.mp4"
    source.write_bytes(b"source-video")

    def fake_run(command: list[str], **_kwargs):
        commands.append(command)
        if command[1:2] == ["info"]:
            return subprocess.CompletedProcess(command, 0, '"27.0.0"', "")
        if command[1:3] == ["image", "inspect"]:
            return subprocess.CompletedProcess(command, 0, "", "")
        if Path(command[0]).name == "ffprobe":
            payload = {
                "streams": [{"width": 1280, "height": 720}],
                "format": {"duration": "3.0"},
            }
            return subprocess.CompletedProcess(command, 0, json.dumps(payload), "")
        if Path(command[0]).name == "ffmpeg":
            Path(command[-1]).write_bytes(b"remuxed-video-with-source-audio")
            return subprocess.CompletedProcess(command, 0, "", "")
        raise AssertionError(f"unexpected command: {command}")

    def fake_popen(command: list[str], **_kwargs):
        commands.append(command)
        output_name = command[command.index("--output") + 1].removeprefix("/output/")
        output_dir = data_dir / "outputs" / "cleaned"
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / output_name).write_bytes(b"processed-video")
        return FakeProcess("Subtitle Finding: 50%\rSubtitle Removing: 100%\r")

    monkeypatch.setattr(video_cleanup, "_docker_executable", lambda: "/docker")
    monkeypatch.setattr(
        video_cleanup, "_ffmpeg_executable", lambda: Path("/ffmpeg")
    )
    monkeypatch.setattr(
        video_cleanup, "_ffprobe_executable", lambda _ffmpeg: Path("/ffprobe")
    )
    service = VideoCleanupService(
        SettingsStore(data_dir),
        run_command=fake_run,
        popen_factory=fake_popen,
    )
    add_inspection(service, source)

    created = service.start_job(
        "inspect-1",
        cleanup_kind,
        language,
        region_mode,
        regions,
    )
    completed = wait_for_terminal_job(service, str(created["id"]))

    assert completed["state"] == "completed"
    assert completed["progress"] == 100
    assert Path(str(completed["output_path"])).read_bytes() == (
        b"remuxed-video-with-source-audio"
    )
    assert source.read_bytes() == b"source-video"
    assert not list((data_dir / "outputs" / "cleaned").glob(".*.processed.mp4"))
    container_command = next(command for command in commands if "run" in command)
    assert container_command[container_command.index("--inpaint-mode") + 1] == (
        inpaint_mode
    )
    assert container_command[container_command.index("--pull") + 1] == "never"
    log = data_dir / "logs" / f"video-cleanup-{created['id']}.log"
    assert "Subtitle Removing: 100%" in log.read_text(encoding="utf-8")


def test_cancel_stops_exact_container_and_cleans_partial_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[list[str]] = []
    data_dir = tmp_path / "data"
    source = tmp_path / "cancel.mp4"
    source.write_bytes(b"source-video")
    process = BlockingProcess()

    def fake_run(command: list[str], **_kwargs):
        commands.append(command)
        if command[1:2] == ["info"]:
            return subprocess.CompletedProcess(command, 0, '"27.0.0"', "")
        return subprocess.CompletedProcess(command, 0, "", "")

    def fake_popen(command: list[str], **_kwargs):
        commands.append(command)
        output_name = command[command.index("--output") + 1].removeprefix("/output/")
        output_dir = data_dir / "outputs" / "cleaned"
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / output_name).write_bytes(b"partial")
        return process

    monkeypatch.setattr(video_cleanup, "_docker_executable", lambda: "/docker")
    monkeypatch.setattr(
        video_cleanup, "_ffmpeg_executable", lambda: Path("/ffmpeg")
    )
    service = VideoCleanupService(
        SettingsStore(data_dir),
        run_command=fake_run,
        popen_factory=fake_popen,
    )
    add_inspection(service, source)
    created = service.start_job(
        "inspect-1",
        "subtitle",
        "en",
        "manual",
        [{"x": 0.1, "y": 0.7, "width": 0.8, "height": 0.2}],
    )
    deadline = time.monotonic() + 2
    while service._active_process is not process and time.monotonic() < deadline:
        time.sleep(0.01)

    cancelled = service.cancel_job(str(created["id"]))
    terminal = wait_for_terminal_job(service, str(created["id"]))

    assert cancelled["state"] == "cancelled"
    assert terminal["state"] == "cancelled"
    expected_name = f"voicebridge-cleanup-{created['id']}"
    assert ["/docker", "stop", "--time", "5", expected_name] in commands
    deadline = time.monotonic() + 2
    while list((data_dir / "outputs" / "cleaned").glob(".*.processed.mp4")):
        if time.monotonic() >= deadline:
            raise AssertionError("partial output was not removed after cancellation")
        time.sleep(0.01)
