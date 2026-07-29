from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from threading import RLock

try:
    from platformdirs import user_data_path
except ImportError:  # Keeps source-mode diagnostics usable before dependencies install.
    user_data_path = None


APP_NAME = "VoiceBridge"
APP_AUTHOR = "VoiceBridge"


def default_data_dir() -> Path:
    override = os.getenv("VOICEBRIDGE_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if user_data_path:
        return Path(user_data_path(APP_NAME, APP_AUTHOR, roaming=False))
    if os.name == "nt" and os.getenv("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / APP_NAME
    return Path.home() / ".local" / "share" / APP_NAME


@dataclass(frozen=True)
class LocalSettings:
    data_dir: str
    models_dir: str
    cache_dir: str
    translation_api_base: str = ""
    translation_api_key: str = ""
    model_paths: dict[str, str] = field(default_factory=dict)

    @classmethod
    def defaults(cls, data_dir: Path | None = None) -> "LocalSettings":
        root = (data_dir or default_data_dir()).resolve()
        return cls(
            data_dir=str(root),
            models_dir=str(root / "models"),
            cache_dir=str(root / "cache"),
        )


class SettingsStore:
    def __init__(self, data_dir: Path | None = None) -> None:
        self._root = (data_dir or default_data_dir()).resolve()
        self._path = self._root / "settings.json"
        self._lock = RLock()

    @property
    def path(self) -> Path:
        return self._path

    def load(self) -> LocalSettings:
        with self._lock:
            defaults = LocalSettings.defaults(self._root)
            if not self._path.exists():
                self._ensure_directories(defaults)
                return defaults
            try:
                payload = json.loads(self._path.read_text(encoding="utf-8"))
                allowed = set(asdict(defaults))
                merged = asdict(defaults) | {
                    key: value for key, value in payload.items() if key in allowed
                }
                if not isinstance(merged["model_paths"], dict):
                    merged["model_paths"] = {}
                else:
                    merged["model_paths"] = {
                        str(key): str(value)
                        for key, value in merged["model_paths"].items()
                        if isinstance(key, str) and isinstance(value, str)
                    }
                settings = LocalSettings(**merged)
            except (OSError, ValueError, TypeError):
                settings = defaults
            self._ensure_directories(settings)
            return settings

    def update(self, **changes: str) -> LocalSettings:
        with self._lock:
            current = asdict(self.load())
            for key, value in changes.items():
                if key not in current:
                    continue
                current[key] = value.strip()
            settings = LocalSettings(**current)
            self._write(settings)
            return settings

    def set_model_path(self, model_id: str, model_path: Path) -> LocalSettings:
        with self._lock:
            current = self.load()
            model_paths = dict(current.model_paths)
            model_paths[model_id] = str(model_path.expanduser().resolve())
            settings = LocalSettings(
                **(asdict(current) | {"model_paths": model_paths})
            )
            self._write(settings)
            return settings

    def clear_model_path(self, model_id: str) -> LocalSettings:
        with self._lock:
            current = self.load()
            model_paths = dict(current.model_paths)
            model_paths.pop(model_id, None)
            settings = LocalSettings(
                **(asdict(current) | {"model_paths": model_paths})
            )
            self._write(settings)
            return settings

    def _write(self, settings: LocalSettings) -> None:
        self._ensure_directories(settings)
        self._root.mkdir(parents=True, exist_ok=True)
        temporary = self._path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(asdict(settings), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(self._path)

    @staticmethod
    def _ensure_directories(settings: LocalSettings) -> None:
        Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
        Path(settings.models_dir).mkdir(parents=True, exist_ok=True)
        Path(settings.cache_dir).mkdir(parents=True, exist_ok=True)
