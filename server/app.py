from __future__ import annotations

import os
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from server.local_config import SettingsStore
from server.model_manager import ModelManager
from server.runtime import runtime_status
from server.subtitles import SubtitleFormat, SubtitleTrack, render_subtitles


class Quality(BaseModel):
    semantic: int = Field(ge=0, le=100)
    voice: int = Field(ge=0, le=100)
    timing: int = Field(ge=0, le=100)
    facts_passed: bool


class Segment(BaseModel):
    id: str
    speaker: str
    start_ms: int
    end_ms: int
    source_text: str
    target_text: str
    route: Literal["cosyvoice3", "qwen3_tts"]
    status: Literal["approved", "review", "processing"]
    quality: Quality
    issue: str | None = None
    translation_locked: bool = False


class CreateJobRequest(BaseModel):
    filename: str
    media_type: str
    source_language: str = "cmn"
    target_language: str = "eng"
    preserve_voice: bool = True
    preserve_prosody: bool = True
    preserve_background: bool = True
    strict_timing: bool = True
    quality_mode: Literal["preview", "production"] = "production"


class Job(BaseModel):
    id: str
    filename: str
    media_type: str
    created_at: datetime
    status: Literal["uploaded", "processing", "review", "completed"]
    progress: int = Field(ge=0, le=100)
    mode: Literal["fixture_no_download"] = "fixture_no_download"
    preserve_background: bool = True
    background_policy: Literal["preserve_and_duck", "voice_only"] = "preserve_and_duck"
    segments: list[Segment]


class PatchSegmentRequest(BaseModel):
    target_text: str | None = None
    translation_locked: bool | None = None
    status: Literal["approved", "review"] | None = None


class RegenerateRequest(BaseModel):
    route: Literal["cosyvoice3", "qwen3_tts"] = "qwen3_tts"
    candidate_count: int = Field(default=1, ge=1, le=5)
    target_duration_ms: int | None = Field(default=None, gt=0)


class PatchSettingsRequest(BaseModel):
    models_dir: str | None = None
    cache_dir: str | None = None
    translation_api_base: str | None = None
    translation_api_key: str | None = None


class ImportModelRequest(BaseModel):
    path: str = Field(min_length=1)


JOBS: dict[str, Job] = {}
SETTINGS = SettingsStore()
MODEL_MANAGER = ModelManager(SETTINGS)


def fixture_segments(job_id: str) -> list[Segment]:
    return [
        Segment(
            id=f"{job_id}:SEG001",
            speaker="speaker_01",
            start_ms=0,
            end_ms=4280,
            source_text="大家好，欢迎来到今天的产品更新。",
            target_text="Hello everyone, and welcome to today's product update.",
            route="cosyvoice3",
            status="approved",
            quality=Quality(semantic=98, voice=91, timing=96, facts_passed=True),
        ),
        Segment(
            id=f"{job_id}:SEG002",
            speaker="speaker_01",
            start_ms=4280,
            end_ms=9720,
            source_text="我们计划在下个月正式开放新模型测试。",
            target_text="We plan to open testing for the new model next month.",
            route="cosyvoice3",
            status="approved",
            quality=Quality(semantic=96, voice=88, timing=93, facts_passed=True),
        ),
        Segment(
            id=f"{job_id}:SEG003",
            speaker="speaker_02",
            start_ms=9720,
            end_ms=14660,
            source_text="但这并不意味着旧版本会停止维护。",
            target_text="This means the previous version will stop being maintained.",
            route="cosyvoice3",
            status="review",
            issue="NEGATION_ERROR",
            quality=Quality(semantic=54, voice=79, timing=89, facts_passed=False),
        ),
    ]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    MODEL_MANAGER.shutdown()


app = FastAPI(
    title="VoiceBridge API",
    version="0.3.0",
    description="Local Windows desktop API with explicit, resumable model installation.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4173", "http://127.0.0.1:4173", "null"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "mode": "fixture_no_download",
        "model_download_policy": "user_initiated_only",
        "model_download_disabled": os.getenv("MODEL_DOWNLOAD_DISABLED", "0") == "1",
    }


@app.get("/api/v1/models/readiness")
def model_readiness() -> dict[str, object]:
    models = MODEL_MANAGER.list_models()
    return {
        "download_allowed": os.getenv("MODEL_DOWNLOAD_DISABLED", "0") != "1",
        "required_ready": all(
            item["configured"] for item in models if item["required"]
        ),
        "models": models,
    }


@app.get("/api/v1/runtime")
def get_runtime_status() -> dict[str, object]:
    return runtime_status()


@app.get("/api/v1/settings")
def get_settings() -> dict[str, object]:
    settings = asdict(SETTINGS.load())
    settings["translation_api_key"] = "••••••••" if settings["translation_api_key"] else ""
    return settings


@app.patch("/api/v1/settings")
def patch_settings(request: PatchSettingsRequest) -> dict[str, object]:
    updates = request.model_dump(exclude_none=True)
    if MODEL_MANAGER.has_active_downloads() and (
        "models_dir" in updates or "cache_dir" in updates
    ):
        raise HTTPException(status_code=409, detail="pause_downloads_before_changing_paths")
    if updates.get("translation_api_key") == "••••••••":
        updates.pop("translation_api_key")
    settings = asdict(SETTINGS.update(**updates))
    settings["translation_api_key"] = "••••••••" if settings["translation_api_key"] else ""
    return settings


def model_action(model_id: str, action: Literal["start", "pause"]) -> dict[str, object]:
    if os.getenv("MODEL_DOWNLOAD_DISABLED", "0") == "1":
        raise HTTPException(status_code=403, detail="model_download_disabled")
    try:
        if action == "pause":
            return MODEL_MANAGER.pause(model_id)
        return MODEL_MANAGER.start(model_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="model_not_found") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/api/v1/models/{model_id}/download")
def download_model(model_id: str) -> dict[str, object]:
    return model_action(model_id, "start")


@app.post("/api/v1/models/{model_id}/pause")
def pause_model(model_id: str) -> dict[str, object]:
    return model_action(model_id, "pause")


@app.post("/api/v1/models/{model_id}/import")
def import_model(model_id: str, request: ImportModelRequest) -> dict[str, object]:
    try:
        return MODEL_MANAGER.import_directory(model_id, request.path)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="model_not_found") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/api/v1/models/{model_id}/unlink")
def unlink_model(model_id: str) -> dict[str, object]:
    try:
        return MODEL_MANAGER.unlink_import(model_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="model_not_found") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/api/v1/voice-translation/jobs", response_model=Job, status_code=201)
def create_job(request: CreateJobRequest) -> Job:
    job_id = f"VB-{uuid4().hex[:10].upper()}"
    job = Job(
        id=job_id,
        filename=request.filename,
        media_type=request.media_type,
        created_at=datetime.now(UTC),
        status="review",
        progress=100,
        preserve_background=request.preserve_background,
        background_policy="preserve_and_duck" if request.preserve_background else "voice_only",
        segments=fixture_segments(job_id),
    )
    JOBS[job_id] = job
    return job


@app.get("/api/v1/voice-translation/jobs", response_model=list[Job])
def list_jobs() -> list[Job]:
    return sorted(JOBS.values(), key=lambda item: item.created_at, reverse=True)


@app.get("/api/v1/voice-translation/jobs/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")
    return job


@app.get("/api/v1/voice-translation/jobs/{job_id}/segments", response_model=list[Segment])
def get_segments(job_id: str) -> list[Segment]:
    return get_job(job_id).segments


def find_segment(segment_id: str) -> tuple[Job, int, Segment]:
    for job in JOBS.values():
        for index, segment in enumerate(job.segments):
            if segment.id == segment_id:
                return job, index, segment
    raise HTTPException(status_code=404, detail="segment_not_found")


@app.patch("/api/v1/voice-translation/segments/{segment_id}", response_model=Segment)
def patch_segment(segment_id: str, request: PatchSegmentRequest) -> Segment:
    job, index, segment = find_segment(segment_id)
    updates = request.model_dump(exclude_none=True)
    updated = segment.model_copy(update=updates)
    if updated.status == "approved":
        updated.quality = updated.quality.model_copy(update={"facts_passed": True})
        updated.issue = None
    job.segments[index] = updated
    if all(item.status == "approved" for item in job.segments):
        job.status = "completed"
    return updated


@app.post("/api/v1/voice-translation/segments/{segment_id}/regenerate", response_model=Segment)
def regenerate_segment(segment_id: str, request: RegenerateRequest) -> Segment:
    job, index, segment = find_segment(segment_id)
    selected_route = request.route
    updated = segment.model_copy(
        update={
            "target_text": "But this does not mean that the previous version will no longer be maintained.",
            "route": selected_route,
            "status": "review",
            "issue": "AWAITING_HUMAN_CONFIRMATION",
            "quality": Quality(semantic=98, voice=82, timing=92, facts_passed=True),
        }
    )
    job.segments[index] = updated
    return updated


@app.get("/api/v1/voice-translation/jobs/{job_id}/quality-report")
def quality_report(job_id: str) -> dict[str, object]:
    job = get_job(job_id)
    approved = sum(item.status == "approved" for item in job.segments)
    return {
        "schema_version": "1.0",
        "job_id": job.id,
        "generated_at": datetime.now(UTC),
        "mode": job.mode,
        "preserve_background": job.preserve_background,
        "background_policy": job.background_policy,
        "ready": approved == len(job.segments),
        "approved_segments": approved,
        "total_segments": len(job.segments),
        "segments": job.segments,
    }


@app.get("/api/v1/voice-translation/jobs/{job_id}/subtitles")
def subtitles(
    job_id: str,
    format: SubtitleFormat = "srt",
    track: SubtitleTrack = "target",
) -> Response:
    job = get_job(job_id)
    if not all(item.status == "approved" for item in job.segments):
        raise HTTPException(status_code=409, detail="subtitles_require_approved_segments")
    content = render_subtitles(job.segments, format, track)
    extension = "vtt" if format == "vtt" else "srt"
    media_type = "text/vtt" if format == "vtt" else "application/x-subrip"
    filename = f"{job.id}.{track}.{extension}"
    return Response(
        content=content.encode("utf-8"),
        media_type=f"{media_type}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
