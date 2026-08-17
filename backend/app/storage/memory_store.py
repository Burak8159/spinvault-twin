"""In-memory job store for local development and tests."""

from __future__ import annotations

from threading import Lock

from app.models.jobs import JobRecord


class InMemoryJobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._lock = Lock()

    def create(self, job: JobRecord) -> JobRecord:
        with self._lock:
            if job.job_id in self._jobs:
                raise ValueError(f"Job already exists: {job.job_id}")
            self._jobs[job.job_id] = job.model_copy(deep=True)
            return self._jobs[job.job_id].model_copy(deep=True)

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return job.model_copy(deep=True) if job else None

    def update(self, job: JobRecord) -> JobRecord:
        with self._lock:
            if job.job_id not in self._jobs:
                raise KeyError(f"Job not found: {job.job_id}")
            self._jobs[job.job_id] = job.model_copy(deep=True)
            return self._jobs[job.job_id].model_copy(deep=True)

    def clear(self) -> None:
        with self._lock:
            self._jobs.clear()
