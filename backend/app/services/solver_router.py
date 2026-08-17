"""Routes simulation requests to honest solver adapters."""

from __future__ import annotations

from app.models.simulation import SimulationRequest, SolverTarget
from app.solvers.base import SolverAdapter, SolverOutcome
from app.solvers.demo import DemoSolver
from app.solvers.kwant import KwantSolver
from app.solvers.mumax3 import Mumax3Solver
from app.solvers.python_llg import PythonLlgAdapter
from app.solvers.surrogate import SurrogateSolver


class SolverRouter:
    def __init__(self, adapters: dict[SolverTarget, SolverAdapter] | None = None) -> None:
        self._adapters: dict[SolverTarget, SolverAdapter] = adapters or {
            "demo": DemoSolver(),
            "python_llg": PythonLlgAdapter(),
            "mumax3": Mumax3Solver(),
            "kwant": KwantSolver(),
            "surrogate": SurrogateSolver(),
        }

    def submit(self, request: SimulationRequest, *, job_id: str | None = None) -> SolverOutcome:
        adapter = self._adapters.get(request.requested_solver)
        if adapter is None:
            from app.models.jobs import JobError
            from app.models.provenance import Provenance, utc_now

            return SolverOutcome(
                status="failed",
                errors=[
                    JobError(
                        code="solver_unknown",
                        field="requestedSolver",
                        message=f"Unknown solver target '{request.requested_solver}'.",
                    )
                ],
                provenance=Provenance(
                    created_at=utc_now(),
                    created_by="system",
                    solver="none",
                    notes=["Unknown solver target rejected."],
                ),
            )
        return adapter.execute(request, job_id=job_id)
