from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import RLock, Thread
from typing import Literal
from urllib.parse import urlparse
from uuid import uuid4

import httpx

from server.local_config import SettingsStore
from server.model_manager import ModelManager


ExpressiveState = Literal["queued", "processing", "completed", "failed"]
SUPPORTED_MEDIA = {".wav", ".mp3", ".m4a", ".flac", ".mp4", ".mov", ".mkv"}


@dataclass
class ExpressiveJob:
    id: str
    source_path: str
    source_name: str
    target_language: str
    state: ExpressiveState
    progress: int
    output_path: str | None = None
    translated_text: str | None = None
    error: str | None = None
    background_preserved: bool = False


def _api_base(value: str) -> str:
    candidate = value.strip().rstrip("/")
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("seamless_api_base_invalid")
    return candidate


class ExpressiveService:
    def __init__(
        self, settings_store: SettingsStore, model_manager: ModelManager
    ) -> None:
        self.settings_store = settings_store
        self.model_manager = model_manager
        self._jobs: dict[str, ExpressiveJob] = {}
        self._lock = RLock()

    def status(self) -> dict[str, object]:
        settings = self.settings_store.load()
        model = next(
            item
            for item in self.model_manager.list_models()
            if item["id"] == "seamless_expressive"
        )
        configured = bool(settings.seamless_api_base)
        online = False
        runtime: dict[str, object] | None = None
        error: str | None = None
        if configured:
            try:
                base = _api_base(settings.seamless_api_base)
                headers = self._authorization(settings.seamless_api_key)
                response = httpx.get(
                    f"{base}/health", headers=headers, timeout=2.5
                )
                response.raise_for_status()
                runtime = response.json()
                online = True
            except (ValueError, httpx.HTTPError) as caught:
                error = type(caught).__name__
        return {
            "mode": "expressive_fast",
            "checkpoint_ready": model["configured"],
            "checkpoint_path": model["local_path"],
            "sidecar_configured": configured,
            "sidecar_online": online,
            "sidecar_runtime": runtime,
            "error": error,
            "ready": online and bool(runtime and runtime.get("model_ready")),
            "background_policy": "voice_output_only",
        }

    def start(self, source_path: str, target_language: str) -> dict[str, object]:
        if target_language != "eng":
            raise ValueError("expressive_target_not_supported")
        source = Path(source_path).expanduser()
        if not source.is_absolute() or not source.is_file():
            raise ValueError("source_media_missing")
        source = source.resolve()
        if source.suffix.lower() not in SUPPORTED_MEDIA:
            raise ValueError("source_media_unsupported")
        if source.stat().st_size > 8 * 1024**3:
            raise ValueError("source_media_too_large")

        settings = self.settings_store.load()
        base = _api_base(settings.seamless_api_base)
        job = ExpressiveJob(
            id=f"VBX-{uuid4().hex[:10].upper()}",
            source_path=str(source),
            source_name=source.name,
            target_language=target_language,
            state="queued",
            progress=0,
        )
        with self._lock:
            self._jobs[job.id] = job
        Thread(
            target=self._run,
            args=(job.id, source, base, settings.seamless_api_key),
            daemon=True,
            name=f"expressive-job-{job.id}",
        ).start()
        return asdict(job)

    def get(self, job_id: str) -> dict[str, object]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise KeyError(job_id)
            return asdict(job)

    def _run(
        self, job_id: str, source: Path, base: str, api_key: str
    ) -> None:
        prepared: Path | None = None
        try:
            self._update(job_id, state="processing", progress=12)
            prepared = self._prepare_audio(job_id, source)
            self._update(job_id, progress=28)
            settings = self.settings_store.load()
            output_directory = Path(settings.data_dir) / "outputs"
            output_directory.mkdir(parents=True, exist_ok=True)
            output = output_directory / f"{job_id}.wav"
            headers = self._authorization(api_key) | {
                "Content-Type": "audio/wav",
                "X-VoiceBridge-Filename": prepared.name,
            }
            with prepared.open("rb") as audio, httpx.Client(
                timeout=httpx.Timeout(1800, connect=15)
            ) as client:
                self._update(job_id, progress=35)
                with client.stream(
                    "POST",
                    f"{base}/v1/translate",
                    params={"target_language": "eng"},
                    headers=headers,
                    content=audio,
                ) as response:
                    response.raise_for_status()
                    translated_text = response.headers.get(
                        "X-VoiceBridge-Translated-Text"
                    )
                    with output.open("wb") as result:
                        for chunk in response.iter_bytes(1024 * 1024):
                            result.write(chunk)
            if output.stat().st_size <= 44:
                raise RuntimeError("sidecar_returned_empty_audio")
            self._update(
                job_id,
                state="completed",
                progress=100,
                output_path=str(output),
                translated_text=translated_text,
            )
        except Exception as error:
            self._update(
                job_id,
                state="failed",
                progress=100,
                error=f"{type(error).__name__}:{str(error)[:320]}",
            )
        finally:
            if prepared and prepared != source:
                prepared.unlink(missing_ok=True)

    def _prepare_audio(self, job_id: str, source: Path) -> Path:
        if source.suffix.lower() == ".wav":
            return source
        ffmpeg = os.getenv("VOICEBRIDGE_FFMPEG_PATH") or shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg_required_for_source_media")
        temporary = Path(self.settings_store.load().cache_dir) / f"{job_id}.wav"
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        process = subprocess.run(
            [
                str(ffmpeg),
                "-y",
                "-i",
                str(source),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(temporary),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            creationflags=flags,
            timeout=600,
        )
        if process.returncode != 0 or not temporary.is_file():
            raise RuntimeError(
                f"ffmpeg_audio_prepare_failed:{process.stderr[-240:]}"
            )
        return temporary

    def _update(self, job_id: str, **changes: object) -> None:
        with self._lock:
            job = self._jobs[job_id]
            for key, value in changes.items():
                setattr(job, key, value)

    @staticmethod
    def _authorization(api_key: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {api_key}"} if api_key else {}
