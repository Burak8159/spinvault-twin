"""Job lifecycle models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.models.gpu import GpuInfo

from .provenance import CamelModel, Provenance, utc_now
from .simulation import SimulationRequest, SimulationResult, SolverTarget

JobStatus = Literal[
    "queued",
    "validating",
    "preparing",
    "checking_environment",
    "generating_solver_input",
    "running_solver",
    "parsing_outputs",
    "running",
    "complete",
    "failed",
    "cancelled",
    "not_configured",
]


class JobError(CamelModel):
    code: str
    message: str
    field: str | None = None


class JobWarning(CamelModel):
    code: str
    message: str
    field: str | None = None


class JobRecord(CamelModel):
    job_id: str = Field(alias="jobId")
    scenario_id: str = Field(alias="scenarioId")
    title: str
    requested_solver: SolverTarget = Field(alias="requestedSolver")
    status: JobStatus
    progress_phase: str | None = Field(default=None, alias="progressPhase")
    created_at: datetime = Field(default_factory=utc_now, alias="createdAt")
    updated_at: datetime = Field(default_factory=utc_now, alias="updatedAt")
    started_at: datetime | None = Field(default=None, alias="startedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")
    worker_id: str | None = Field(default=None, alias="workerId")
    gpu: GpuInfo | None = None
    errors: list[JobError] = Field(default_factory=list)
    warnings: list[JobWarning] = Field(default_factory=list)
    provenance: Provenance
    request: SimulationRequest | None = None
    result: SimulationResult | None = None


class JobCreateResponse(CamelModel):
    job: JobRecord


class JobResultResponse(CamelModel):
    job_id: str = Field(alias="jobId")
    status: JobStatus
    result: SimulationResult | None = None
    errors: list[JobError] = Field(default_factory=list)
    provenance: Provenance
