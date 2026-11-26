"""Read-only audit of local job records and their on-disk artifact manifests."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

TERMINAL_STATUSES = {"complete", "failed", "cancelled", "interrupted"}


def _read_only_connection(path: Path) -> sqlite3.Connection:
    resolved = path.resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("job database must be an existing regular file")
    uri = resolved.as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def _safe_manifest_file(job_dir: Path, raw_path: Any) -> tuple[str, str | None, int | None]:
    if not isinstance(raw_path, str) or not raw_path or "\\" in raw_path:
        return "unsafe_path", None, None
    relative = Path(raw_path)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        return "unsafe_path", None, None
    candidate = job_dir / relative
    if candidate.is_symlink():
        return "symlink", str(relative), None
    try:
        resolved = candidate.resolve(strict=False)
        resolved.relative_to(job_dir.resolve(strict=True))
    except (OSError, ValueError):
        return "unsafe_path", None, None
    if not candidate.is_file():
        return "missing", str(relative), None
    try:
        return "present", str(relative), candidate.stat().st_size
    except OSError:
        return "unreadable", str(relative), None


def audit_job_artifacts(database: Path, job_root: Path) -> dict[str, Any]:
    """Inventory job records and artifacts without modifying either source.

    The audit intentionally does not delete, move, retry, or repair anything. A
    computed inventory is observational only: the current worker manifest format
    does not carry per-file checksums, so it cannot certify artifact integrity.
    """
    root = Path(job_root)
    if root.is_symlink():
        raise ValueError("job artifact root must not be a symlink")
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("job artifact root must be an existing directory")

    records: dict[str, dict[str, Any]] = {}
    issues: list[dict[str, Any]] = []
    with _read_only_connection(Path(database)) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        if "jobs" not in tables:
            raise ValueError("job database has no jobs table")
        for row in connection.execute("SELECT job_id, payload FROM jobs ORDER BY job_id"):
            job_id = str(row["job_id"])
            try:
                payload = json.loads(row["payload"])
                payload_id = payload.get("jobId", payload.get("job_id"))
                status = payload.get("status")
                if payload_id != job_id or not isinstance(status, str):
                    raise ValueError("record identity or status is invalid")
                records[job_id] = {"status": status, "requested_solver": payload.get("requestedSolver")}
            except (TypeError, json.JSONDecodeError, ValueError) as exc:
                issues.append({"kind": "invalid_job_record", "job_id": job_id, "detail": str(exc)})

    directories: dict[str, Path] = {}
    for child in sorted(root.iterdir(), key=lambda value: value.name):
        if child.is_symlink():
            issues.append({"kind": "symlink_job_entry", "name": child.name})
        elif child.is_dir():
            directories[child.name] = child
        elif child.name not in {".DS_Store"}:
            issues.append({"kind": "non_directory_job_root_entry", "name": child.name})

    job_reports: list[dict[str, Any]] = []
    for job_id, record in records.items():
        job_dir = directories.get(job_id)
        entry: dict[str, Any] = {"job_id": job_id, "status": record["status"], "artifact_dir": "present" if job_dir else "missing"}
        if job_dir is None:
            if record["status"] in TERMINAL_STATUSES:
                issues.append({"kind": "terminal_job_directory_missing", "job_id": job_id})
            job_reports.append(entry)
            continue

        manifest_path = job_dir / "artifacts.json"
        entry["manifest"] = "present" if manifest_path.is_file() and not manifest_path.is_symlink() else "missing_or_unsafe"
        if not manifest_path.exists() or manifest_path.is_symlink() or not manifest_path.is_file():
            if record["status"] in TERMINAL_STATUSES:
                issues.append({"kind": "terminal_job_manifest_missing", "job_id": job_id})
            job_reports.append(entry)
            continue

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(manifest, dict) or manifest.get("jobId", manifest.get("job_id")) != job_id:
                raise ValueError("manifest identity does not match directory")
            files = manifest.get("files")
            if not isinstance(files, list):
                raise ValueError("manifest files must be a list")
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
            issues.append({"kind": "invalid_artifact_manifest", "job_id": job_id, "detail": str(exc)})
            job_reports.append(entry)
            continue

        references: list[dict[str, Any]] = []
        listed_paths = {"artifacts.json"}
        for item in files:
            if not isinstance(item, dict):
                references.append({"status": "invalid_entry"})
                continue
            status, relative, size = _safe_manifest_file(job_dir, item.get("path"))
            reference = {"id": item.get("id"), "path": relative, "status": status, "bytes": size}
            references.append(reference)
            if relative:
                listed_paths.add(relative)
            if status != "present":
                issues.append({"kind": f"manifest_reference_{status}", "job_id": job_id, "path": relative})
        entry["references"] = references
        unlisted = []
        for path in sorted(job_dir.rglob("*")):
            try:
                relative = path.relative_to(job_dir).as_posix()
            except ValueError:
                continue
            if path.is_symlink():
                issues.append({"kind": "symlink_inside_job_directory", "job_id": job_id, "path": relative})
            elif path.is_file() and relative not in listed_paths:
                unlisted.append({"path": relative, "bytes": path.stat().st_size})
        entry["unlisted_files_observed"] = unlisted
        job_reports.append(entry)

    orphan_dirs = sorted(set(directories) - set(records))
    for job_id in orphan_dirs:
        issues.append({"kind": "artifact_directory_without_job_record", "job_id": job_id})

    return {
        "schema_version": "1.0",
        "mode": "read_only",
        "database": str(Path(database).resolve()),
        "artifact_root": str(root),
        "record_count": len(records),
        "directory_count": len(directories),
        "jobs": job_reports,
        "orphan_directories": orphan_dirs,
        "issues": issues,
        "limitations": [
            "No database or artifact files were changed.",
            "Orphaned work is reported for review and is never retried or deleted.",
            "Artifact manifests do not include content hashes; present files are not integrity-certified.",
            "This is a single-host local inventory and does not reconcile multi-host ownership or backups.",
        ],
    }
