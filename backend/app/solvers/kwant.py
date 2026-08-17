"""Kwant adapter boundary. Execution is not configured in Prompt #2."""

from __future__ import annotations

from app.models.jobs import JobError
from app.models.provenance import Provenance, utc_now
from app.models.simulation import SimulationRequest
from app.solvers.base import SolverOutcome


class KwantSolver:
    name = "kwant"

    def execute(self, request: SimulationRequest, *, job_id: str | None = None) -> SolverOutcome:
        _ = job_id
        provenance = Provenance(
            created_at=utc_now(),
            created_by="system",
            solver="kwant",
            solver_version=None,
            notes=[
                "Kwant integration pending.",
                "Transport draft fields were accepted for schema review only.",
            ],
        )
        return SolverOutcome(
            status="not_configured",
            errors=[
                JobError(
                    code="solver_not_configured",
                    field="requestedSolver",
                    message=(
                        "Kwant is not configured in this backend. "
                        "Use requested_solver='demo' until Prompt #6 wiring exists."
                    ),
                )
            ],
            provenance=provenance,
        )
