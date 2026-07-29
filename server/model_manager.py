from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import RLock, Thread
from typing import Callable, Literal

from server.local_config import SettingsStore


DownloadState = Literal[
    "not_installed", "queued", "downloading", "paused", "installed", "failed"
]


@dataclass(frozen=True)
class ModelDefinition:
    id: str
    name: str
    repo_id: str | None
    role: str
    required: bool
    downloadable: bool
    estimated_size_bytes: int
    directory_name: str | None


@dataclass
class DownloadRecord:
    model_id: str
    state: DownloadState = "not_installed"
    downloaded_bytes: int = 0
    estimated_size_bytes: int = 0
    error: str | None = None


CommandBuilder = Callable[[ModelDefinition, Path, Path], list[str]]


def load_catalog() -> list[ModelDefinition]:
    path = Path(__file__).resolve().parents[1] / "config" / "models.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [ModelDefinition(**item) for item in payload["models"]]


def default_command(model: ModelDefinition, target: Path, cache: Path) -> list[str]:
    if not model.repo_id:
        raise ValueError("model_has_no_repository")
    prefix = (
        [sys.executable, "download-worker"]
        if getattr(sys, "frozen", False)
        else [sys.executable, "-m", "server.download_worker"]
    )
    return [
        *prefix,
        "--repo-id",
        model.repo_id,
        "--local-dir",
        str(target),
        "--cache-dir",
        str(cache),
    ]


class ModelManager:
    def __init__(
        self,
        settings_store: SettingsStore,
        command_builder: CommandBuilder = default_command,
    ) -> None:
        self.settings_store = settings_store
        self.catalog = {item.id: item for item in load_catalog()}
        self.command_builder = command_builder
        self._records: dict[str, DownloadRecord] = {}
        self._processes: dict[str, subprocess.Popen[str]] = {}
        self._targets: dict[str, Path] = {}
        self._lock = RLock()

    def list_models(self) -> list[dict[str, object]]:
        with self._lock:
            return [self._model_payload(model) for model in self.catalog.values()]

    def start(self, model_id: str) -> dict[str, object]:
        with self._lock:
            model = self._get_downloadable(model_id)
            if self._configured_path(model)[0]:
                return self._model_payload(model)
            process = self._processes.get(model_id)
            if process and process.poll() is None:
                return self._model_payload(model)

            settings = self.settings_store.load()
            target = self._managed_target(model)
            target.mkdir(parents=True, exist_ok=True)
            command = self.command_builder(model, target, Path(settings.cache_dir))
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            process = subprocess.Popen(
                command,
                cwd=str(Path(__file__).resolve().parents[1]),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                creationflags=flags,
            )
            self._processes[model_id] = process
            self._targets[model_id] = target
            record = DownloadRecord(
                model_id=model_id,
                state="downloading",
                downloaded_bytes=self._directory_size(target),
                estimated_size_bytes=model.estimated_size_bytes,
            )
            self._records[model_id] = record
            self._save_record(target, record)
            Thread(
                target=self._watch,
                args=(model_id, process, target),
                daemon=True,
                name=f"model-download-{model_id}",
            ).start()
            return self._model_payload(model)

    def pause(self, model_id: str) -> dict[str, object]:
        with self._lock:
            model = self._get_downloadable(model_id)
            process = self._processes.get(model_id)
            target = self._targets.get(model_id, self._managed_target(model))
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                record = DownloadRecord(
                    model_id=model_id,
                    state="paused",
                    downloaded_bytes=self._directory_size(target),
                    estimated_size_bytes=model.estimated_size_bytes,
                )
                self._records[model_id] = record
                self._save_record(target, record)
            return self._model_payload(model)

    def has_active_downloads(self) -> bool:
        with self._lock:
            return any(process.poll() is None for process in self._processes.values())

    def import_directory(self, model_id: str, directory: str) -> dict[str, object]:
        with self._lock:
            model = self._get_downloadable(model_id)
            if self.has_active_downloads():
                raise ValueError("pause_downloads_before_importing")
            target = Path(directory).expanduser().resolve()
            self._validate_model_directory(model, target)
            self.settings_store.set_model_path(model.id, target)
            self._records.pop(model.id, None)
            self._targets.pop(model.id, None)
            return self._model_payload(model)

    def unlink_import(self, model_id: str) -> dict[str, object]:
        with self._lock:
            model = self._get_downloadable(model_id)
            self.settings_store.clear_model_path(model.id)
            self._records.pop(model.id, None)
            self._targets.pop(model.id, None)
            return self._model_payload(model)

    def shutdown(self) -> None:
        with self._lock:
            active = [
                model_id
                for model_id, process in self._processes.items()
                if process.poll() is None
            ]
        for model_id in active:
            self.pause(model_id)

    def _watch(
        self, model_id: str, process: subprocess.Popen[str], target: Path
    ) -> None:
        output = ""
        if process.stdout:
            output = process.stdout.read()
        return_code = process.wait()
        with self._lock:
            model = self.catalog[model_id]
            current = self._records.get(model_id)
            if current and current.state == "paused":
                return
            if return_code == 0:
                marker = target / ".voicebridge-model.json"
                marker.write_text(
                    json.dumps(
                        {"model_id": model.id, "repo_id": model.repo_id},
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )
                state: DownloadState = "installed"
                error = None
            else:
                state = "failed"
                error = output[-1200:] or f"worker_exit_{return_code}"
            record = DownloadRecord(
                model_id=model_id,
                state=state,
                downloaded_bytes=self._directory_size(target),
                estimated_size_bytes=model.estimated_size_bytes,
                error=error,
            )
            self._records[model_id] = record
            self._save_record(target, record)

    def _model_payload(self, model: ModelDefinition) -> dict[str, object]:
        configured_path, path_source = self._configured_path(model)
        settings = self.settings_store.load()
        provider_configured = model.id == "translation_provider" and bool(
            settings.translation_api_base
            or os.getenv("TRANSLATION_API_BASE")
            or os.getenv("QWEN_TRANSLATION_MODEL_DIR")
        )
        target = (
            configured_path
            or self._targets.get(model.id, self._managed_target(model))
            if model.directory_name
            else None
        )
        installed = configured_path is not None
        configured = installed or provider_configured
        record = self._records.get(model.id) or self._load_record(target, model)
        state: DownloadState = "installed" if configured else (
            record.state if record else "not_installed"
        )
        estimated = model.estimated_size_bytes
        downloaded = (
            estimated
            if configured and estimated
            else self._directory_size(target) if target else 0
        )
        progress = (
            min(99, round(downloaded / estimated * 100))
            if estimated and state not in ("installed",)
            else 100 if state == "installed" else 0
        )
        return {
            **asdict(model),
            "local_path": str(target) if target else None,
            "configured": configured,
            "path_source": path_source or ("configuration" if provider_configured else None),
            "state": state,
            "downloaded_bytes": downloaded,
            "progress": progress,
            "error": record.error if record else None,
        }

    def _configured_path(
        self, model: ModelDefinition
    ) -> tuple[Path | None, Literal["managed", "imported", "environment"] | None]:
        settings = self.settings_store.load()
        if model.id == "translation_provider":
            return (None, None)
        imported = settings.model_paths.get(model.id)
        if imported:
            candidate = Path(imported)
            try:
                self._validate_model_directory(model, candidate)
                return candidate, "imported"
            except ValueError:
                pass
        environment = {
            "qwen3_asr": "QWEN_ASR_MODEL_DIR",
            "cosyvoice3": "COSYVOICE_MODEL_DIR",
            "qwen3_tts": "QWEN_TTS_MODEL_DIR",
            "qwen3_translation": "QWEN_TRANSLATION_MODEL_DIR",
            "qwen3_aligner": "QWEN_ALIGNER_MODEL_DIR",
        }.get(model.id)
        legacy = os.getenv(environment, "") if environment else ""
        if legacy and Path(legacy).is_dir():
            return Path(legacy), "environment"
        managed = self._managed_target(model)
        if (managed / ".voicebridge-model.json").exists():
            return managed, "managed"
        return None, None

    def _managed_target(self, model: ModelDefinition) -> Path:
        if not model.directory_name:
            raise ValueError("model_has_no_directory")
        return Path(self.settings_store.load().models_dir) / model.directory_name

    def _get_downloadable(self, model_id: str) -> ModelDefinition:
        model = self.catalog.get(model_id)
        if not model:
            raise KeyError(model_id)
        if not model.downloadable:
            raise ValueError("model_not_downloadable")
        return model

    @staticmethod
    def _validate_model_directory(model: ModelDefinition, target: Path) -> None:
        if not target.is_dir():
            raise ValueError("model_directory_missing")
        marker = target / ".voicebridge-model.json"
        if marker.exists():
            try:
                marker_payload = json.loads(marker.read_text(encoding="utf-8"))
                if marker_payload.get("model_id") not in (None, model.id):
                    raise ValueError("model_directory_type_mismatch")
            except (OSError, json.JSONDecodeError) as error:
                raise ValueError("model_marker_invalid") from error
        if model.id == "cosyvoice3":
            config_present = any(
                (target / name).is_file()
                for name in ("cosyvoice.yaml", "config.yaml")
            )
            weights = [
                target / name
                for name in ("llm.pt", "flow.pt", "hift.pt")
                if (target / name).is_file()
            ]
            if not config_present or not weights:
                raise ValueError("model_directory_signature_mismatch")
        else:
            config_present = (target / "config.json").is_file()
            weights = [
                item
                for pattern in ("*.safetensors", "*.bin", "*.pt", "*.pth")
                for item in target.glob(pattern)
            ]
            if not config_present or not weights:
                raise ValueError("model_directory_signature_mismatch")
        if not any(item.stat().st_size > 1_000_000 for item in weights):
            raise ValueError("model_weights_incomplete")

    @staticmethod
    def _directory_size(path: Path | None) -> int:
        if not path or not path.exists():
            return 0
        return sum(
            item.stat().st_size
            for item in path.rglob("*")
            if item.is_file()
        )

    @staticmethod
    def _save_record(target: Path, record: DownloadRecord) -> None:
        state_path = target / ".voicebridge-download.json"
        temporary = state_path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(asdict(record), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(state_path)

    def _load_record(
        self, target: Path | None, model: ModelDefinition
    ) -> DownloadRecord | None:
        if not target:
            return None
        state_path = target / ".voicebridge-download.json"
        if not state_path.exists():
            return None
        try:
            payload = json.loads(state_path.read_text(encoding="utf-8"))
            state = payload.get("state", "not_installed")
            if state in ("downloading", "queued"):
                state = "paused"
            return DownloadRecord(
                model_id=model.id,
                state=state,
                downloaded_bytes=self._directory_size(target),
                estimated_size_bytes=model.estimated_size_bytes,
                error=payload.get("error"),
            )
        except (OSError, ValueError, TypeError):
            return None
