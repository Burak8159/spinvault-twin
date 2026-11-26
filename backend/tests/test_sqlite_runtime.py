from __future__ import annotations

from pathlib import Path

import pytest
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
import sqlite3

from app.models.jobs import JobRecord
from app.models.provenance import Provenance, utc_now
from app.models.simulation import SimulationRequest
from app.services.jobs import JobService
from app.services.solver_router import SolverRouter
from app.config import Settings
from app.storage.runtime_backup import backup_runtime_database, restore_runtime_database
from app.storage.sqlite_store import SQLiteJobStore
from app.workers.local_worker import LocalWorker
from app.workers.recovery import reconcile_interrupted_jobs
from app.workers import process_check
from app.workers.sqlite_queue import SQLiteSimulationQueue


def _job(job_id: str = "durable-job") -> JobRecord:
    now = utc_now()
    return JobRecord(
        job_id=job_id,
        scenario_id="sqlite-runtime-test",
        title="Durability fixture",
        requested_solver="mumax3",
        status="queued",
        created_at=now,
        updated_at=now,
        provenance=Provenance(created_by="system", solver="mumax3", notes=["test only"]),
    )


def test_sqlite_job_store_survives_reconstruction(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    first = SQLiteJobStore(database)
    first.create(_job())

    second = SQLiteJobStore(database)
    restored = second.get("durable-job")
    assert restored is not None
    assert restored.title == "Durability fixture"
    assert restored.provenance.notes == ["test only"]

    restored.title = "Updated title"
    second.update(restored)
    assert first.get("durable-job").title == "Updated title"  # type: ignore[union-attr]


def test_sqlite_queue_survives_reconstruction_and_claim_is_atomic(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    first = SQLiteSimulationQueue(database)
    first.enqueue("job-a")
    first.enqueue("job-a")  # idempotent enqueue
    assert first.pending_count() == 1

    second = SQLiteSimulationQueue(database)
    assert second.pending_count() == 1
    assert first.claim_next() == "job-a"
    assert second.claim_next() is None
    assert second.pending_count() == 0


def test_concurrent_sqlite_claimers_cannot_claim_same_job(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    SQLiteSimulationQueue(database).enqueue("single-claim")
    queues = [SQLiteSimulationQueue(database) for _ in range(8)]
    with ThreadPoolExecutor(max_workers=len(queues)) as executor:
        claims = list(executor.map(lambda queue: queue.claim_next(), queues))
    assert claims.count("single-claim") == 1
    assert claims.count(None) == len(queues) - 1


def test_queued_job_and_queue_entry_commit_together(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    store = SQLiteJobStore(database)
    queue = SQLiteSimulationQueue(database)
    job = _job()
    store.create(job)
    job.status = "queued"
    job.progress_phase = "queued"
    store.enqueue_job(job)

    assert SQLiteJobStore(database).get(job.job_id).status == "queued"  # type: ignore[union-attr]
    assert SQLiteSimulationQueue(database).claim_next() == job.job_id


def test_cancel_and_queued_abandon_are_visible_across_instances(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    api_queue = SQLiteSimulationQueue(database)
    worker_queue = SQLiteSimulationQueue(database)
    api_queue.enqueue("pending")
    api_queue.cancel("pending")
    api_queue.abandon("pending")
    assert api_queue.pending_count() == 0
    assert not worker_queue.is_cancelled("pending")

    api_queue.enqueue("claimed")
    assert worker_queue.claim_next() == "claimed"
    api_queue.cancel("claimed")
    api_queue.abandon("claimed")
    assert worker_queue.is_cancelled("claimed")
    worker_queue.clear_cancelled("claimed")
    assert not api_queue.is_cancelled("claimed")


def test_sqlite_store_rejects_duplicate_and_missing_updates(tmp_path: Path) -> None:
    store = SQLiteJobStore(tmp_path / "runtime.sqlite3")
    store.create(_job())
    with pytest.raises(ValueError, match="already exists"):
        store.create(_job())
    with pytest.raises(KeyError, match="not found"):
        store.update(_job("missing"))


def test_runtime_backup_restore_verifies_and_preserves_records(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite3"
    store = SQLiteJobStore(source)
    store.create(_job())
    queue = SQLiteSimulationQueue(source)
    queue.enqueue("durable-job")

    backup_dir = tmp_path / "backup"
    manifest = backup_runtime_database(source, backup_dir)
    restored_path = tmp_path / "restored.sqlite3"
    restore_runtime_database(backup_dir, restored_path)

    assert SQLiteJobStore(restored_path).get("durable-job") is not None
    assert SQLiteSimulationQueue(restored_path).pending_count() == 1
    assert manifest["integrity"] == "ok"


def test_runtime_restore_rejects_tamper_and_existing_target(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite3"
    SQLiteJobStore(source)
    SQLiteSimulationQueue(source)
    backup_dir = tmp_path / "backup"
    backup_runtime_database(source, backup_dir)

    with (backup_dir / "jobs.sqlite3").open("ab") as stream:
        stream.write(b"tamper")
    with pytest.raises(ValueError, match="byte count"):
        restore_runtime_database(backup_dir, tmp_path / "restored.sqlite3")
    with pytest.raises(FileExistsError):
        backup_runtime_database(source, backup_dir)


def test_api_submission_is_visible_to_reconstructed_worker(tmp_path: Path) -> None:
    from tests.conftest import sample_mumax_payload

    database = tmp_path / "runtime.sqlite3"
    api_service = JobService(
        store=SQLiteJobStore(database),
        router=SolverRouter(),
        queue=SQLiteSimulationQueue(database),
    )
    queued = api_service.submit(SimulationRequest.model_validate(sample_mumax_payload()))
    assert queued.status == "queued"

    worker = LocalWorker(
        store=SQLiteJobStore(database),
        queue=SQLiteSimulationQueue(database),
        settings=Settings(mumax3_binary=None, job_root=tmp_path / "artifacts", worker_enabled=False),
    )
    assert worker.run_once() is True
    final = SQLiteJobStore(database).get(queued.job_id)
    assert final is not None
    assert final.status == "not_configured"


def test_default_sqlite_api_records_and_pending_queue_survive_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.deps import reset_runtime
    from app.main import create_app
    from tests.conftest import sample_mumax_payload

    database = tmp_path / "api-runtime.sqlite3"
    monkeypatch.setenv("SPINVAULT_JOB_STORE", "sqlite")
    monkeypatch.setenv("SPINVAULT_JOB_DATABASE", str(database))
    monkeypatch.setenv("SPINVAULT_WORKER_ENABLED", "false")
    reset_runtime()
    try:
        with TestClient(create_app()) as first_app:
            created = first_app.post("/api/simulations", json=sample_mumax_payload()).json()["job"]
            assert created["status"] == "queued"

        reset_runtime()
        with TestClient(create_app()) as restarted_app:
            restored = restarted_app.get(f"/api/simulations/{created['jobId']}").json()
            assert restored["status"] == "queued"
            assert restarted_app.get("/api/worker").json()["pendingJobs"] == 1
    finally:
        reset_runtime()


def test_api_startup_reconciles_dead_claim_and_does_not_requeue(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.deps import get_job_store, get_simulation_queue, reset_runtime
    from app.main import create_app
    from tests.conftest import sample_mumax_payload

    database = tmp_path / "api-interruption.sqlite3"
    monkeypatch.setenv("SPINVAULT_JOB_STORE", "sqlite")
    monkeypatch.setenv("SPINVAULT_JOB_DATABASE", str(database))
    monkeypatch.setenv("SPINVAULT_WORKER_ENABLED", "false")
    reset_runtime()
    try:
        with TestClient(create_app()) as first_app:
            created = first_app.post("/api/simulations", json=sample_mumax_payload()).json()["job"]
            queue = get_simulation_queue()
            assert queue.claim_next() == created["jobId"]
            job = get_job_store().get(created["jobId"])
            job.status = "running_solver"
            job.progress_phase = "running_solver"
            get_job_store().update(job)

        monkeypatch.setattr(process_check, "process_is_alive", lambda _pid: False)
        reset_runtime()
        with TestClient(create_app()) as restarted_app:
            restored = restarted_app.get(f"/api/simulations/{created['jobId']}").json()
            assert restored["status"] == "interrupted"
            assert any(warning["code"] == "worker_interrupted" for warning in restored["warnings"])
            assert restarted_app.get("/api/worker").json()["pendingJobs"] == 0
    finally:
        reset_runtime()


def test_confirmed_dead_claim_becomes_interrupted_without_retry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    database = tmp_path / "runtime.sqlite3"
    store = SQLiteJobStore(database)
    queue = SQLiteSimulationQueue(database)
    job = _job()
    store.create(job)
    queue.enqueue(job.job_id)
    assert queue.claim_next() == job.job_id
    job.status = "running_solver"
    job.progress_phase = "running_solver"
    store.update(job)

    monkeypatch.setattr(process_check, "process_is_alive", lambda _pid: False)
    assert reconcile_interrupted_jobs(store, queue) == [job.job_id]
    interrupted = store.get(job.job_id)
    assert interrupted is not None
    assert interrupted.status == "interrupted"
    assert any(warning.code == "worker_interrupted" for warning in interrupted.warnings)
    assert queue.pending_count() == 0
    assert queue.reconcile_orphaned_claims() == []
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM simulation_claims").fetchone()[0] == 0


def test_completed_job_is_not_downgraded_by_stale_claim(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    database = tmp_path / "runtime.sqlite3"
    store = SQLiteJobStore(database)
    queue = SQLiteSimulationQueue(database)
    job = _job()
    job.status = "complete"
    store.create(job)
    queue.enqueue(job.job_id)
    assert queue.claim_next() == job.job_id
    monkeypatch.setattr(process_check, "process_is_alive", lambda _pid: False)

    assert reconcile_interrupted_jobs(store, queue) == []
    assert store.get(job.job_id).status == "complete"  # type: ignore[union-attr]


def test_competing_startup_recovery_updates_claim_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    database = tmp_path / "runtime.sqlite3"
    store = SQLiteJobStore(database)
    queue = SQLiteSimulationQueue(database)
    job = _job("recover-once")
    store.create(job)
    queue.enqueue(job.job_id)
    assert queue.claim_next() == job.job_id
    job.status = "running_solver"
    job.progress_phase = "running_solver"
    store.update(job)
    monkeypatch.setattr(process_check, "process_is_alive", lambda _pid: False)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                lambda _index: reconcile_interrupted_jobs(
                    SQLiteJobStore(database), SQLiteSimulationQueue(database)
                ),
                range(2),
            )
        )

    assert sorted(results, key=len) == [[], [job.job_id]]
    recovered = SQLiteJobStore(database).get(job.job_id)
    assert recovered is not None and recovered.status == "interrupted"
    assert [warning.code for warning in recovered.warnings].count("worker_interrupted") == 1


def test_runtime_schema_v1_migrates_by_adding_claim_tracking(tmp_path: Path) -> None:
    database = tmp_path / "legacy-v1.sqlite3"
    legacy_job = _job("legacy-job")
    with sqlite3.connect(database) as connection:
        connection.executescript(
            """CREATE TABLE jobs(job_id TEXT PRIMARY KEY, payload TEXT NOT NULL,
                   created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
               CREATE TABLE simulation_queue(job_id TEXT PRIMARY KEY, enqueued_at TEXT NOT NULL);
               CREATE TABLE simulation_cancellations(job_id TEXT PRIMARY KEY, requested_at TEXT NOT NULL);
               PRAGMA user_version = 1;"""
        )
        connection.execute(
            "INSERT INTO jobs VALUES (?, ?, ?, ?)",
            (
                legacy_job.job_id,
                legacy_job.model_dump_json(by_alias=True),
                legacy_job.created_at.isoformat(),
                legacy_job.updated_at.isoformat(),
            ),
        )
        connection.execute("INSERT INTO simulation_queue(job_id, enqueued_at) VALUES (?, ?)", ("legacy-job", "2026"))

    SQLiteJobStore(database)
    SQLiteSimulationQueue(database)
    with sqlite3.connect(database) as connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert version == 2
    assert "simulation_claims" in tables
    assert SQLiteJobStore(database).get("legacy-job").job_id == "legacy-job"  # type: ignore[union-attr]
    assert SQLiteSimulationQueue(database).claim_next() == "legacy-job"
