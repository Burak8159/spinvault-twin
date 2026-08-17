"""Artifact manifest helpers for worker jobs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import Field

from app.models.provenance import CamelModel


class ArtifactRef(CamelModel):
    id: str
    kind: str
    path: str
    label: str
    exists: bool = True


class ArtifactManifest(CamelModel):
    job_id: str = Field(alias="jobId")
    solver: str
    files: list[ArtifactRef] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


def build_artifact_manifest(job_dir: Path, *, job_id: str, solver: str) -> ArtifactManifest:
    refs: list[ArtifactRef] = []
    known = [
        ("request", "json", "request.json", "Request JSON"),
        ("script", "script", "generated.mx3", "Generated MuMax3 script"),
        ("status", "json", "status.json", "Worker status"),
        ("stdout", "log", "stdout.log", "stdout"),
        ("stderr", "log", "stderr.log", "stderr"),
        ("result", "json", "result.json", "Parsed result"),
        ("artifacts", "json", "artifacts.json", "Artifact manifest"),
    ]
    for artifact_id, kind, relative, label in known:
        path = job_dir / relative
        if path.exists():
            refs.append(
                ArtifactRef(id=artifact_id, kind=kind, path=relative, label=label, exists=True)
            )

    outputs = job_dir / "outputs"
    if outputs.exists():
        for path in sorted(outputs.rglob("*")):
            if path.is_file():
                relative = str(path.relative_to(job_dir))
                kind = "frame" if path.suffix.lower() == ".ovf" else "output"
                refs.append(
                    ArtifactRef(
                        id=f"output-{len(refs)}",
                        kind=kind,
                        path=relative,
                        label=path.name,
                        exists=True,
                    )
                )

    return ArtifactManifest(
        job_id=job_id,
        solver=solver,
        files=refs,
        notes=["Artifact paths are relative to the job directory. No scientific interpretation attached."],
    )


def write_artifact_manifest(job_dir: Path, *, job_id: str, solver: str) -> ArtifactManifest:
    manifest = build_artifact_manifest(job_dir, job_id=job_id, solver=solver)
    (job_dir / "artifacts.json").write_text(
        manifest.model_dump_json(by_alias=True, indent=2),
        encoding="utf-8",
    )
    return manifest


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
