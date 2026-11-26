"""SQLite-backed queue shared safely by local API and worker processes."""

from __future__ import annotations

import os
import socket
import sqlite3
from pathlib import Path

from app.storage.runtime_schema import ensure_runtime_schema
from app.workers import process_check


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
            ensure_runtime_schema(connection)

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
            connection.execute(
                "INSERT INTO simulation_claims(job_id, owner_host, owner_pid) VALUES (?, ?, ?)",
                (job_id, socket.gethostname(), os.getpid()),
            )
            connection.commit()
            return job_id

    def is_cancelled(self, job_id: str) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT 1 FROM simulation_cancellations WHERE job_id = ?", (job_id,)
            ).fetchone()
        return row is not None

    def clear_cancelled(self, job_id: str) -> None:
        """Clear the cooperative cancellation marker and claim after completion."""
        with self._connect() as connection:
            connection.execute("DELETE FROM simulation_cancellations WHERE job_id = ?", (job_id,))
            connection.execute("DELETE FROM simulation_claims WHERE job_id = ?", (job_id,))

    def record_solver_process(self, job_id: str, solver_pid: int) -> None:
        """Associate the active solver child PID with its queue claim."""
        with self._connect() as connection:
            connection.execute(
                "UPDATE simulation_claims SET solver_pid = ? WHERE job_id = ?",
                (solver_pid, job_id),
            )

    def reconcile_orphaned_claims(self) -> list[tuple[str, str, int, int | None]]:
        """Find same-host claims only after worker and solver processes are gone.

        Unknown hosts and permission-denied PID checks remain untouched. Returned
        claims are never requeued automatically because their output may be partial.
        """
        orphaned: list[tuple[str, str, int, int | None]] = []
        host = socket.gethostname()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(
                "SELECT job_id, owner_host, owner_pid, solver_pid FROM simulation_claims"
            ).fetchall()
            for job_id, owner_host, owner_pid, solver_pid in rows:
                if (
                    owner_host != host
                    or process_check.process_is_alive(int(owner_pid))
                    or (solver_pid is not None and process_check.process_is_alive(int(solver_pid)))
                ):
                    continue
                orphaned.append(
                    (str(job_id), str(owner_host), int(owner_pid), int(solver_pid) if solver_pid is not None else None)
                )
            connection.commit()
        return orphaned

    def pending_count(self) -> int:
        with self._connect() as connection:
            row = connection.execute("SELECT COUNT(*) FROM simulation_queue").fetchone()
        return int(row[0])
