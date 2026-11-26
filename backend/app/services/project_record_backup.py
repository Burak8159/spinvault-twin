"""Hash-verified, no-overwrite backup and restore for the local project-record store."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path

FORMAT_VERSION = 1
SUPPORTED_SCHEMA_VERSION = 1
DATABASE_NAME = "project_records.sqlite3"
MANIFEST_NAME = "manifest.json"


def _database_facts(path: Path) -> tuple[int, str]:
    uri = f"{path.resolve().as_uri()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as db:
        check = db.execute("PRAGMA quick_check").fetchone()[0]
        if check != "ok":
            raise ValueError("Project-record database failed SQLite integrity check")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "schema_migrations" not in tables or "project_record_revisions" not in tables:
            raise ValueError("Project-record database schema is incomplete")
        version = db.execute("SELECT COALESCE(MAX(version),0) FROM schema_migrations").fetchone()[0]
        if not isinstance(version, int) or version < 1 or version > SUPPORTED_SCHEMA_VERSION:
            raise ValueError("Project-record database schema version is unsupported")
    return version, check


def backup_database(source: Path, destination: Path) -> dict:
    source, destination = Path(source), Path(destination)
    if source.is_symlink() or not source.is_file():
        raise ValueError("Source database must be an existing regular file")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.mkdir(exist_ok=False)
    try:
        database = destination / DATABASE_NAME
        source_uri = f"{source.resolve().as_uri()}?mode=ro"
        with sqlite3.connect(source_uri, uri=True) as src, sqlite3.connect(database) as dst:
            src.backup(dst)
        schema_version, _ = _database_facts(database)
        digest = hashlib.sha256(database.read_bytes()).hexdigest()
        manifest = {
            "backup_format_version": FORMAT_VERSION,
            "database_file": DATABASE_NAME,
            "database_bytes": database.stat().st_size,
            "database_sha256": digest,
            "schema_version": schema_version,
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
        }
        manifest_path = destination / MANIFEST_NAME
        with manifest_path.open("x", encoding="utf-8") as output:
            json.dump(manifest, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        return manifest
    except Exception:
        shutil.rmtree(destination)
        raise


def restore_database(backup: Path, destination: Path) -> dict:
    backup, destination = Path(backup), Path(destination)
    if destination.exists() or destination.is_symlink():
        raise FileExistsError("Restore destination already exists; no data was overwritten")
    if not backup.is_dir() or backup.is_symlink():
        raise ValueError("Backup must be a regular directory")
    manifest_path = backup / MANIFEST_NAME
    database = backup / DATABASE_NAME
    if manifest_path.is_symlink() or database.is_symlink() or not manifest_path.is_file() or not database.is_file():
        raise ValueError("Backup is missing regular database or manifest files")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("Backup manifest must be a JSON object")
    if manifest.get("backup_format_version") != FORMAT_VERSION or manifest.get("database_file") != DATABASE_NAME:
        raise ValueError("Backup format is unsupported")
    content = database.read_bytes()
    expected_size, expected_hash = manifest.get("database_bytes"), manifest.get("database_sha256")
    if not isinstance(expected_size, int) or isinstance(expected_size, bool) or expected_size < 0 or not isinstance(expected_hash, str):
        raise ValueError("Backup manifest size or checksum is invalid")
    if len(content) != expected_size or hashlib.sha256(content).hexdigest() != expected_hash:
        raise ValueError("Backup database hash or size mismatch")
    schema_version, _ = _database_facts(database)
    if schema_version != manifest.get("schema_version"):
        raise ValueError("Backup schema version does not match its manifest")
    destination.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".restore", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, destination)
        return manifest
    finally:
        temporary.unlink(missing_ok=True)
