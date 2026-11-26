"""Shared schema initialization for the local SQLite job runtime."""

from __future__ import annotations

import sqlite3

SCHEMA_VERSION = 3


def ensure_runtime_schema(connection: sqlite3.Connection) -> None:
    """Create tables and apply additive claim metadata migrations atomically."""
    version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if version > SCHEMA_VERSION:
        raise RuntimeError(f"Unsupported job database schema version: {version}")
    connection.execute("BEGIN IMMEDIATE")
    connection.execute(
        """CREATE TABLE IF NOT EXISTS jobs (
            job_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"""
    )
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
    connection.execute(
        """CREATE TABLE IF NOT EXISTS simulation_claims (
            job_id TEXT PRIMARY KEY,
            owner_host TEXT NOT NULL,
            owner_pid INTEGER NOT NULL,
            solver_pid INTEGER,
            claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        )"""
    )
    claim_columns = {
        str(row[1]) for row in connection.execute("PRAGMA table_info(simulation_claims)")
    }
    if "solver_pid" not in claim_columns:
        connection.execute("ALTER TABLE simulation_claims ADD COLUMN solver_pid INTEGER")
    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    connection.commit()
