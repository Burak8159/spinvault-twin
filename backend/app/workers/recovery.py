"""Safe reconciliation of work claimed by a confirmed-dead local worker."""

from __future__ import annotations

from app.storage.protocol import JobStore
from app.workers.queue import SimulationQueue


def reconcile_interrupted_jobs(store: JobStore, queue: SimulationQueue) -> list[str]:
    """Mark confirmed orphan claims as interrupted; never requeue their work."""
    find_orphans = getattr(queue, "reconcile_orphaned_claims", None)
    if not callable(find_orphans):
        return []

    reconciled: list[str] = []
    atomic_recover = getattr(store, "mark_interrupted", None)
    for claim in find_orphans():
        if isinstance(claim, tuple):
            if len(claim) == 4:
                job_id, owner_host, owner_pid, solver_pid = claim
            else:
                job_id, owner_host, owner_pid = claim
                solver_pid = None
        else:
            job_id, owner_host, owner_pid, solver_pid = claim, "", -1, None
        if callable(atomic_recover) and atomic_recover(job_id, owner_host, owner_pid, solver_pid):
            reconciled.append(job_id)
            continue
        if callable(atomic_recover):
            continue
        job = store.get(job_id)
        if job is None:
            continue
        if job.status in {"complete", "failed", "not_configured", "interrupted"}:
            continue
        # Non-SQLite stores retain their own update semantics. SQLite uses the
        # atomic path above, tying the status update to removal of its claim.
        from app.models.provenance import utc_now
        from app.models.jobs import JobWarning

        job.status = "interrupted"
        job.progress_phase = "interrupted"
        job.updated_at = utc_now()
        job.completed_at = job.updated_at
        job.warnings.append(
            JobWarning(
                code="worker_interrupted",
                message=(
                    "The worker process ended before this job could be confirmed complete. "
                    "Outputs may be partial; inspect artifacts and confirm solver exit before retrying."
                ),
            )
        )
        job.provenance.notes.append(
            "Job marked interrupted after its local worker process was confirmed absent; no automatic retry was performed."
        )
        store.update(job)
        reconciled.append(job_id)
    return reconciled
