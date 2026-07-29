from __future__ import annotations

import hmac
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.background import BackgroundTasks
from fastapi.responses import FileResponse


MODEL_DIR = Path(
    os.environ.get("SEAMLESS_EXPRESSIVE_MODEL_DIR", "/models/SeamlessExpressive")
)
API_KEY = os.environ.get("VOICEBRIDGE_SIDECAR_API_KEY", "")
MAX_INPUT_BYTES = int(os.environ.get("VOICEBRIDGE_MAX_INPUT_BYTES", 2 * 1024**3))
REQUIRED_FILES = (
    "m2m_expressive_unity.pt",
    "pretssel_melhifigan_wm.pt",
    "pretssel_melhifigan_wm-16khz.pt",
)

app = FastAPI(
    title="VoiceBridge SeamlessExpressive Sidecar",
    version="0.5.0",
)


def _authorized(request: Request) -> bool:
    if not API_KEY:
        return True
    supplied = request.headers.get("authorization", "")
    return hmac.compare_digest(supplied, f"Bearer {API_KEY}")


def _model_ready() -> bool:
    return all(
        (MODEL_DIR / filename).is_file()
        and (MODEL_DIR / filename).stat().st_size > 1_000_000
        for filename in REQUIRED_FILES
    )


@app.get("/health")
def health(request: Request) -> dict[str, object]:
    if not _authorized(request):
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        import torch

        cuda_ready = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_name(0) if cuda_ready else None
    except Exception:
        cuda_ready = False
        gpu_name = None
    return {
        "status": "ok" if _model_ready() else "model_missing",
        "model_ready": _model_ready(),
        "cuda_ready": cuda_ready,
        "gpu_name": gpu_name,
        "target_languages": ["eng"],
    }


@app.post("/v1/translate")
async def translate(
    request: Request,
    background_tasks: BackgroundTasks,
    target_language: str = Query(default="eng", pattern="^eng$"),
) -> FileResponse:
    if not _authorized(request):
        raise HTTPException(status_code=401, detail="unauthorized")
    if not _model_ready():
        raise HTTPException(status_code=503, detail="model_missing")
    declared_size = int(request.headers.get("content-length", "0") or "0")
    if declared_size > MAX_INPUT_BYTES:
        raise HTTPException(status_code=413, detail="input_too_large")

    work = Path(tempfile.mkdtemp(prefix="voicebridge-expressive-"))
    source = work / "source.wav"
    output = work / "translated.wav"
    received = 0
    try:
        with source.open("wb") as destination:
            async for chunk in request.stream():
                received += len(chunk)
                if received > MAX_INPUT_BYTES:
                    raise HTTPException(status_code=413, detail="input_too_large")
                destination.write(chunk)
        process = subprocess.run(
            [
                "expressivity_predict",
                str(source),
                "--tgt_lang",
                target_language,
                "--model_name",
                "seamless_expressivity",
                "--vocoder_name",
                "vocoder_pretssel",
                "--gated-model-dir",
                str(MODEL_DIR),
                "--output_path",
                str(output),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=1800,
        )
        if process.returncode != 0 or not output.is_file():
            raise HTTPException(
                status_code=500,
                detail=f"inference_failed:{process.stdout[-600:]}",
            )
    except Exception:
        if not output.exists():
            shutil.rmtree(work, ignore_errors=True)
        raise

    background_tasks.add_task(shutil.rmtree, work, ignore_errors=True)
    return FileResponse(
        output,
        media_type="audio/wav",
        filename=f"voicebridge-{uuid4().hex[:8]}.wav",
    )
