import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

os.environ.setdefault(
    "VOICEBRIDGE_DATA_DIR",
    str(Path(tempfile.gettempdir()) / "voicebridge-api-tests"),
)

from server.app import app


client = TestClient(app)


def test_health_requires_explicit_download_action() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["model_download_disabled"] is False
    assert response.json()["model_download_policy"] == "user_initiated_only"

    readiness = client.get("/api/v1/models/readiness")
    assert readiness.status_code == 200
    model_names = {item["id"] for item in readiness.json()["models"]}
    assert model_names == {
        "qwen3_asr",
        "translation_provider",
        "cosyvoice3",
        "qwen3_tts",
        "qwen3_translation",
        "qwen3_aligner",
    }
    assert readiness.json()["download_allowed"] is True
    assert readiness.json()["required_ready"] is False
    assert all("local_path" in item for item in readiness.json()["models"])


def test_local_settings_can_move_model_and_cache_directories(tmp_path: Path) -> None:
    model_dir = tmp_path / "models-on-d-drive"
    cache_dir = tmp_path / "hf-cache"
    response = client.patch(
        "/api/v1/settings",
        json={"models_dir": str(model_dir), "cache_dir": str(cache_dir)},
    )
    assert response.status_code == 200
    assert response.json()["models_dir"] == str(model_dir)
    assert model_dir.is_dir()
    assert cache_dir.is_dir()

    # Restore isolation for the remaining tests.
    client.patch(
        "/api/v1/settings",
        json={
            "models_dir": str(Path(os.environ["VOICEBRIDGE_DATA_DIR"]) / "models"),
            "cache_dir": str(Path(os.environ["VOICEBRIDGE_DATA_DIR"]) / "cache"),
        },
    )


def test_non_downloadable_translation_provider_is_rejected() -> None:
    response = client.post("/api/v1/models/translation_provider/download")
    assert response.status_code == 409
    assert response.json()["detail"] == "model_not_downloadable"


def test_runtime_reports_cpu_fallback_and_ffmpeg_contract() -> None:
    response = client.get("/api/v1/runtime")
    assert response.status_code == 200
    payload = response.json()
    assert payload["compute_mode"] in {"cpu", "cuda_candidate"}
    assert isinstance(payload["ffmpeg_ready"], bool)
    assert isinstance(payload["python_bundled"], bool)


def test_imports_and_unlinks_existing_model_repository(tmp_path: Path) -> None:
    repository = tmp_path / "qwen3-asr"
    repository.mkdir()
    (repository / "config.json").write_text("{}", encoding="utf-8")
    (repository / "model.safetensors").write_bytes(b"0" * 1_000_001)

    imported = client.post(
        "/api/v1/models/qwen3_asr/import",
        json={"path": str(repository)},
    )
    assert imported.status_code == 200
    assert imported.json()["configured"] is True
    assert imported.json()["path_source"] == "imported"
    assert imported.json()["local_path"] == str(repository)

    unlinked = client.post("/api/v1/models/qwen3_asr/unlink")
    assert unlinked.status_code == 200
    assert unlinked.json()["configured"] is False
    assert (repository / "model.safetensors").is_file()


def test_fixture_job_review_flow() -> None:
    created = client.post(
        "/api/v1/voice-translation/jobs",
        json={"filename": "demo.mp4", "media_type": "video/mp4"},
    )
    assert created.status_code == 201
    job = created.json()
    assert job["mode"] == "fixture_no_download"
    assert job["preserve_background"] is True
    assert job["background_policy"] == "preserve_and_duck"
    assert len(job["segments"]) == 3
    review_segment_id = job["segments"][2]["id"]

    regenerated = client.post(
        f"/api/v1/voice-translation/segments/{review_segment_id}/regenerate",
        json={"route": "qwen3_tts"},
    )
    assert regenerated.status_code == 200
    assert regenerated.json()["quality"]["semantic"] == 98
    assert regenerated.json()["route"] == "qwen3_tts"

    approved = client.patch(
        f"/api/v1/voice-translation/segments/{review_segment_id}",
        json={"status": "approved", "translation_locked": True},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    report = client.get(f"/api/v1/voice-translation/jobs/{job['id']}/quality-report")
    assert report.status_code == 200
    assert report.json()["ready"] is True
    assert report.json()["background_policy"] == "preserve_and_duck"

    subtitles = client.get(
        f"/api/v1/voice-translation/jobs/{job['id']}/subtitles",
        params={"format": "srt", "track": "bilingual"},
    )
    assert subtitles.status_code == 200
    assert subtitles.content.startswith(b"\xef\xbb\xbf1\n")
    assert "但这并不意味着旧版本会停止维护。" in subtitles.text
    assert "But this does not mean" in subtitles.text
    assert "filename=" in subtitles.headers["content-disposition"]


def test_voice_only_job_is_explicit() -> None:
    created = client.post(
        "/api/v1/voice-translation/jobs",
        json={
            "filename": "voice.wav",
            "media_type": "audio/wav",
            "preserve_background": False,
        },
    )
    assert created.status_code == 201
    assert created.json()["background_policy"] == "voice_only"


def test_subtitles_are_blocked_before_review_finishes() -> None:
    created = client.post(
        "/api/v1/voice-translation/jobs",
        json={"filename": "draft.mp4", "media_type": "video/mp4"},
    ).json()
    response = client.get(
        f"/api/v1/voice-translation/jobs/{created['id']}/subtitles"
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "subtitles_require_approved_segments"
