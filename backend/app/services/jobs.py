"""Job lifecycle orchestration."""

from __future__ import annotations

from uuid import uuid4

from app.models.jobs import JobError, JobRecord, JobWarning
from app.models.provenance import Provenance, utc_now
from app.models.simulation import SimulationRequest
from app.services.solver_router import SolverRouter
from app.services.validation import validate_simulation_request
from app.storage.protocol import JobStore
from app.workers.queue import SimulationQueue


class JobService:
    def __init__(
        self,
        store: JobStore,
        router: SolverRouter | None = None,
        queue: SimulationQueue | None = None,
    ) -> None:
        self.store = store
        self.router = router or SolverRouter()
        self.queue = queue

    def submit(self, request: SimulationRequest) -> JobRecord:
        now = utc_now()
        job_id = f"job_{uuid4().hex[:12]}"
        validation = validate_simulation_request(request)

        job = JobRecord(
            job_id=job_id,
            scenario_id=request.scenario_id,
            title=request.title.strip(),
            requested_solver=request.requested_solver,
            status="validating",
            progress_phase="validating",
            created_at=now,
            updated_at=now,
            errors=list(validation.errors),
            warnings=list(validation.warnings),
            provenance=Provenance(
                created_at=now,
                created_by="system",
                solver=request.requested_solver if request.requested_solver == "demo" else "none",
                notes=["Job accepted for validation."],
            ),
            request=request,
            result=None,
        )
        self.store.create(job)

        if not validation.ok:
            job.status = "failed"
            job.progress_phase = "failed"
            job.updated_at = utc_now()
            job.completed_at = job.updated_at
            job.errors = list(validation.errors)
            job.provenance = Provenance(
                created_at=utc_now(),
                created_by="system",
                solver="none",
                notes=["Validation failed before solver routing."],
            )
            return self.store.update(job)

        # CPU Python LLG is fast enough to run in the API process.
        if request.requested_solver == "python_llg":
            job.status = "running"
            job.progress_phase = "running_solver"
            job.updated_at = utc_now()
            self.store.update(job)
            outcome = self.router.submit(request, job_id=job_id)
            job.status = outcome.status
            job.progress_phase = outcome.status
            job.updated_at = utc_now()
            if outcome.status in {"complete", "failed", "cancelled", "not_configured"}:
                job.completed_at = job.updated_at
            job.errors = list(validation.errors) + list(outcome.errors)
            job.warnings = list(validation.warnings) + list(outcome.warnings)
            job.result = outcome.result
            job.provenance = outcome.provenance or Provenance(
                created_at=utc_now(),
                created_by="system",
                solver="python_llg",
                notes=[f"Solver returned status={outcome.status}."],
            )
            return self.store.update(job)

        # MuMax3 heavy jobs run asynchronously via the worker queue.
        if request.requested_solver == "mumax3":
            if self.queue is None:
                job.status = "failed"
                job.progress_phase = "failed"
                job.updated_at = utc_now()
                job.completed_at = job.updated_at
                job.errors = [
                    JobError(
                        code="worker_queue_missing",
                        message="MuMax3 worker queue is not configured on this API process.",
                    )
                ]
                return self.store.update(job)

            job.status = "queued"
            job.progress_phase = "queued"
            job.updated_at = utc_now()
            job.provenance = Provenance(
                created_at=utc_now(),
                created_by="system",
                solver="mumax3",
                notes=["MuMax3 job queued for local worker execution."],
            )
            updated = self.store.update(job)
            self.queue.enqueue(job_id)
            return updated

        job.status = "queued"
        job.progress_phase = "queued"
        job.updated_at = utc_now()
        self.store.update(job)

        if request.requested_solver == "demo":
            job.status = "running"
            job.progress_phase = "running"
            job.updated_at = utc_now()
            self.store.update(job)

        outcome = self.router.submit(request, job_id=job_id)
        job.status = outcome.status
        job.progress_phase = outcome.status
        job.updated_at = utc_now()
        if outcome.status in {"complete", "failed", "cancelled", "not_configured"}:
            job.completed_at = job.updated_at
        job.errors = list(validation.errors) + list(outcome.errors)
        job.warnings = list(validation.warnings) + list(outcome.warnings)
        job.result = outcome.result
        if outcome.provenance is not None:
            job.provenance = outcome.provenance
        else:
            job.provenance = Provenance(
                created_at=utc_now(),
                created_by="system",
                solver=request.requested_solver,
                notes=[f"Solver returned status={outcome.status}."],
            )
        return self.store.update(job)

    def get(self, job_id: str) -> JobRecord | None:
        return self.store.get(job_id)

    def cancel(self, job_id: str) -> JobRecord | None:
        job = self.store.get(job_id)
        if job is None:
            return None

        terminal = {"complete", "failed", "cancelled", "not_configured"}
        if job.status in terminal:
            return job

        if self.queue is not None:
            self.queue.cancel(job_id)
            if job.status == "queued":
                self.queue.abandon(job_id)

        # If still queued and never claimed, mark cancelled immediately.
        if job.status == "queued":
            job.status = "cancelled"
            job.progress_phase = "cancelled"
            job.updated_at = utc_now()
            job.completed_at = job.updated_at
            job.warnings = list(job.warnings) + [
                JobWarning(code="cancelled", message="Job cancelled while queued.")
            ]
            job.provenance = Provenance(
                created_at=utc_now(),
                created_by="system",
                solver=job.requested_solver if job.requested_solver in {"demo", "mumax3"} else "none",
                notes=["Job cancelled by client request."],
            )
            job.result = None
            return self.store.update(job)

        # Active worker phases: cooperative cancel via queue flag.
        job.warnings = list(job.warnings) + [
            JobWarning(code="cancel_requested", message="Cancel requested; worker will stop at next checkpoint.")
        ]
        job.updated_at = utc_now()
        return self.store.update(job)
