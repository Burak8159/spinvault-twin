from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from app.workers.artifact_reconciliation import audit_job_artifacts

CLI = Path(__file__).parents[1] / "scripts" / "audit_job_artifacts.py"


def _database(path: Path, records: list[dict]) -> None:
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE jobs(job_id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        connection.executemany(
            "INSERT INTO jobs(job_id, payload) VALUES (?, ?)",
            [(record["jobId"], json.dumps(record)) for record in records],
        )


def _job(identifier: str, status: str = "complete") -> dict:
    return {"jobId": identifier, "status": status, "requestedSolver": "demo"}


def _manifest(job_dir: Path, identifier: str, paths: list[str]) -> None:
    (job_dir / "artifacts.json").write_text(
        json.dumps({"jobId": identifier, "solver": "demo", "files": [
            {"id": f"file-{index}", "path": name} for index, name in enumerate(paths)
        ]}),
        encoding="utf-8",
    )


def test_reports_consistent_terminal_job_without_modifying_inputs(tmp_path: Path) -> None:
    database = tmp_path / "jobs.sqlite"
    root = tmp_path / "jobs"
    job_dir = root / "job-a"
    job_dir.mkdir(parents=True)
    (job_dir / "result.json").write_text("{}", encoding="utf-8")
    _manifest(job_dir, "job-a", ["result.json"])
    _database(database, [_job("job-a")])
    before = database.read_bytes()

    report = audit_job_artifacts(database, root)

    assert report["issues"] == []
    assert report["jobs"][0]["references"] == [
        {"id": "file-0", "path": "result.json", "status": "present", "bytes": 2}
    ]
    assert database.read_bytes() == before
    assert not list(root.rglob("*.tmp"))


def test_reports_unrecorded_directories_and_terminal_missing_artifacts(tmp_path: Path) -> None:
    database = tmp_path / "jobs.sqlite"
    root = tmp_path / "jobs"
    root.mkdir()
    (root / "orphan").mkdir()
    _database(database, [_job("missing")])

    report = audit_job_artifacts(database, root)

    assert "orphan" in report["orphan_directories"]
    kinds = {issue["kind"] for issue in report["issues"]}
    assert "artifact_directory_without_job_record" in kinds
    assert "terminal_job_directory_missing" in kinds


def test_active_job_without_directory_is_not_called_an_orphan_failure(tmp_path: Path) -> None:
    database = tmp_path / "jobs.sqlite"
    root = tmp_path / "jobs"
    root.mkdir()
    _database(database, [_job("queued", "queued")])

    report = audit_job_artifacts(database, root)

    assert report["issues"] == []
    assert report["jobs"][0]["artifact_dir"] == "missing"


@pytest.mark.parametrize("reference", ["../outside", "/tmp/outside", "..\\outside"])
def test_rejects_unsafe_manifest_paths(tmp_path: Path, reference: str) -> None:
    database = tmp_path / "jobs.sqlite"
    root = tmp_path / "jobs"
    job_dir = root / "job-a"
    job_dir.mkdir(parents=True)
    _manifest(job_dir, "job-a", [reference])
    _database(database, [_job("job-a")])

    report = audit_job_artifacts(database, root)

    assert any(issue["kind"] == "manifest_reference_unsafe_path" for issue in report["issues"])


def test_reports_symlinked_artifact_and_never_follows_it(tmp_path: Path) -> None:
    database = tmp_path / "jobs.sqlite"
    root = tmp_path / "jobs"
    job_dir = root / "job-a"
    job_dir.mkdir(parents=True)
    outside = tmp_path / "outside.json"
    outside.write_text("private", encoding="utf-8")
    (job_dir / "result.json").symlink_to(outside)
    _manifest(job_dir, "job-a", ["result.json"])
    _database(database, [_job("job-a")])

    report = audit_job_artifacts(database, root)

    assert any(issue["kind"] == "manifest_reference_symlink" for issue in report["issues"])


def test_refuses_symlink_artifact_root(tmp_path: Path) -> None:
    real_root = tmp_path / "real"
    real_root.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(real_root, target_is_directory=True)
    database = tmp_path / "jobs.sqlite"
    _database(database, [])

    with pytest.raises(ValueError, match="must not be a symlink"):
        audit_job_artifacts(database, alias)


def test_cli_writes_a_new_json_report_and_refuses_overwrite(tmp_path: Path) -> None:
    database = tmp_path / "jobs.sqlite"
    root = tmp_path / "jobs"
    root.mkdir()
    _database(database, [])
    report_path = tmp_path / "audit.json"
    command = [
        sys.executable,
        str(CLI),
        "--database",
        str(database),
        "--artifact-root",
        str(root),
        "--output",
        str(report_path),
    ]

    first = subprocess.run(command, capture_output=True, text=True, check=False)
    assert first.returncode == 0, first.stderr
    assert json.loads(report_path.read_text(encoding="utf-8"))["mode"] == "read_only"

    second = subprocess.run(command, capture_output=True, text=True, check=False)
    assert second.returncode != 0
    assert json.loads(report_path.read_text(encoding="utf-8"))["mode"] == "read_only"
