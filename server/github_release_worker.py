from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import shutil
import tarfile
from pathlib import Path

import httpx


GITHUB_API = "https://api.github.com"
USER_AGENT = "VoiceBridge-Model-Installer/0.4"


def _headers(token: str, *, binary: bool = False) -> dict[str, str]:
    return {
        "Accept": (
            "application/octet-stream"
            if binary
            else "application/vnd.github+json"
        ),
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
    }


def _download_asset(
    client: httpx.Client,
    asset: dict[str, object],
    destination: Path,
    token: str,
) -> None:
    expected_size = int(asset["size"])
    existing_size = destination.stat().st_size if destination.exists() else 0
    if existing_size > expected_size:
        destination.unlink()
        existing_size = 0
    if existing_size == expected_size:
        return

    headers = _headers(token, binary=True)
    if existing_size:
        headers["Range"] = f"bytes={existing_size}-"
    with client.stream("GET", str(asset["url"]), headers=headers) as response:
        response.raise_for_status()
        append = existing_size > 0 and response.status_code == 206
        mode = "ab" if append else "wb"
        with destination.open(mode) as output:
            for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                output.write(chunk)
    if destination.stat().st_size != expected_size:
        raise RuntimeError(f"release_part_size_mismatch:{asset['name']}")


def _combine_and_verify(
    parts: list[Path], archive_path: Path, expected_sha256: str
) -> None:
    digest = hashlib.sha256()
    temporary = archive_path.with_suffix(archive_path.suffix + ".tmp")
    with temporary.open("wb") as output:
        for part in parts:
            with part.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    output.write(chunk)
    actual_sha256 = digest.hexdigest()
    if actual_sha256.lower() != expected_sha256.lower():
        temporary.unlink(missing_ok=True)
        raise RuntimeError(
            f"archive_checksum_mismatch:{actual_sha256}"
        )
    temporary.replace(archive_path)


def _extract_required_files(
    archive_path: Path, target: Path, required_files: list[str]
) -> None:
    staging = target / ".voicebridge-extracting"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            safe_members = []
            for member in archive.getmembers():
                member_path = Path(member.name)
                if (
                    member_path.is_absolute()
                    or ".." in member_path.parts
                    or member.issym()
                    or member.islnk()
                    or member.isdev()
                ):
                    raise RuntimeError("archive_contains_unsafe_path")
                if member.isfile() or member.isdir():
                    safe_members.append(member)
            archive.extractall(staging, members=safe_members)

        for filename in required_files:
            matches = [item for item in staging.rglob(filename) if item.is_file()]
            if len(matches) != 1 or matches[0].stat().st_size <= 1_000_000:
                raise RuntimeError(f"required_checkpoint_missing:{filename}")
            shutil.move(str(matches[0]), target / filename)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def install_release(
    *,
    repository: str,
    release_tag: str,
    archive_name: str,
    archive_sha256: str,
    part_pattern: str,
    target: Path,
    required_files: list[str],
    token: str,
) -> None:
    target.mkdir(parents=True, exist_ok=True)
    parts_directory = target / ".voicebridge-parts"
    parts_directory.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=90) as client:
        release = client.get(
            f"{GITHUB_API}/repos/{repository}/releases/tags/{release_tag}",
            headers=_headers(token),
        )
        release.raise_for_status()
        assets = [
            asset
            for asset in release.json().get("assets", [])
            if fnmatch.fnmatch(str(asset.get("name", "")), part_pattern)
        ]
        assets.sort(key=lambda item: str(item["name"]))
        if not assets:
            raise RuntimeError("release_parts_not_found")

        print(
            json.dumps(
                {
                    "event": "release_resolved",
                    "repository": repository,
                    "parts": len(assets),
                }
            ),
            flush=True,
        )
        for asset in assets:
            _download_asset(
                client,
                asset,
                parts_directory / str(asset["name"]),
                token,
            )
            print(
                json.dumps({"event": "part_completed", "name": asset["name"]}),
                flush=True,
            )

    archive_path = target / archive_name
    part_paths = [parts_directory / str(asset["name"]) for asset in assets]
    _combine_and_verify(part_paths, archive_path, archive_sha256)
    _extract_required_files(archive_path, target, required_files)
    archive_path.unlink(missing_ok=True)
    shutil.rmtree(parts_directory, ignore_errors=True)
    print(json.dumps({"event": "completed", "path": str(target)}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="VoiceBridge resumable private GitHub Release worker"
    )
    parser.add_argument("--repository", required=True)
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--archive-name", required=True)
    parser.add_argument("--archive-sha256", required=True)
    parser.add_argument("--part-pattern", required=True)
    parser.add_argument("--local-dir", required=True)
    parser.add_argument("--required-file", nargs="+", required=True)
    args = parser.parse_args()
    token = os.getenv("VOICEBRIDGE_GITHUB_TOKEN", "").strip()
    if not token:
        raise RuntimeError("github_token_required")
    install_release(
        repository=args.repository,
        release_tag=args.release_tag,
        archive_name=args.archive_name,
        archive_sha256=args.archive_sha256,
        part_pattern=args.part_pattern,
        target=Path(args.local_dir),
        required_files=args.required_file,
        token=token,
    )


if __name__ == "__main__":
    main()
