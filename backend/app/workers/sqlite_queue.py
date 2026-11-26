"""SQLite-backed queue shared safely by local API and worker processes."""

from __future__ import annotations

import sqlite3
from pathlib import Path


class SQLiteSimulationQueue:
    """Durable pending queue with atomic claims and cross-process cancellation.

    Pending work survives process restarts. Claimed work is deliberately not
    automatically requeued after a crash because solver outputs may be partial
    and retrying could duplicate an execution.
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
                """CREATE TABLE IF NOT EXISTS simulation_queue (
                    job_id TEXT PRIMARY KEY,
                    enqueued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                )"""
            )
            connection.execute("PRAGMA user_version = 1")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS simulation_cancellations (
                    job_id TEXT PRIMARY KEY,
                    requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                )"""
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=15)
        connection.execute("PRAGMA busy_timeout = 15000")
        return connection

    def enqueue(self, job_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO simulation_queue(job_id) VALUES (?)", (job_id,)
            )

    def cancel(self, job_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO simulation_cancellations(job_id) VALUES (?)", (job_id,)
            )

    def abandon(self, job_id: str) -> None:
        """Remove a still-pending job; preserve cancellation if a worker claimed it."""
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute("DELETE FROM simulation_queue WHERE job_id = ?", (job_id,))
            if cursor.rowcount:
                connection.execute("DELETE FROM simulation_cancellations WHERE job_id = ?", (job_id,))
            connection.commit()

    def claim_next(self) -> str | None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT job_id FROM simulation_queue ORDER BY enqueued_at, rowid LIMIT 1"
            ).fetchone()
            if row is None:
                connection.commit()
                return None
            job_id = str(row[0])
            connection.execute("DELETE FROM simulation_queue WHERE job_id = ?", (job_id,))
            connection.commit()
            return job_id

    def is_cancelled(self, job_id: str) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT 1 FROM simulation_cancellations WHERE job_id = ?", (job_id,)
            ).fetchone()
        return row is not None

    def clear_cancelled(self, job_id: str) -> None:
        """Clear the cooperative cancellation marker after worker completion."""
        with self._connect() as connection:
            connection.execute("DELETE FROM simulation_cancellations WHERE job_id = ?", (job_id,))

    def pending_count(self) -> int:
        with self._connect() as connection:
            row = connection.execute("SELECT COUNT(*) FROM simulation_queue").fetchone()
        return int(row[0])
