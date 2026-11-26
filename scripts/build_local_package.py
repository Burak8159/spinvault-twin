#!/usr/bin/env python3
"""Build a deterministic, source-only local Twin ZIP and SHA-256 sidecar."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_NAME = "SpinVault-Twin-Phase1-20261126.zip"
SKIP_PARTS = {
    ".git",
    "node_modules",
    ".next",
    "dist",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
}


def _excluded(path: str) -> bool:
    parts = Path(path).parts
    name = Path(path).name
    if any(part in SKIP_PARTS for part in parts):
        return True
    if name.endswith(".zip") or name.endswith(".zip.sha256") or name == "PACKAGE_PROVENANCE.txt":
        return True
    if name == ".env" or (name.startswith(".env.") and name not in {".env.example", ".env.sample"}):
        return True
    if path == "deploy/cloudflared/config.yml":
        return True
    if path.startswith(("backend/data/", "ml/datasets/")):
        return True
    if path.startswith("physics/") and "/outputs/" in path:
        return True
    return False


def _tracked_files() -> list[tuple[str, int]]:
    raw = subprocess.run(
        ["git", "ls-files", "-s", "-z"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    ).stdout
    files: list[tuple[str, int]] = []
    for item in raw.split(b"\0"):
        if not item:
            continue
        metadata, path_bytes = item.split(b"\t", 1)
        mode = int(metadata.split(b" ", 1)[0], 8)
        path = os.fsdecode(path_bytes)
        if _excluded(path):
            continue
        if mode not in {0o100644, 0o100755}:
            raise ValueError(f"Unsupported tracked file mode {mode:o}: {path}")
        source = ROOT / path
        if not source.is_file() or source.is_symlink():
            raise ValueError(f"Tracked package source is missing or unsafe: {path}")
        files.append((path, mode))
    return sorted(files)


def build(output: Path) -> dict[str, object]:
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    sources = _tracked_files()
    if not sources:
        raise ValueError("No tracked package sources were found")
    manifest_files = [
        {
            "path": path,
            "bytes": (ROOT / path).stat().st_size,
            "sha256": hashlib.sha256((ROOT / path).read_bytes()).hexdigest(),
            "mode": "executable" if mode == 0o100755 else "regular",
        }
        for path, mode in sources
    ]
    manifest = {
        "schema_version": "1.0",
        "source_commit": commit,
        "tracked_file_count": len(manifest_files),
        "excluded": [
            "ZIP archives and their SHA-256 sidecars",
            "VCS metadata, caches, virtual environments, node_modules and build outputs",
            "local job databases, generated simulation outputs and dataset directories",
            "environment secret files and deploy/cloudflared/config.yml",
        ],
        "files": manifest_files,
    }
    output = output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    sidecar = Path(str(output) + ".sha256")
    if output.exists() or output.is_symlink() or sidecar.exists() or sidecar.is_symlink():
        raise ValueError(f"refusing to overwrite existing package or checksum: {output}")
    fd, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".tmp", dir=output.parent)
    os.close(fd)
    temporary = Path(temporary_name)
    sidecar_fd, sidecar_temporary_name = tempfile.mkstemp(
        prefix=f".{sidecar.name}.", suffix=".tmp", dir=output.parent
    )
    sidecar_temporary = Path(sidecar_temporary_name)
    published_output = False
    sidecar_descriptor_open = True
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path, mode in sources:
                info = zipfile.ZipInfo(f"spinvault-twin/{path}", date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (mode & 0xFFFF) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, (ROOT / path).read_bytes())
            info = zipfile.ZipInfo("spinvault-twin/PACKAGE_PROVENANCE.json", date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100644 & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        with zipfile.ZipFile(temporary) as archive:
            bad_member = archive.testzip()
            if bad_member:
                raise ValueError(f"ZIP CRC validation failed for {bad_member}")
        digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
        with os.fdopen(sidecar_fd, "w", encoding="ascii") as checksum:
            sidecar_descriptor_open = False
            checksum.write(f"{digest}  {output.name}\n")
            checksum.flush()
            os.fsync(checksum.fileno())
        # Hard-link publication is atomic and fails if another process creates
        # either destination after the preflight check. Never replace a prior ZIP.
        os.link(temporary, output)
        published_output = True
        os.link(sidecar_temporary, sidecar)
    except BaseException:
        if published_output and output.exists() and output.stat().st_ino == temporary.stat().st_ino:
            output.unlink()
        raise
    finally:
        if sidecar_descriptor_open:
            os.close(sidecar_fd)
        temporary.unlink(missing_ok=True)
        sidecar_temporary.unlink(missing_ok=True)
    return {
        "archive": str(output),
        "sha256": digest,
        "bytes": output.stat().st_size,
        "tracked_files": len(sources),
        "manifest_entries": len(manifest_files),
        "source_commit": commit,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ARCHIVE_NAME)
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.output), indent=2, sort_keys=True))
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
