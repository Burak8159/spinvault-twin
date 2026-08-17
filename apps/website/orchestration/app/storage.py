from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
ARCHIVE_DIR = DATA_DIR / "archives"
DB_PATH = DATA_DIR / "spinvault_runs.sqlite3"


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                request_json TEXT NOT NULL,
                response_json TEXT NOT NULL,
                status TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                status TEXT NOT NULL,
                budget_units INTEGER NOT NULL,
                archive_path TEXT
            )
            """
        )


def save_run(run_id: str, request: dict[str, Any], response: dict[str, Any], status: str = "predicted") -> None:
    ensure_storage()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO runs (run_id, request_json, response_json, status) VALUES (?, ?, ?, ?)",
            (run_id, json.dumps(request), json.dumps(response), status),
        )


def save_job(job_id: str, run_id: str, status: str, budget_units: int, archive_path: str | None = None) -> None:
    ensure_storage()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO jobs (job_id, run_id, status, budget_units, archive_path) VALUES (?, ?, ?, ?, ?)",
            (job_id, run_id, status, budget_units, archive_path),
        )


def get_job(job_id: str) -> dict[str, Any] | None:
    ensure_storage()
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT job_id, run_id, created_at, status, budget_units, archive_path FROM jobs WHERE job_id = ?",
            (job_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "job_id": row[0],
        "run_id": row[1],
        "created_at": row[2],
        "status": row[3],
        "budget_units": row[4],
        "archive_path": row[5],
    }


def list_runs(limit: int = 25) -> list[dict[str, Any]]:
    ensure_storage()
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT run_id, created_at, status, response_json FROM runs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {"run_id": row[0], "created_at": row[1], "status": row[2], "response": json.loads(row[3])}
        for row in rows
    ]


def archive_validation(job_id: str, payload: dict[str, Any]) -> str:
    ensure_storage()
    path = ARCHIVE_DIR / f"{job_id}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return str(path)
