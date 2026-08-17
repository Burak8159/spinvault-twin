"""Worker status.json persistence."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import Field

from app.models.jobs import JobError, JobStatus, JobWarning
from app.models.provenance import CamelModel, utc_now
from app.models.gpu import GpuInfo
from app.workers.artifacts import write_json


class WorkerStatusDocument(CamelModel):
    job_id: str = Field(alias="jobId")
    status: JobStatus
    progress_phase: str = Field(alias="progressPhase")
    started_at: datetime | None = Field(default=None, alias="startedAt")
    updated_at: datetime = Field(default_factory=utc_now, alias="updatedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")
    worker_id: str = Field(alias="workerId")
    solver: str
    gpu: GpuInfo | None = None
    warnings: list[JobWarning] = Field(default_factory=list)
    errors: list[JobError] = Field(default_factory=list)
    message: str | None = None


def write_status_document(job_dir: Path, document: WorkerStatusDocument) -> None:
    write_json(job_dir / "status.json", document.model_dump(by_alias=True, mode="json"))


def status_payload(**kwargs: Any) -> dict[str, Any]:
    return kwargs
