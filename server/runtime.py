from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def _binary_path(environment_variable: str, command: str) -> Path | None:
    configured = os.getenv(environment_variable)
    if configured and Path(configured).is_file():
        return Path(configured)
    discovered = shutil.which(command)
    if discovered:
        return Path(discovered)
    if os.name == "nt" and command == "nvidia-smi":
        candidates = [
            Path(os.getenv("SystemRoot", "C:\\Windows")) / "System32" / "nvidia-smi.exe",
            Path(os.getenv("ProgramFiles", "C:\\Program Files"))
            / "NVIDIA Corporation"
            / "NVSMI"
            / "nvidia-smi.exe",
        ]
        return next((item for item in candidates if item.is_file()), None)
    return None


def runtime_status() -> dict[str, object]:
    ffmpeg = _binary_path("VOICEBRIDGE_FFMPEG_PATH", "ffmpeg")
    nvidia_smi = _binary_path("VOICEBRIDGE_NVIDIA_SMI_PATH", "nvidia-smi")
    gpu_name: str | None = None
    if nvidia_smi:
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            result = subprocess.run(
                [
                    str(nvidia_smi),
                    "--query-gpu=name",
                    "--format=csv,noheader",
                ],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
                creationflags=flags,
            )
            gpu_name = result.stdout.strip().splitlines()[0] if result.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired, IndexError):
            gpu_name = None
    packaged = bool(getattr(sys, "frozen", False))
    return {
        "platform": platform.system(),
        "architecture": platform.machine(),
        "packaged_backend": packaged,
        "python_bundled": packaged,
        "ffmpeg_ready": ffmpeg is not None,
        "ffmpeg_path": str(ffmpeg) if ffmpeg else None,
        "nvidia_driver_ready": gpu_name is not None,
        "gpu_name": gpu_name,
        "compute_mode": "cuda_candidate" if gpu_name else "cpu",
        "base_runtime_ready": bool(ffmpeg),
    }
