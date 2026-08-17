"""MuMax3 solver entrypoint used by SolverRouter."""

from __future__ import annotations

from uuid import uuid4

from app.models.simulation import SimulationRequest
from app.solvers.base import SolverOutcome
from app.solvers.mumax3.adapter import Mumax3Adapter


class Mumax3Solver:
    name = "mumax3"

    def __init__(self, adapter: Mumax3Adapter | None = None) -> None:
        self.adapter = adapter or Mumax3Adapter()

    def execute(self, request: SimulationRequest, *, job_id: str | None = None) -> SolverOutcome:
        return self.adapter.execute(request, job_id=job_id or f"mumax_{uuid4().hex[:12]}")
