"""Standalone MuMax3 worker entrypoint (limited — see notes below).

Current queue is process-local (InMemorySimulationQueue). Real MuMax3 execution
with the API must use the in-process worker:

  export SPINVAULT_WORKER_ENABLED=true   # default
  uvicorn app.main:app --port 8001

`python -m app.workers` starts a *separate* process with its own empty queue and
cannot drain jobs enqueued by uvicorn. Use it only for local experiments against
jobs you enqueue into that same process.
"""

from __future__ import annotations

import sys

from app.api.deps import get_job_store, get_local_worker, get_simulation_queue
from app.config import get_settings


def main() -> None:
    settings = get_settings()
    print(
        "WARNING: InMemorySimulationQueue is process-local.\n"
        "This standalone process will NOT see jobs enqueued by a separate uvicorn API.\n"
        "For real MuMax3/RTX runs keep SPINVAULT_WORKER_ENABLED=true (in-process worker).\n",
        file=sys.stderr,
    )
    _store = get_job_store()
    _queue = get_simulation_queue()
    worker = get_local_worker()
    print(
        f"SpinVault local worker {worker.worker_id} "
        f"(store={settings.job_store}, poll={settings.worker_poll_seconds}s, "
        f"pending={_queue.pending_count()})"
    )
    worker.run_forever(poll_seconds=settings.worker_poll_seconds)


if __name__ == "__main__":
    main()
