"""JSON-file job store."""

from __future__ import annotations

import json
from pathlib import Path
from threading import Lock

from app.models.jobs import JobRecord


class LocalJsonJobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()

    def _path(self, job_id: str) -> Path:
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in job_id)
        return self.root / f"{safe}.json"

    def create(self, job: JobRecord) -> JobRecord:
        with self._lock:
            path = self._path(job.job_id)
            if path.exists():
                raise ValueError(f"Job already exists: {job.job_id}")
            path.write_text(
                job.model_dump_json(by_alias=True, indent=2),
                encoding="utf-8",
            )
            return job.model_copy(deep=True)

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            path = self._path(job_id)
            if not path.exists():
                return None
            payload = json.loads(path.read_text(encoding="utf-8"))
            return JobRecord.model_validate(payload)

    def update(self, job: JobRecord) -> JobRecord:
        with self._lock:
            path = self._path(job.job_id)
            if not path.exists():
                raise KeyError(f"Job not found: {job.job_id}")
            path.write_text(
                job.model_dump_json(by_alias=True, indent=2),
                encoding="utf-8",
            )
            return job.model_copy(deep=True)
