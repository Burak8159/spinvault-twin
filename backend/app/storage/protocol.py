"""Replaceable job store protocol."""

from __future__ import annotations

from typing import Protocol

from app.models.jobs import JobRecord


class JobStore(Protocol):
    def create(self, job: JobRecord) -> JobRecord: ...

    def get(self, job_id: str) -> JobRecord | None: ...

    def update(self, job: JobRecord) -> JobRecord: ...
