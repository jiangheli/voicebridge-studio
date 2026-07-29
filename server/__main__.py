from __future__ import annotations

import os
import sys

import uvicorn

from server.download_worker import main as download_worker_main


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "download-worker":
        sys.argv.pop(1)
        download_worker_main()
        return
    uvicorn.run(
        "server.app:app",
        host="127.0.0.1",
        port=int(os.getenv("VOICEBRIDGE_API_PORT", "8765")),
        log_level=os.getenv("VOICEBRIDGE_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
