"""Replaceable simulation job queue."""

from __future__ import annotations

from collections import deque
from threading import Lock
from typing import Protocol


class SimulationQueue(Protocol):
    def enqueue(self, job_id: str) -> None: ...

    def cancel(self, job_id: str) -> None: ...

    def claim_next(self) -> str | None: ...

    def is_cancelled(self, job_id: str) -> bool: ...

    def clear_cancelled(self, job_id: str) -> None: ...

    def pending_count(self) -> int: ...

    def abandon(self, job_id: str) -> None: ...


class InMemorySimulationQueue:
    """Thread-safe local queue suitable for in-process workers."""

    def __init__(self) -> None:
        self._pending: deque[str] = deque()
        self._cancelled: set[str] = set()
        self._lock = Lock()

    def enqueue(self, job_id: str) -> None:
        with self._lock:
            self._cancelled.discard(job_id)
            if job_id not in self._pending:
                self._pending.append(job_id)

    def cancel(self, job_id: str) -> None:
        with self._lock:
            self._cancelled.add(job_id)

    def abandon(self, job_id: str) -> None:
        """Drop a pending job the caller already terminalized (e.g. queued cancel)."""
        with self._lock:
            try:
                self._pending.remove(job_id)
            except ValueError:
                pass
            self._cancelled.discard(job_id)

    def claim_next(self) -> str | None:
        with self._lock:
            if not self._pending:
                return None
            return self._pending.popleft()

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._cancelled

    def clear_cancelled(self, job_id: str) -> None:
        with self._lock:
            self._cancelled.discard(job_id)

    def pending_count(self) -> int:
        with self._lock:
            return len(self._pending)
