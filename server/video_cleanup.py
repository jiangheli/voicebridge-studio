from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import RLock, Thread
from typing import Callable, Literal, Sequence
from uuid import uuid4

from server.local_config import SettingsStore


CleanupVariant = Literal["auto", "cuda11.8", "cuda12.6", "cuda12.8"]
ResolvedVariant = Literal["cuda11.8", "cuda12.6", "cuda12.8"]
CleanupKind = Literal["subtitle", "watermark", "all_text"]
Language = Literal["auto", "zh", "en"]
RegionMode = Literal["auto", "manual"]

IMAGE_DIGESTS: dict[ResolvedVariant, str] = {
    "cuda11.8": "sha256:a09797f10549ca78efd7389eff4e5be9907638fef383cda0f72f9f16da380135",
    "cuda12.6": "sha256:e58f9854b9d196a7ae8a614cac730096580dc23042223ee4a806f3b5595ae76a",
    "cuda12.8": "sha256:7a9c720c0491f129ab39bffa6ca59b736dfcdab0350fe871005624fc8b6fe99a",
}
IMAGE_SIZES: dict[ResolvedVariant, int] = {
    "cuda11.8": 6_096_492_803,
    "cuda12.6": 6_412_583_780,
    "cuda12.8": 7_288_614_088,
}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
MAX_VIDEO_BYTES = 50 * 1024**3
MAX_REGIONS = 8
PROGRESS_PATTERN = re.compile(r"(\d{1,3})%")


def image_reference(variant: ResolvedVariant) -> str:
    return (
        f"eritpchy/video-subtitle-remover:1.4.0-{variant}"
        f"@{IMAGE_DIGESTS[variant]}"
    )


def select_variant(
    requested: CleanupVariant, gpu_name: str | None
) -> ResolvedVariant:
    if requested != "auto":
        return requested
    normalized = (gpu_name or "").lower()
    if re.search(r"(rtx\s*)?50\d{2}", normalized):
        return "cuda12.8"
    if re.search(r"(rtx\s*)?40\d{2}", normalized):
        return "cuda12.6"
    return "cuda11.8"


def normalized_regions_to_pixels(
    regions: Sequence[dict[str, float]], width: int, height: int
) -> list[tuple[int, int, int, int]]:
    if width <= 0 or height <= 0:
        raise ValueError("invalid_video_dimensions")
    if len(regions) > MAX_REGIONS:
        raise ValueError("too_many_regions")
    converted: list[tuple[int, int, int, int]] = []
    for region in regions:
        try:
            x = float(region["x"])
            y = float(region["y"])
            region_width = float(region["width"])
            region_height = float(region["height"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("invalid_region") from error
        values = (x, y, region_width, region_height)
        if not all(value == value and abs(value) != float("inf") for value in values):
            raise ValueError("invalid_region")
        if (
            x < 0
            or y < 0
            or region_width <= 0
            or region_height <= 0
            or x + region_width > 1.000001
            or y + region_height > 1.000001
        ):
            raise ValueError("region_out_of_bounds")
        xmin = max(0, min(width - 1, round(x * width)))
        ymin = max(0, min(height - 1, round(y * height)))
        xmax = max(xmin + 1, min(width, round((x + region_width) * width)))
        ymax = max(ymin + 1, min(height, round((y + region_height) * height)))
        converted.append((ymin, ymax, xmin, xmax))
    return converted


def build_container_command(
    docker: str,
    variant: ResolvedVariant,
    container_name: str,
    source_path: Path,
    temporary_output: Path,
    pixel_regions: Sequence[tuple[int, int, int, int]],
    inpaint_mode: Literal["sttn-det", "sttn-auto"],
) -> list[str]:
    source_parent = str(source_path.parent)
    output_parent = str(temporary_output.parent)
    command = [
        docker,
        "run",
        "--rm",
        "--pull",
        "never",
        "--gpus",
        "all",
        "--name",
        container_name,
        "--mount",
        f"type=bind,source={source_parent},target=/input,readonly",
        "--mount",
        f"type=bind,source={output_parent},target=/output",
        image_reference(variant),
        "python",
        "/vsr/backend/main.py",
        "--input",
        f"/input/{source_path.name}",
        "--output",
        f"/output/{temporary_output.name}",
        "--inpaint-mode",
        inpaint_mode,
    ]
    for ymin, ymax, xmin, xmax in pixel_regions:
        command.extend(
            ["--subtitle-area-coords", str(ymin), str(ymax), str(xmin), str(xmax)]
        )
    return command


def _creation_flags() -> int:
    return subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def _docker_executable() -> str | None:
    discovered = shutil.which("docker")
    if discovered:
        return discovered
    if os.name != "nt":
        return None
    candidates = [
        Path(os.environ.get("ProgramFiles", "C:/Program Files"))
        / "Docker"
        / "Docker"
        / "resources"
        / "bin"
        / "docker.exe",
        Path(os.environ.get("LOCALAPPDATA", ""))
        / "Programs"
        / "Docker"
        / "Docker"
        / "resources"
        / "bin"
        / "docker.exe",
    ]
    return str(next((path for path in candidates if path.is_file()), "")) or None


def _ffmpeg_executable() -> Path | None:
    configured = os.getenv("VOICEBRIDGE_FFMPEG_PATH", "").strip()
    if configured and Path(configured).is_file():
        return Path(configured).resolve()
    discovered = shutil.which("ffmpeg")
    return Path(discovered).resolve() if discovered else None


def _ffprobe_executable(ffmpeg: Path | None) -> Path | None:
    if ffmpeg:
        sibling = ffmpeg.with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
        if sibling.is_file():
            return sibling
    discovered = shutil.which("ffprobe")
    return Path(discovered).resolve() if discovered else None


@dataclass
class RuntimeRecord:
    state: Literal[
        "not_prepared", "preparing", "ready", "failed", "cancelled"
    ] = "not_prepared"
    variant: ResolvedVariant = "cuda11.8"
    image: str = image_reference("cuda11.8")
    estimated_size_bytes: int = IMAGE_SIZES["cuda11.8"]
    downloaded_bytes: int = 0
    progress: int = 0
    docker_ready: bool = False
    gpu_name: str | None = None
    error: str | None = None
    log_path: str | None = None


@dataclass
class InspectionRecord:
    id: str
    source_path: str
    source_name: str
    width: int
    height: int
    duration_seconds: float
    size_bytes: int
    preview_url: str
    preview_path: str


@dataclass
class CleanupJob:
    id: str
    inspection_id: str
    source_path: str
    source_name: str
    cleanup_kind: CleanupKind
    language: Language
    region_mode: RegionMode
    state: Literal[
        "queued", "processing", "remuxing", "completed", "failed", "cancelled"
    ] = "queued"
    progress: int = 0
    output_path: str | None = None
    error: str | None = None
    container_name: str | None = None


class VideoCleanupService:
    def __init__(
        self,
        settings_store: SettingsStore,
        run_command: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        popen_factory: Callable[..., subprocess.Popen[str]] = subprocess.Popen,
    ) -> None:
        self._settings_store = settings_store
        self._run_command = run_command
        self._popen_factory = popen_factory
        self._lock = RLock()
        self._runtime = RuntimeRecord()
        self._runtime_process: subprocess.Popen[str] | None = None
        self._active_process: subprocess.Popen[str] | None = None
        self._active_job_id: str | None = None
        self._inspections: dict[str, InspectionRecord] = {}
        self._jobs: dict[str, CleanupJob] = {}

    def runtime_status(
        self, requested: CleanupVariant = "auto"
    ) -> dict[str, object]:
        docker = _docker_executable()
        gpu_name = self._detect_gpu_name()
        variant = select_variant(requested, gpu_name)
        reference = image_reference(variant)
        with self._lock:
            if self._runtime_process and self._runtime_process.poll() is None:
                return asdict(self._runtime)
        ready = False
        docker_error: str | None = None
        if docker:
            try:
                result = self._run_command(
                    [docker, "image", "inspect", reference],
                    capture_output=True,
                    text=True,
                    timeout=15,
                    check=False,
                    creationflags=_creation_flags(),
                )
                ready = result.returncode == 0
            except (OSError, subprocess.SubprocessError) as error:
                docker_error = str(error)
        with self._lock:
            previous = self._runtime
            state = "ready" if ready else (
                previous.state
                if previous.state in {"failed", "cancelled"} and previous.variant == variant
                else "not_prepared"
            )
            self._runtime = RuntimeRecord(
                state=state,
                variant=variant,
                image=reference,
                estimated_size_bytes=IMAGE_SIZES[variant],
                downloaded_bytes=IMAGE_SIZES[variant] if ready else 0,
                progress=100 if ready else 0,
                docker_ready=docker is not None,
                gpu_name=gpu_name,
                error=docker_error or (previous.error if state == previous.state else None),
                log_path=previous.log_path,
            )
            return asdict(self._runtime)

    def prepare_runtime(
        self, requested: CleanupVariant = "auto"
    ) -> dict[str, object]:
        status = self.runtime_status(requested)
        if status["state"] == "ready":
            return status
        docker = _docker_executable()
        if not docker:
            raise ValueError("docker_not_ready")
        variant = select_variant(requested, self._detect_gpu_name())
        settings = self._settings_store.load()
        log_path = Path(settings.data_dir) / "logs" / "video-cleanup-runtime.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_handle = log_path.open("a", encoding="utf-8")
        with self._lock:
            if self._runtime_process and self._runtime_process.poll() is None:
                log_handle.close()
                raise ValueError("runtime_download_already_active")
            self._runtime = RuntimeRecord(
                state="preparing",
                variant=variant,
                image=image_reference(variant),
                estimated_size_bytes=IMAGE_SIZES[variant],
                docker_ready=True,
                gpu_name=self._detect_gpu_name(),
                log_path=str(log_path),
            )
            try:
                self._runtime_process = self._popen_factory(
                    [docker, "pull", image_reference(variant)],
                    stdin=subprocess.DEVNULL,
                    stdout=log_handle,
                    stderr=subprocess.STDOUT,
                    text=True,
                    creationflags=_creation_flags(),
                )
            except OSError:
                log_handle.close()
                self._runtime.state = "failed"
                self._runtime.error = "docker_pull_failed_to_start"
                raise ValueError("docker_pull_failed_to_start") from None
            Thread(
                target=self._wait_for_runtime,
                args=(self._runtime_process, variant, log_handle),
                daemon=True,
                name="video-cleanup-runtime",
            ).start()
            return asdict(self._runtime)

    def cancel_runtime(self) -> dict[str, object]:
        with self._lock:
            process = self._runtime_process
            if process and process.poll() is None:
                process.terminate()
                self._runtime.state = "cancelled"
                self._runtime.error = None
            return asdict(self._runtime)

    def inspect_video(self, source: str) -> dict[str, object]:
        source_path = self._validated_source(source)
        ffmpeg = _ffmpeg_executable()
        ffprobe = _ffprobe_executable(ffmpeg)
        if not ffmpeg or not ffprobe:
            raise ValueError("ffmpeg_runtime_not_ready")
        width, height, duration = self._probe_metadata(ffprobe, source_path)
        inspection_id = uuid4().hex
        settings = self._settings_store.load()
        preview_dir = Path(settings.cache_dir) / "video-cleanup" / "previews"
        preview_dir.mkdir(parents=True, exist_ok=True)
        preview_path = preview_dir / f"{inspection_id}.jpg"
        preview_time = min(max(duration * 0.15, 0), 10)
        rendered = self._run_command(
            [
                str(ffmpeg),
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{preview_time:.3f}",
                "-i",
                str(source_path),
                "-frames:v",
                "1",
                "-vf",
                "scale=1280:-2:force_original_aspect_ratio=decrease",
                "-q:v",
                "3",
                "-y",
                str(preview_path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
            creationflags=_creation_flags(),
        )
        if rendered.returncode != 0 or not preview_path.is_file():
            raise ValueError("preview_generation_failed")
        record = InspectionRecord(
            id=inspection_id,
            source_path=str(source_path),
            source_name=source_path.name,
            width=width,
            height=height,
            duration_seconds=duration,
            size_bytes=source_path.stat().st_size,
            preview_url=f"/api/v1/video-cleanup/previews/{inspection_id}",
            preview_path=str(preview_path),
        )
        with self._lock:
            self._inspections[inspection_id] = record
        public = asdict(record)
        public.pop("preview_path")
        return public

    def preview_path(self, inspection_id: str) -> Path:
        with self._lock:
            record = self._inspections.get(inspection_id)
        if not record:
            raise KeyError(inspection_id)
        path = Path(record.preview_path)
        if not path.is_file():
            raise KeyError(inspection_id)
        return path

    def start_job(
        self,
        inspection_id: str,
        cleanup_kind: CleanupKind,
        language: Language,
        region_mode: RegionMode,
        regions: Sequence[dict[str, float]],
        variant: CleanupVariant = "auto",
    ) -> dict[str, object]:
        with self._lock:
            inspection = self._inspections.get(inspection_id)
            if not inspection:
                raise ValueError("inspection_not_found")
            if self._active_job_id:
                active = self._jobs.get(self._active_job_id)
                if active and active.state in {"queued", "processing", "remuxing"}:
                    raise ValueError("cleanup_job_already_active")
        if cleanup_kind == "watermark" and (
            region_mode != "manual" or not regions
        ):
            raise ValueError("watermark_requires_manual_region")
        if region_mode == "manual" and not regions:
            raise ValueError("manual_region_required")
        if region_mode == "auto" and regions:
            raise ValueError("automatic_mode_rejects_regions")
        runtime = self.runtime_status(variant)
        if runtime["state"] != "ready":
            raise ValueError("cleanup_runtime_not_prepared")
        pixels = normalized_regions_to_pixels(
            regions, inspection.width, inspection.height
        )
        source_path = self._validated_source(inspection.source_path)
        settings = self._settings_store.load()
        output_dir = Path(settings.data_dir) / "outputs" / "cleaned"
        output_dir.mkdir(parents=True, exist_ok=True)
        job_id = uuid4().hex
        output_path = output_dir / f"{source_path.stem}_cleaned_{job_id[:8]}.mp4"
        temporary_output = output_dir / f".{job_id}.processed.mp4"
        inpaint_mode: Literal["sttn-det", "sttn-auto"] = (
            "sttn-auto" if cleanup_kind == "watermark" else "sttn-det"
        )
        container_name = f"voicebridge-cleanup-{job_id}"
        job = CleanupJob(
            id=job_id,
            inspection_id=inspection_id,
            source_path=str(source_path),
            source_name=source_path.name,
            cleanup_kind=cleanup_kind,
            language=language,
            region_mode=region_mode,
            output_path=str(output_path),
            container_name=container_name,
        )
        with self._lock:
            self._jobs[job_id] = job
            self._active_job_id = job_id
        Thread(
            target=self._run_job,
            args=(
                job_id,
                source_path,
                temporary_output,
                output_path,
                pixels,
                inpaint_mode,
                runtime["variant"],
            ),
            daemon=True,
            name=f"video-cleanup-{job_id[:8]}",
        ).start()
        return asdict(job)

    def get_job(self, job_id: str) -> dict[str, object]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise KeyError(job_id)
            return asdict(job)

    def cancel_job(self, job_id: str) -> dict[str, object]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise KeyError(job_id)
            process = self._active_process if self._active_job_id == job_id else None
            container_name = job.container_name
            job.state = "cancelled"
            job.error = None
        docker = _docker_executable()
        if docker and container_name:
            self._run_command(
                [docker, "stop", "--time", "5", container_name],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
                creationflags=_creation_flags(),
            )
        if process and process.poll() is None:
            process.terminate()
        return self.get_job(job_id)

    def shutdown(self) -> None:
        self.cancel_runtime()
        with self._lock:
            active_job_id = self._active_job_id
        if active_job_id:
            try:
                self.cancel_job(active_job_id)
            except KeyError:
                pass

    def _wait_for_runtime(
        self,
        process: subprocess.Popen[str],
        variant: ResolvedVariant,
        log_handle,
    ) -> None:
        return_code = process.wait()
        log_handle.close()
        with self._lock:
            if self._runtime_process is not process:
                return
            self._runtime_process = None
            if self._runtime.state == "cancelled":
                return
            if return_code == 0:
                self._runtime.state = "ready"
                self._runtime.progress = 100
                self._runtime.downloaded_bytes = IMAGE_SIZES[variant]
                self._runtime.error = None
            else:
                self._runtime.state = "failed"
                self._runtime.error = f"docker_pull_exit_{return_code}"

    def _run_job(
        self,
        job_id: str,
        source_path: Path,
        temporary_output: Path,
        output_path: Path,
        pixels: Sequence[tuple[int, int, int, int]],
        inpaint_mode: Literal["sttn-det", "sttn-auto"],
        variant: ResolvedVariant,
    ) -> None:
        docker = _docker_executable()
        ffmpeg = _ffmpeg_executable()
        if not docker or not ffmpeg:
            self._fail_job(job_id, "runtime_dependency_missing")
            return
        with self._lock:
            job = self._jobs[job_id]
            job.state = "processing"
            job.progress = 2
            container_name = job.container_name or ""
        command = build_container_command(
            docker,
            variant,
            container_name,
            source_path,
            temporary_output,
            pixels,
            inpaint_mode,
        )
        settings = self._settings_store.load()
        job_log_path = Path(settings.data_dir) / "logs" / f"video-cleanup-{job_id}.log"
        job_log_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            process = self._popen_factory(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=_creation_flags(),
            )
            with self._lock:
                self._active_process = process
            if process.stdout:
                progress_buffer = ""
                with job_log_path.open("a", encoding="utf-8") as job_log:
                    while character := process.stdout.read(1):
                        job_log.write(character)
                        with self._lock:
                            if self._jobs[job_id].state == "cancelled":
                                break
                        if character in {"\r", "\n"}:
                            match = PROGRESS_PATTERN.search(progress_buffer)
                            if match:
                                upstream = min(100, int(match.group(1)))
                                with self._lock:
                                    self._jobs[job_id].progress = max(
                                        self._jobs[job_id].progress,
                                        min(92, 5 + round(upstream * 0.87)),
                                    )
                            progress_buffer = ""
                        else:
                            progress_buffer = (progress_buffer + character)[-2048:]
            return_code = process.wait()
            with self._lock:
                if self._jobs[job_id].state == "cancelled":
                    self._finish_active(job_id)
                    return
            if return_code != 0 or not temporary_output.is_file():
                self._fail_job(job_id, f"cleanup_container_exit_{return_code}")
                return
            with self._lock:
                self._jobs[job_id].state = "remuxing"
                self._jobs[job_id].progress = 95
            if not self._remux_audio(ffmpeg, temporary_output, source_path, output_path):
                self._fail_job(job_id, "audio_remux_failed")
                return
            ffprobe = _ffprobe_executable(ffmpeg)
            if not ffprobe or not self._verify_output(ffprobe, source_path, output_path):
                output_path.unlink(missing_ok=True)
                self._fail_job(job_id, "output_validation_failed")
                return
            temporary_output.unlink(missing_ok=True)
            with self._lock:
                job = self._jobs[job_id]
                job.state = "completed"
                job.progress = 100
                job.error = None
            self._finish_active(job_id)
        except (OSError, subprocess.SubprocessError) as error:
            self._fail_job(job_id, f"cleanup_process_failed:{error}")
        finally:
            with self._lock:
                state = self._jobs[job_id].state
            if state != "completed":
                temporary_output.unlink(missing_ok=True)
                output_path.unlink(missing_ok=True)

    def _remux_audio(
        self, ffmpeg: Path, processed: Path, source: Path, output: Path
    ) -> bool:
        ffprobe = _ffprobe_executable(ffmpeg)
        if not ffprobe:
            return False
        try:
            _, _, processed_duration = self._probe_metadata(ffprobe, processed)
        except ValueError:
            return False
        if processed_duration <= 0:
            return False
        base = [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(processed),
            "-i",
            str(source),
            "-map",
            "0:v:0",
            "-map",
            "1:a?",
            "-c:v",
            "copy",
            "-t",
            f"{processed_duration:.3f}",
            "-y",
            str(output),
        ]
        for audio_args in (["-c:a", "copy"], ["-c:a", "aac", "-b:a", "192k"]):
            result = self._run_command(
                [*base[:-2], *audio_args, *base[-2:]],
                capture_output=True,
                text=True,
                timeout=900,
                check=False,
                creationflags=_creation_flags(),
            )
            if result.returncode == 0 and output.is_file():
                return True
            output.unlink(missing_ok=True)
        return False

    def _probe_metadata(self, ffprobe: Path, path: Path) -> tuple[int, int, float]:
        try:
            probe = self._run_command(
                [
                    str(ffprobe),
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height:stream_tags=rotate:"
                    "stream_side_data=rotation:format=duration",
                    "-of",
                    "json",
                    str(path),
                ],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
                creationflags=_creation_flags(),
            )
            if probe.returncode != 0:
                raise ValueError("video_probe_failed")
            payload = json.loads(probe.stdout)
            stream = payload.get("streams", [{}])[0]
            width, height = int(stream["width"]), int(stream["height"])
            rotation = int(stream.get("tags", {}).get("rotate") or 0)
            side_data = stream.get("side_data_list") or []
            if side_data and side_data[0].get("rotation") is not None:
                rotation = int(side_data[0]["rotation"])
            if abs(rotation) % 180 == 90:
                width, height = height, width
            duration = float(payload.get("format", {}).get("duration") or 0)
            return width, height, duration
        except (
            OSError,
            subprocess.SubprocessError,
            ValueError,
            KeyError,
            json.JSONDecodeError,
        ):
            raise ValueError("video_probe_failed") from None

    def _verify_output(self, ffprobe: Path, source: Path, output: Path) -> bool:
        if not output.is_file() or output.stat().st_size == 0:
            return False
        try:
            source_width, source_height, source_duration = self._probe_metadata(
                ffprobe, source
            )
            output_width, output_height, output_duration = self._probe_metadata(
                ffprobe, output
            )
        except ValueError:
            return False
        if (source_width, source_height) != (output_width, output_height):
            return False
        if source_duration <= 0:
            return output_duration > 0
        tolerance = max(2.0, source_duration * 0.05)
        return abs(source_duration - output_duration) <= tolerance

    def _fail_job(self, job_id: str, error: str) -> None:
        with self._lock:
            job = self._jobs[job_id]
            if job.state != "cancelled":
                job.state = "failed"
                job.error = error
        self._finish_active(job_id)

    def _finish_active(self, job_id: str) -> None:
        with self._lock:
            if self._active_job_id == job_id:
                self._active_job_id = None
                self._active_process = None

    def _validated_source(self, source: str) -> Path:
        raw = Path(source).expanduser()
        if not raw.is_absolute():
            raise ValueError("source_path_must_be_absolute")
        try:
            path = raw.resolve(strict=True)
        except OSError:
            raise ValueError("source_video_missing") from None
        if not path.is_file():
            raise ValueError("source_video_missing")
        if path.suffix.lower() not in VIDEO_EXTENSIONS:
            raise ValueError("unsupported_video_format")
        if path.stat().st_size > MAX_VIDEO_BYTES:
            raise ValueError("source_video_too_large")
        return path

    def _detect_gpu_name(self) -> str | None:
        executable = shutil.which("nvidia-smi")
        if not executable:
            return None
        try:
            result = self._run_command(
                [executable, "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
                creationflags=_creation_flags(),
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if result.returncode != 0:
            return None
        first = result.stdout.strip().splitlines()
        return first[0].strip() if first else None
