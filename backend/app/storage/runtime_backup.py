"""Integrity-checked backup and restore for the local job/queue database."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from app.storage.runtime_schema import SCHEMA_VERSION

REQUIRED_TABLES = {"jobs", "simulation_queue", "simulation_cancellations"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _validate_database(path: Path, *, allow_legacy: bool = False) -> int:
    with closing(sqlite3.connect(path)) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        columns = (
            {row[1] for row in connection.execute("PRAGMA table_info(simulation_claims)")}
            if "simulation_claims" in tables
            else set()
        )
    if integrity != "ok":
        raise ValueError(f"SQLite integrity check failed: {integrity}")
    supported = {SCHEMA_VERSION, 2, 1} if allow_legacy else {SCHEMA_VERSION}
    if version not in supported:
        raise ValueError(f"Unsupported runtime database schema version: {version}")
    required = REQUIRED_TABLES | ({"simulation_claims"} if version >= 2 else set())
    if version >= 3:
        if "solver_pid" not in columns:
            raise ValueError("Runtime database schema 3 is missing solver_pid claim tracking")
    missing = required - tables
    if missing:
        raise ValueError(f"Runtime database is missing tables: {sorted(missing)}")
    return version


def backup_runtime_database(source: Path, destination: Path) -> dict[str, object]:
    source = Path(source)
    destination = Path(destination)
    if not source.is_file():
        raise FileNotFoundError(source)
    if destination.exists():
        raise FileExistsError(destination)
    _validate_database(source)
    destination.mkdir(parents=True)
    backup_path = destination / "jobs.sqlite3"
    try:
        with closing(sqlite3.connect(source)) as source_db, closing(sqlite3.connect(backup_path)) as backup_db:
            source_db.backup(backup_db)
        _validate_database(backup_path)
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "database": backup_path.name,
            "bytes": backup_path.stat().st_size,
            "sha256": _sha256(backup_path),
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "integrity": "ok",
            "scope": "local job records and queue state; no solver artifact files",
        }
        (destination / "manifest.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        return manifest
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise


def restore_runtime_database(backup_dir: Path, destination: Path) -> dict[str, object]:
    backup_dir = Path(backup_dir)
    destination = Path(destination)
    manifest_path = backup_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source = backup_dir / str(manifest.get("database", ""))
    manifest_version = int(manifest.get("schemaVersion", -1))
    if manifest_version not in {SCHEMA_VERSION, 2, 1}:
        raise ValueError("Unsupported runtime backup manifest version")
    if not source.is_file():
        raise FileNotFoundError(source)
    if source.stat().st_size != int(manifest.get("bytes", -1)):
        raise ValueError("Runtime backup byte count does not match manifest")
    if _sha256(source) != manifest.get("sha256"):
        raise ValueError("Runtime backup SHA-256 does not match manifest")
    source_version = _validate_database(source, allow_legacy=True)
    if source_version != manifest_version:
        raise ValueError("Runtime backup manifest schema version does not match its database")
    if destination.exists():
        raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        with closing(sqlite3.connect(source)) as source_db, closing(sqlite3.connect(temporary)) as destination_db:
            source_db.backup(destination_db)
        from app.storage.runtime_schema import ensure_runtime_schema

        with closing(sqlite3.connect(temporary)) as restored_db:
            ensure_runtime_schema(restored_db)
        _validate_database(temporary)
        # link() is an atomic create-if-absent operation on this same filesystem;
        # unlike replace(), it cannot overwrite a destination created in a race.
        os.link(temporary, destination)
        temporary.unlink()
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return {
        "database": str(destination),
        "bytes": destination.stat().st_size,
        "sha256": _sha256(destination),
        "integrity": "ok",
        "schemaVersion": SCHEMA_VERSION,
    }
