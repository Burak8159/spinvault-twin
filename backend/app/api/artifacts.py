"""Read-only access to explicitly catalogued, reviewed artifacts."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import tempfile
from pathlib import Path, PurePosixPath
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.api.requirements import require_local_browser
from app.config import get_settings

router = APIRouter(dependencies=[Depends(require_local_browser)])
MAX_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_ARTIFACTS = 5000
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")


class ArtifactRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    relative_path: str = Field(min_length=1, max_length=1024)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size_bytes: int = Field(ge=0)
    availability: Literal["present", "missing"]
    access: Literal["private", "reviewed_public"]
    source_revision: str = Field(min_length=1, max_length=256)


def _configured_root() -> Path:
    root = get_settings().artifact_root
    if root is None:
        raise HTTPException(503, "Research artifact storage is not configured")
    try:
        return root.resolve(strict=True)
    except FileNotFoundError:
        raise HTTPException(503, "Research artifact storage is unavailable")


def _manifest() -> tuple[Path, dict[str, ArtifactRecord]]:
    root = _configured_root()
    manifest_name = get_settings().artifact_manifest
    relative = PurePosixPath(manifest_name)
    if (not manifest_name or "\\" in manifest_name or relative.is_absolute()
            or any(part in ("", ".", "..") for part in manifest_name.split("/"))):
        raise HTTPException(503, "Artifact manifest configuration is invalid")
    manifest_path = root.joinpath(*relative.parts)
    try:
        resolved = manifest_path.resolve(strict=True)
        if not resolved.is_relative_to(root) or not resolved.is_file():
            raise HTTPException(503, "Artifact manifest is unavailable")
        if resolved.stat().st_size > MAX_MANIFEST_BYTES:
            raise HTTPException(503, "Artifact manifest exceeds the size limit")
        payload = json.loads(resolved.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or set(payload) != {"schema_version", "artifacts"}:
            raise ValueError("invalid manifest envelope")
        if payload["schema_version"] != "1.0" or not isinstance(payload["artifacts"], list):
            raise ValueError("invalid manifest version or records")
        if len(payload["artifacts"]) > MAX_ARTIFACTS:
            raise ValueError("too many artifacts")
        records: dict[str, ArtifactRecord] = {}
        for raw in payload["artifacts"]:
            record = ArtifactRecord.model_validate(raw)
            if not ID_PATTERN.fullmatch(record.id) or record.id in records:
                raise ValueError("invalid or duplicate artifact ID")
            path = PurePosixPath(record.relative_path)
            if ("\\" in record.relative_path or path.is_absolute()
                    or any(part in ("", ".", "..") for part in record.relative_path.split("/"))):
                raise ValueError("unsafe artifact path")
            records[record.id] = record
        return root, records
    except HTTPException:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError, ValidationError, ValueError, TypeError):
        raise HTTPException(503, "Artifact manifest is invalid or unreadable")


def _resolve_artifact(root: Path, record: ArtifactRecord) -> Path:
    path = PurePosixPath(record.relative_path)
    candidate = root.joinpath(*path.parts)
    try:
        resolved = candidate.resolve(strict=True)
        if not resolved.is_relative_to(root) or not resolved.is_file():
            raise HTTPException(404, "Artifact unavailable")
        return resolved
    except FileNotFoundError:
        raise HTTPException(404, "Artifact unavailable")


def _public_record(record: ArtifactRecord) -> dict[str, object]:
    return {
        "id": record.id,
        "sha256": record.sha256,
        "size_bytes": record.size_bytes,
        "availability": record.availability,
        "access": record.access,
        "source_revision": record.source_revision,
        "filename": PurePosixPath(record.relative_path).name,
        "downloadable": record.availability == "present" and record.access == "reviewed_public",
    }


@router.get("/artifacts")
def list_artifacts():
    _root, records = _manifest()
    return {"artifacts": [_public_record(records[key]) for key in sorted(records)
                          if records[key].access == "reviewed_public"]}


@router.get("/artifacts/{identifier}")
def get_artifact(identifier: str):
    _root, records = _manifest()
    record = records.get(identifier)
    if record is None or record.access != "reviewed_public":
        raise HTTPException(404, "Artifact unavailable")
    return _public_record(record)


@router.get("/artifacts/{identifier}/content")
def download_artifact(identifier: str):
    root, records = _manifest()
    record = records.get(identifier)
    if record is None or record.availability != "present":
        raise HTTPException(404, "Artifact unavailable")
    if record.access != "reviewed_public":
        raise HTTPException(404, "Artifact unavailable")
    path = _resolve_artifact(root, record)
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size != record.size_bytes:
            os.close(descriptor)
            raise HTTPException(409, "Artifact size no longer matches its manifest")
        if info.st_size > get_settings().artifact_max_file_bytes:
            os.close(descriptor)
            raise HTTPException(413, "Artifact exceeds the configured download limit")
        digest = hashlib.sha256()
        verified_file = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
        with os.fdopen(descriptor, "rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
                verified_file.write(chunk)
        if digest.hexdigest() != record.sha256:
            verified_file.close()
            raise HTTPException(409, "Artifact checksum no longer matches its manifest")
        if verified_file.tell() != record.size_bytes:
            verified_file.close()
            raise HTTPException(409, "Artifact size changed while being verified")
        verified_file.seek(0)
    except HTTPException:
        raise
    except OSError:
        raise HTTPException(404, "Artifact unavailable")

    filename = re.sub(r"[^A-Za-z0-9._-]+", "_", path.name)[:128] or "artifact"

    def chunks():
        try:
            while data := verified_file.read(1024 * 1024):
                yield data
        finally:
            verified_file.close()

    return StreamingResponse(
        chunks(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "ETag": f'"{record.sha256}"',
        },
    )
