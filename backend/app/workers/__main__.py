"""Standalone worker entrypoint.

With the default SQLite job store, the worker and API share a durable local
queue. When using the in-memory store, each process has an isolated queue.
"""

from __future__ import annotations

from app.api.deps import get_job_store, get_local_worker, get_simulation_queue
from app.config import get_settings
from app.workers.recovery import reconcile_interrupted_jobs


def main() -> None:
    settings = get_settings()
    if settings.job_store != "sqlite":
        print(
            "WARNING: The configured in-memory queue is process-local; this worker "
            "cannot see jobs from another API process.\n",
            file=sys.stderr,
        )
    _store = get_job_store()
    _queue = get_simulation_queue()
    recovered = reconcile_interrupted_jobs(_store, _queue)
    if recovered:
        print(f"Marked {len(recovered)} confirmed orphaned job(s) interrupted; none were retried.")
    worker = get_local_worker()
    print(
        f"SpinVault local worker {worker.worker_id} "
        f"(store={settings.job_store}, poll={settings.worker_poll_seconds}s, "
        f"pending={_queue.pending_count()})"
    )
    worker.run_forever(poll_seconds=settings.worker_poll_seconds)


if __name__ == "__main__":
    main()
