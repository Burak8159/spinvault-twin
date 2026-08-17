"""FastAPI dependencies."""

from __future__ import annotations

from functools import lru_cache
from threading import Thread

from app.config import get_settings
from app.services.jobs import JobService
from app.services.solver_router import SolverRouter
from app.storage.local_store import LocalJsonJobStore
from app.storage.memory_store import InMemoryJobStore
from app.storage.protocol import JobStore
from app.workers.local_worker import LocalWorker
from app.workers.queue import InMemorySimulationQueue, SimulationQueue


@lru_cache
def get_job_store() -> JobStore:
    settings = get_settings()
    if settings.job_store == "json":
        return LocalJsonJobStore(settings.data_dir)
    return InMemoryJobStore()


@lru_cache
def get_simulation_queue() -> SimulationQueue:
    return InMemorySimulationQueue()


@lru_cache
def get_job_service() -> JobService:
    return JobService(store=get_job_store(), router=SolverRouter(), queue=get_simulation_queue())


@lru_cache
def get_local_worker() -> LocalWorker:
    return LocalWorker(store=get_job_store(), queue=get_simulation_queue(), settings=get_settings())


_worker_thread: Thread | None = None


def start_background_worker() -> None:
    """Start an in-process worker thread when enabled."""
    global _worker_thread
    settings = get_settings()
    if not settings.worker_enabled:
        return
    if _worker_thread is not None and _worker_thread.is_alive():
        return
    worker = get_local_worker()

    def _loop() -> None:
        worker.run_forever(poll_seconds=settings.worker_poll_seconds)

    _worker_thread = Thread(target=_loop, name="spinvault-local-worker", daemon=True)
    _worker_thread.start()


def stop_background_worker() -> None:
    global _worker_thread
    try:
        get_local_worker().stop()
    except Exception:
        pass
    _worker_thread = None


def reset_runtime() -> None:
    """Test helper to clear cached singletons."""
    stop_background_worker()
    get_job_store.cache_clear()
    get_job_service.cache_clear()
    get_simulation_queue.cache_clear()
    get_local_worker.cache_clear()
    get_settings.cache_clear()
