from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient


def _load_sidecar():
    path = (
        Path(__file__).resolve().parents[1]
        / "services"
        / "seamless-sidecar"
        / "app.py"
    )
    spec = importlib.util.spec_from_file_location("voicebridge_sidecar_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sidecar_auth_health_and_inference_contract(
    tmp_path: Path, monkeypatch
) -> None:
    sidecar = _load_sidecar()
    model_dir = tmp_path / "SeamlessExpressive"
    model_dir.mkdir()
    for filename in sidecar.REQUIRED_FILES:
        (model_dir / filename).write_bytes(b"x" * 1_000_001)
    monkeypatch.setattr(sidecar, "MODEL_DIR", model_dir)
    monkeypatch.setattr(sidecar, "API_KEY", "test-key")

    def fake_inference(command, **_kwargs):
        output = Path(command[command.index("--output_path") + 1])
        output.write_bytes(b"RIFF" + b"\0" * 80)
        return subprocess.CompletedProcess(command, 0, stdout="translated")

    monkeypatch.setattr(sidecar.subprocess, "run", fake_inference)
    client = TestClient(sidecar.app)

    assert client.get("/health").status_code == 401
    health = client.get(
        "/health", headers={"Authorization": "Bearer test-key"}
    )
    assert health.status_code == 200
    assert health.json()["model_ready"] is True

    response = client.post(
        "/v1/translate?target_language=eng",
        headers={
            "Authorization": "Bearer test-key",
            "Content-Type": "audio/wav",
        },
        content=b"RIFF" + b"\0" * 80,
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    assert response.content.startswith(b"RIFF")
