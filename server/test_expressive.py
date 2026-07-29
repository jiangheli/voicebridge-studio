from __future__ import annotations

import time
from pathlib import Path

from server.expressive import ExpressiveService
from server.local_config import SettingsStore
from server.model_manager import ModelManager


class FakeStream:
    headers: dict[str, str] = {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def raise_for_status(self) -> None:
        return

    def iter_bytes(self, _chunk_size: int):
        yield b"RIFF" + b"\0" * 80


class FakeClient:
    def __init__(self, **_kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def stream(self, *_args, **_kwargs):
        return FakeStream()


def test_expressive_service_submits_audio_and_saves_result(
    tmp_path: Path, monkeypatch
) -> None:
    store = SettingsStore(tmp_path / "data")
    store.update(seamless_api_base="http://sidecar.internal:8787")
    service = ExpressiveService(store, ModelManager(store))
    source = tmp_path / "source.wav"
    source.write_bytes(b"RIFF" + b"\0" * 80)
    monkeypatch.setattr("server.expressive.httpx.Client", FakeClient)

    created = service.start(str(source), "eng")
    deadline = time.monotonic() + 2
    current = service.get(str(created["id"]))
    while current["state"] not in {"completed", "failed"} and time.monotonic() < deadline:
        time.sleep(0.02)
        current = service.get(str(created["id"]))

    assert current["state"] == "completed"
    assert current["background_preserved"] is False
    output = Path(str(current["output_path"]))
    assert output.read_bytes().startswith(b"RIFF")
