from __future__ import annotations

import argparse
import json
from pathlib import Path

def main() -> None:
    from huggingface_hub import snapshot_download

    parser = argparse.ArgumentParser(description="VoiceBridge resumable model worker")
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--revision", default="main")
    parser.add_argument("--local-dir", required=True)
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--token", default=None)
    args = parser.parse_args()

    target = Path(args.local_dir)
    target.mkdir(parents=True, exist_ok=True)
    print(json.dumps({"event": "started", "repo_id": args.repo_id}), flush=True)
    resolved = snapshot_download(
        repo_id=args.repo_id,
        revision=args.revision,
        local_dir=target,
        cache_dir=args.cache_dir,
        token=args.token or None,
    )
    print(json.dumps({"event": "completed", "path": resolved}), flush=True)


if __name__ == "__main__":
    main()
