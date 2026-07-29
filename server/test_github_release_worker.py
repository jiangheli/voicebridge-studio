from __future__ import annotations

import io
import json
import tarfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest

import server.github_release_worker as worker


def _archive(required_files: list[str]) -> bytes:
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode="w:gz") as archive:
        for filename in required_files:
            content = b"x" * 1_000_001
            info = tarfile.TarInfo(f"SeamlessExpressive/{filename}")
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
    return payload.getvalue()


def test_private_release_resumes_and_extracts_verified_parts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    required = [
        "m2m_expressive_unity.pt",
        "pretssel_melhifigan_wm.pt",
        "pretssel_melhifigan_wm-16khz.pt",
    ]
    archive = _archive(required)
    split = len(archive) // 2
    parts = [archive[:split], archive[split:]]
    range_requests: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path.endswith("/releases/tags/v1"):
                body = json.dumps(
                    {
                        "assets": [
                            {
                                "name": f"bundle.tar.gz.part-0{index}",
                                "size": len(content),
                                "url": f"http://127.0.0.1:{self.server.server_port}/asset/{index}",
                            }
                            for index, content in enumerate(parts)
                        ]
                    }
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            index = int(self.path.rsplit("/", 1)[-1])
            content = parts[index]
            range_header = self.headers.get("Range")
            if range_header:
                range_requests.append(range_header)
                start = int(range_header.removeprefix("bytes=").removesuffix("-"))
                content = content[start:]
                self.send_response(206)
                self.send_header(
                    "Content-Range",
                    f"bytes {start}-{len(parts[index]) - 1}/{len(parts[index])}",
                )
            else:
                self.send_response(200)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(worker, "GITHUB_API", f"http://127.0.0.1:{server.server_port}")
    target = tmp_path / "model"
    partial_directory = target / ".voicebridge-parts"
    partial_directory.mkdir(parents=True)
    (partial_directory / "bundle.tar.gz.part-00").write_bytes(parts[0][:7])
    try:
        worker.install_release(
            repository="test/private",
            release_tag="v1",
            archive_name="bundle.tar.gz",
            archive_sha256=__import__("hashlib").sha256(archive).hexdigest(),
            part_pattern="bundle.tar.gz.part-*",
            target=target,
            required_files=required,
            token="secret-token",
        )
    finally:
        server.shutdown()
        thread.join(timeout=2)

    assert range_requests == ["bytes=7-"]
    assert not partial_directory.exists()
    assert all((target / filename).stat().st_size == 1_000_001 for filename in required)


def test_archive_rejects_path_traversal(tmp_path: Path) -> None:
    archive_path = tmp_path / "unsafe.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        info = tarfile.TarInfo("../escaped.pt")
        content = b"x" * 1_000_001
        info.size = len(content)
        archive.addfile(info, io.BytesIO(content))

    with pytest.raises(RuntimeError, match="archive_contains_unsafe_path"):
        worker._extract_required_files(
            archive_path, tmp_path / "target", ["escaped.pt"]
        )
