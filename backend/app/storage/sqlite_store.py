"""SQLite-backed job records for durable local development and single-host use."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from app.models.jobs import JobRecord
from app.models.jobs import JobWarning
from app.models.provenance import utc_now
from app.storage.runtime_schema import ensure_runtime_schema
from app.workers import process_check


class SQLiteJobStore:
    """Persist complete job records in a local SQLite database.

    Connections are short-lived so multiple API/worker processes can share the
    database. SQLite serializes writes; callers must still avoid stale read-modify-
    write updates when they need stronger state-transition guarantees.
    """

    def __init__(self, database: Path) -> None:
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            ensure_runtime_schema(connection)

    def enqueue_job(self, job: JobRecord) -> JobRecord:
        """Atomically persist the queued record and its runnable queue entry."""
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "UPDATE jobs SET payload = ?, updated_at = ? WHERE job_id = ?",
                (job.model_dump_json(by_alias=True), job.updated_at.isoformat(), job.job_id),
            )
            if cursor.rowcount != 1:
                connection.rollback()
                raise KeyError(f"Job not found: {job.job_id}")
            connection.execute(
                "INSERT OR IGNORE INTO simulation_queue(job_id) VALUES (?)", (job.job_id,)
            )
            connection.commit()
        return job.model_copy(deep=True)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 15000")
        return connection

    def create(self, job: JobRecord) -> JobRecord:
        with self._connect() as connection:
            try:
                connection.execute(
                    "INSERT INTO jobs(job_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (
                        job.job_id,
                        job.model_dump_json(by_alias=True),
                        job.created_at.isoformat(),
                        job.updated_at.isoformat(),
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError(f"Job already exists: {job.job_id}") from exc
        return job.model_copy(deep=True)

    def get(self, job_id: str) -> JobRecord | None:
        with self._connect() as connection:
            row = connection.execute("SELECT payload FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        return JobRecord.model_validate_json(row["payload"]) if row else None

    def update(self, job: JobRecord) -> JobRecord:
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE jobs SET payload = ?, updated_at = ? WHERE job_id = ?",
                (job.model_dump_json(by_alias=True), job.updated_at.isoformat(), job.job_id),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"Job not found: {job.job_id}")
        return job.model_copy(deep=True)

    def mark_interrupted(
        self, job_id: str, owner_host: str, owner_pid: int, solver_pid: int | None = None
    ) -> bool:
        """Atomically mark a confirmed-dead local claim; never requeue partial work."""
        import socket

        if (
            owner_host != socket.gethostname()
            or process_check.process_is_alive(owner_pid)
            or (solver_pid is not None and process_check.process_is_alive(solver_pid))
        ):
            return False
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            claim = connection.execute(
                "SELECT owner_host, owner_pid, solver_pid FROM simulation_claims WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            if (
                claim is None
                or claim["owner_host"] != owner_host
                or int(claim["owner_pid"]) != owner_pid
                or claim["solver_pid"] != solver_pid
                or claim["owner_host"] != socket.gethostname()
                or process_check.process_is_alive(int(claim["owner_pid"]))
                or (
                    claim["solver_pid"] is not None
                    and process_check.process_is_alive(int(claim["solver_pid"]))
                )
            ):
                connection.rollback()
                return False
            row = connection.execute("SELECT payload FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
            if row is None:
                connection.execute("DELETE FROM simulation_claims WHERE job_id = ?", (job_id,))
                connection.execute("DELETE FROM simulation_cancellations WHERE job_id = ?", (job_id,))
                connection.commit()
                return False
            job = JobRecord.model_validate_json(row["payload"])
            if job.status in {"complete", "failed", "not_configured", "interrupted"}:
                connection.execute("DELETE FROM simulation_claims WHERE job_id = ?", (job_id,))
                connection.execute("DELETE FROM simulation_cancellations WHERE job_id = ?", (job_id,))
                connection.commit()
                return False

            job.status = "interrupted"
            job.progress_phase = "interrupted"
            job.updated_at = utc_now()
            job.completed_at = job.updated_at
            if not any(warning.code == "worker_interrupted" for warning in job.warnings):
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
                    "Job marked interrupted after its local worker process was confirmed absent; "
                    "no automatic retry was performed."
                )
            connection.execute(
                "UPDATE jobs SET payload = ?, updated_at = ? WHERE job_id = ?",
                (job.model_dump_json(by_alias=True), job.updated_at.isoformat(), job_id),
            )
            connection.execute("DELETE FROM simulation_claims WHERE job_id = ?", (job_id,))
            connection.execute("DELETE FROM simulation_cancellations WHERE job_id = ?", (job_id,))
            connection.commit()
            return True
