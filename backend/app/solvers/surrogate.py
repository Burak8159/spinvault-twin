"""Surrogate / AI adapter boundary. Not connected."""

from __future__ import annotations

from app.models.jobs import JobError
from app.models.provenance import Provenance, utc_now
from app.models.simulation import SimulationRequest
from app.solvers.base import SolverOutcome


class SurrogateSolver:
    name = "surrogate"

    def execute(self, request: SimulationRequest, *, job_id: str | None = None) -> SolverOutcome:
        _ = job_id
        provenance = Provenance(
            created_at=utc_now(),
            created_by="system",
            solver="surrogate",
            solver_version=None,
            notes=[
                "Surrogate model not connected.",
                "No AI inference was performed.",
            ],
        )
        return SolverOutcome(
            status="not_configured",
            errors=[
                JobError(
                    code="solver_not_configured",
                    field="requestedSolver",
                    message=(
                        "Surrogate model is not connected in this backend. "
                        "Use requested_solver='demo' for fixture output."
                    ),
                )
            ],
            provenance=provenance,
        )
