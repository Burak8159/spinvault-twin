"""SQLite-backed job records for durable local development and single-host use."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from app.models.jobs import JobRecord


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
            version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if version > 1:
                raise RuntimeError(f"Unsupported job database schema version: {version}")
        with self._connect() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )"""
            )
            connection.execute("PRAGMA user_version = 1")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS simulation_queue (
                    job_id TEXT PRIMARY KEY,
                    enqueued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                )"""
            )
            connection.execute(
                """CREATE TABLE IF NOT EXISTS simulation_cancellations (
                    job_id TEXT PRIMARY KEY,
                    requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                )"""
            )

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
