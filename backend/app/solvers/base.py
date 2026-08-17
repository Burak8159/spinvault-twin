"""Solver adapter protocol."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from app.models.jobs import JobError, JobStatus, JobWarning
from app.models.provenance import Provenance
from app.models.simulation import SimulationRequest, SimulationResult


@dataclass
class SolverOutcome:
    status: JobStatus
    result: SimulationResult | None = None
    errors: list[JobError] = field(default_factory=list)
    warnings: list[JobWarning] = field(default_factory=list)
    provenance: Provenance | None = None


class SolverAdapter(Protocol):
    name: str

    def execute(self, request: SimulationRequest, *, job_id: str | None = None) -> SolverOutcome: ...
