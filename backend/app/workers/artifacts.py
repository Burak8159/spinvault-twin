"""Artifact manifest helpers for worker jobs."""

from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import stat
import tempfile
from typing import Any

from pydantic import Field

from app.models.provenance import CamelModel


class ArtifactRef(CamelModel):
    id: str
    kind: str
    path: str
    label: str
    exists: bool = True
    size_bytes: int | None = Field(default=None, alias="sizeBytes", ge=0)
    sha256: str | None = Field(default=None, min_length=64, max_length=64)


class ArtifactManifest(CamelModel):
    schema_version: int = Field(default=2, alias="schemaVersion")
    job_id: str = Field(alias="jobId")
    solver: str
    files: list[ArtifactRef] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


def build_artifact_manifest(job_dir: Path, *, job_id: str, solver: str) -> ArtifactManifest:
    refs: list[ArtifactRef] = []
    integrity_notes: list[str] = []
    known = {
        "request.json": ("request", "json", "Request JSON"),
        "generated.mx3": ("script", "script", "Generated MuMax3 script"),
        "status.json": ("status", "json", "Worker status"),
        "stdout.log": ("stdout", "log", "stdout"),
        "stderr.log": ("stderr", "log", "stderr"),
        "result.json": ("result", "json", "Parsed result"),
        "magnetization.npz": ("magnetization", "frame", "Python mesh magnetization"),
    }
    # Inventory every regular file, not only known outputs. The manifest excludes
    # itself because a file cannot contain its own stable digest.
    for path in sorted(job_dir.rglob("*")):
        if path.name == "artifacts.json" or path.is_symlink() or not path.is_file():
            continue
        relative = path.relative_to(job_dir).as_posix()
        try:
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode):
                os.close(fd)
                continue
            digest = hashlib.sha256()
            with os.fdopen(fd, "rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
                after = os.fstat(source.fileno())
            stable = (before.st_ino, before.st_size, before.st_mtime_ns) == (
                after.st_ino,
                after.st_size,
                after.st_mtime_ns,
            )
        except OSError:
            continue
        item_id, kind, label = known.get(
            relative,
            (
                f"file-{len(refs)}",
                "frame" if path.suffix.lower() in {".ovf", ".npz"} else "output",
                path.name,
            ),
        )
        if not stable:
            integrity_notes.append(f"Digest omitted because file changed while being read: {relative}")
        refs.append(
            ArtifactRef(
                id=item_id,
                kind=kind,
                path=relative,
                label=label,
                exists=True,
                size_bytes=after.st_size if stable else None,
                sha256=digest.hexdigest() if stable else None,
            )
        )

    return ArtifactManifest(
        job_id=job_id,
        solver=solver,
        files=refs,
        notes=[
            "Manifest schema 2 records SHA-256 and byte size for each regular file present when the snapshot was built.",
            "artifacts.json is excluded because a manifest cannot contain its own stable digest.",
            "Hashes establish file identity only; no scientific interpretation or validation is attached.",
            *integrity_notes,
        ],
    )


def write_artifact_manifest(job_dir: Path, *, job_id: str, solver: str) -> ArtifactManifest:
    manifest = build_artifact_manifest(job_dir, job_id=job_id, solver=solver)
    fd, temporary_name = tempfile.mkstemp(prefix=".artifacts.", suffix=".tmp", dir=job_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(manifest.model_dump_json(by_alias=True, indent=2))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_name, job_dir / "artifacts.json")
    finally:
        Path(temporary_name).unlink(missing_ok=True)
    return manifest


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
