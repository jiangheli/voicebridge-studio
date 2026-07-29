from __future__ import annotations

import sys
import time
from pathlib import Path

from server.local_config import SettingsStore
from server.model_manager import ModelDefinition, ModelManager


def sleeping_command(
    _model: ModelDefinition, _target: Path, _cache: Path
) -> list[str]:
    return [sys.executable, "-c", "import time; time.sleep(30)"]


def successful_command(
    _model: ModelDefinition, _target: Path, _cache: Path
) -> list[str]:
    return [sys.executable, "-c", "print('fixture complete')"]


def test_pause_and_resume_preserve_target_directory(tmp_path: Path) -> None:
    store = SettingsStore(tmp_path / "data")
    manager = ModelManager(store, sleeping_command)
    target = Path(store.load().models_dir) / "Qwen3-ASR-0.6B"
    target.mkdir(parents=True)
    partial = target / "weights.part"
    partial.write_bytes(b"partial-cache")

    started = manager.start("qwen3_asr")
    assert started["state"] == "downloading"

    paused = manager.pause("qwen3_asr")
    assert paused["state"] == "paused"
    assert partial.read_bytes() == b"partial-cache"

    restored = ModelManager(store, sleeping_command).list_models()[0]
    assert restored["state"] == "paused"

    resumed = manager.start("qwen3_asr")
    assert resumed["state"] == "downloading"
    manager.pause("qwen3_asr")


def test_successful_worker_marks_model_installed(tmp_path: Path) -> None:
    manager = ModelManager(SettingsStore(tmp_path / "data"), successful_command)
    manager.start("qwen3_asr")

    deadline = time.monotonic() + 3
    model = manager.list_models()[0]
    while model["state"] != "installed" and time.monotonic() < deadline:
        time.sleep(0.02)
        model = manager.list_models()[0]

    assert model["state"] == "installed"
    assert model["configured"] is True
    assert Path(str(model["local_path"]), ".voicebridge-model.json").is_file()


def test_imports_existing_repository_without_copying(tmp_path: Path) -> None:
    store = SettingsStore(tmp_path / "data")
    manager = ModelManager(store, sleeping_command)
    repository = tmp_path / "existing-qwen-repository"
    repository.mkdir()
    (repository / "config.json").write_text("{}", encoding="utf-8")
    weights = repository / "model.safetensors"
    weights.write_bytes(b"0" * 1_000_001)

    imported = manager.import_directory("qwen3_asr", str(repository))
    assert imported["configured"] is True
    assert imported["path_source"] == "imported"
    assert imported["local_path"] == str(repository)
    assert weights.is_file()
    assert store.load().model_paths["qwen3_asr"] == str(repository)

    unlinked = manager.unlink_import("qwen3_asr")
    assert unlinked["configured"] is False
    assert weights.is_file()


def test_rejects_incomplete_imported_repository(tmp_path: Path) -> None:
    manager = ModelManager(SettingsStore(tmp_path / "data"), sleeping_command)
    repository = tmp_path / "incomplete"
    repository.mkdir()
    (repository / "config.json").write_text("{}", encoding="utf-8")
    (repository / "model.safetensors").write_text(
        "version https://git-lfs.github.com/spec/v1",
        encoding="utf-8",
    )

    try:
        manager.import_directory("qwen3_asr", str(repository))
    except ValueError as error:
        assert str(error) == "model_weights_incomplete"
    else:
        raise AssertionError("incomplete repository was accepted")
