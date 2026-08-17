"""Worker queue, GPU detection, parser, and artifact tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.models.gpu import GpuInfo
from app.models.jobs import JobRecord
from app.models.provenance import Provenance, utc_now
from app.models.simulation import SimulationRequest
from app.solvers.mumax3.adapter import Mumax3Adapter
from app.storage.memory_store import InMemoryJobStore
from app.workers.artifacts import build_artifact_manifest, write_artifact_manifest
from app.workers.gpu import detect_gpu
from app.workers.local_worker import LocalWorker
from app.workers.parser import parse_job_outputs, parse_table_file
from app.workers.queue import InMemorySimulationQueue
from tests.conftest import drain_worker, sample_mumax_payload


def test_queue_enqueue_claim_cancel() -> None:
    queue = InMemorySimulationQueue()
    queue.enqueue("job_a")
    queue.enqueue("job_b")
    assert queue.pending_count() == 2
    assert queue.claim_next() == "job_a"
    queue.cancel("job_b")
    assert queue.is_cancelled("job_b")
    # Cancelled jobs remain claimable so the worker can mark them cancelled.
    assert queue.claim_next() == "job_b"
    assert queue.pending_count() == 0
    queue.enqueue("job_c")
    queue.cancel("job_c")
    queue.abandon("job_c")
    assert queue.claim_next() is None
    assert queue.is_cancelled("job_c") is False


def test_gpu_detection_fallback_without_nvidia(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.workers.gpu.shutil.which", lambda _name: None)
    info = detect_gpu()
    assert info.gpu_available is False
    assert info.acceleration == "not_configured"
    assert "No NVIDIA" in info.details


def test_gpu_detection_with_mocked_nvidia(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.workers.gpu.shutil.which", lambda _name: "/usr/bin/nvidia-smi")

    def runner(command: list[str], _timeout: float) -> tuple[int, str, str]:
        if any(part.startswith("--query-gpu") for part in command):
            return 0, "NVIDIA GeForce RTX 3050 Ti Laptop GPU, 560.94\n", ""
        return 0, "CUDA Version: 12.6\n", ""

    info = detect_gpu(runner=runner)
    assert info.gpu_available is True
    assert info.acceleration == "host_gpu_available"
    assert "RTX 3050" in info.devices[0]
    assert info.cuda_version == "12.6"
    assert "not a confirmed MuMax3" in info.details


def test_run_acceleration_requires_mumax_cuda_evidence() -> None:
    from app.models.gpu import GpuInfo
    from app.workers.gpu import run_acceleration_label

    gpu = GpuInfo(
        gpu_available=True,
        acceleration="host_gpu_available",
        details="host",
        devices=["NVIDIA GeForce RTX 3050 Ti Laptop GPU"],
    )
    assert (
        run_acceleration_label(gpu, success=True, stdout="relaxing...", stderr="")
        == "not_configured"
    )
    assert (
        run_acceleration_label(
            gpu,
            success=True,
            stdout="CUDA Device 0\nusing cc=86 PTX\n",
            stderr="",
        )
        == "rtx"
    )
    assert (
        run_acceleration_label(
            GpuInfo(
                gpu_available=True,
                acceleration="host_gpu_available",
                details="host",
                devices=["NVIDIA Tesla T4"],
            ),
            success=True,
            stdout="initializing CUDA\n",
            stderr="",
        )
        == "cuda"
    )
    assert (
        run_acceleration_label(gpu, success=False, stdout="CUDA Device 0\n", stderr="")
        == "not_configured"
    )


def test_parser_sample_table(tmp_path: Path) -> None:
    table = tmp_path / "table.txt"
    table.write_text("t mx my mz\n0 1 0 0\n1e-9 0.9 0.1 0\n", encoding="utf-8")
    series, warnings = parse_table_file(table)
    assert warnings == []
    assert len(series) == 3
    assert series[0].source_file == "table.txt"
    assert series[0].y_unit == "dimensionless"
    assert series[0].points[0] == (0.0, 1.0)


def test_parser_real_mumax_tsv_header_and_single_smoke_row(tmp_path: Path) -> None:
    table = tmp_path / "table.txt"
    table.write_text(
        "# t (s)\tmx ()\tmy ()\tmz ()\tB_extx (T)\tcustom_value (A/m)\n"
        "0\t1\t0\t0\t0.01\t42\n",
        encoding="utf-8",
    )

    series, warnings = parse_table_file(table)

    assert warnings == []
    assert len(series) == 5
    assert series[0].x_unit == "s"
    assert series[0].y_unit == "dimensionless"
    assert series[0].points == [(0.0, 1.0)]
    # Solver-declared units are preserved, but unknown column semantics are not guessed.
    assert series[3].label == "B_extx (unknown column)"
    assert series[3].y_unit == "T"
    assert series[4].label == "custom_value (unknown column)"
    assert series[4].y_unit == "A/m"


def test_parser_malformed_table(tmp_path: Path) -> None:
    table = tmp_path / "table.txt"
    table.write_text("not a table\n", encoding="utf-8")
    series, warnings = parse_table_file(table)
    assert series == []
    assert warnings


def test_parse_job_outputs_missing_tables(tmp_path: Path) -> None:
    result = parse_job_outputs(
        tmp_path,
        job_id="job_x",
        solver="mumax3",
        is_physical_simulation=False,
        provenance=Provenance(created_by="system", solver="mumax3", notes=[]),
    )
    assert result.series == []
    assert any("No known table" in w for w in result.warnings)
    assert result.is_physical_simulation is False


def test_artifact_manifest_generation(tmp_path: Path) -> None:
    (tmp_path / "request.json").write_text("{}", encoding="utf-8")
    (tmp_path / "status.json").write_text("{}", encoding="utf-8")
    (tmp_path / "stdout.log").write_text("ok\n", encoding="utf-8")
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    (outputs / "table.txt").write_text("t mx\n0 1\n", encoding="utf-8")
    manifest = write_artifact_manifest(tmp_path, job_id="job_art", solver="mumax3")
    assert (tmp_path / "artifacts.json").exists()
    paths = {ref.path for ref in manifest.files}
    assert "request.json" in paths
    assert "stdout.log" in paths
    assert "outputs/table.txt" in paths
    rebuilt = build_artifact_manifest(tmp_path, job_id="job_art", solver="mumax3")
    assert len(rebuilt.files) >= len(manifest.files) - 1  # artifacts.json may appear on second pass


def test_worker_does_not_substitute_python_llg_when_mumax_missing(tmp_path: Path) -> None:
    store = InMemoryJobStore()
    queue = InMemorySimulationQueue()
    settings = Settings(mumax3_binary=None, job_root=tmp_path / "jobs", worker_enabled=False)
    worker = LocalWorker(
        store=store,
        queue=queue,
        settings=settings,
        gpu_detector=lambda: detect_gpu(runner=lambda *_: (127, "", "missing")),
    )
    request = SimulationRequest.model_validate(sample_mumax_payload())
    job = JobRecord(
        job_id="job_nc",
        scenario_id=request.scenario_id,
        title=request.title,
        requested_solver="mumax3",
        status="queued",
        progress_phase="queued",
        created_at=utc_now(),
        updated_at=utc_now(),
        provenance=Provenance(created_by="system", solver="mumax3", notes=["queued"]),
        request=request,
    )
    store.create(job)
    queue.enqueue(job.job_id)
    assert worker.run_once() is True
    done = store.get(job.job_id)
    assert done is not None
    assert done.status == "not_configured"
    assert done.result is None
    assert any(error.code == "mumax3_not_configured" for error in done.errors)
    job_dir = settings.job_root / job.job_id
    assert (job_dir / "status.json").exists()
    assert (job_dir / "artifacts.json").exists()
    assert (job_dir / "generated.mx3").exists()
    assert (job_dir / "input_parameters.json").exists()
    assert (job_dir / "run_metadata.json").exists()
    assert not (job_dir / "python_llg.txt").exists()
    assert not (job_dir / "result.json").exists()
    assert not (job_dir / "outputs" / "table.txt").exists()


def test_worker_parses_representative_real_mumax_smoke_output(tmp_path: Path) -> None:
    binary = tmp_path / "fake-mumax3"
    binary.write_text("#!/bin/sh\n", encoding="utf-8")
    binary.chmod(0o755)

    def runner(command: list[str], cwd: Path, _timeout: float):
        if "-v" in command:
            return 0, False, "mumax3 3.12 windows_amd64 CUDA-12.6\n", ""
        out_dir = cwd / "generated.out"
        out_dir.mkdir(exist_ok=True)
        (out_dir / "table.txt").write_text(
            "# t (s)\tmx ()\tmy ()\tmz ()\tB_extx (T)\n"
            "0\t1\t0\t0\t0.01\n"
            "1e-12\t0.999\t0.001\t0\t0.01\n",
            encoding="utf-8",
        )
        (out_dir / "references.bib").write_text(
            "@article{mumax3, title={MuMax3}}\n",
            encoding="utf-8",
        )
        return (
            0,
            False,
            "NVIDIA GeForce RTX 3050 Ti Laptop GPU\nusing cc=86 PTX\n",
            "",
        )

    settings = Settings(
        mumax3_binary=str(binary),
        job_root=tmp_path / "jobs",
        worker_enabled=False,
    )
    store = InMemoryJobStore()
    queue = InMemorySimulationQueue()
    worker = LocalWorker(
        store=store,
        queue=queue,
        settings=settings,
        adapter=Mumax3Adapter(settings=settings, runner=runner),
        gpu_detector=lambda: GpuInfo(
            gpu_available=True,
            acceleration="host_gpu_available",
            details="Host GPU detected.",
            devices=["NVIDIA GeForce RTX 3050 Ti Laptop GPU"],
            driver_version="12.7",
            cuda_version="12.6",
        ),
    )
    request = SimulationRequest.model_validate(sample_mumax_payload())
    job = JobRecord(
        job_id="job_real_format",
        scenario_id=request.scenario_id,
        title=request.title,
        requested_solver="mumax3",
        status="queued",
        progress_phase="queued",
        created_at=utc_now(),
        updated_at=utc_now(),
        provenance=Provenance(created_by="system", solver="mumax3", notes=["queued"]),
        request=request,
    )
    store.create(job)
    queue.enqueue(job.job_id)

    assert worker.run_once() is True
    done = store.get(job.job_id)
    assert done is not None
    assert done.status == "complete"
    assert done.result is not None
    assert done.result.source == "mumax3"
    assert done.result.is_physical_simulation is True
    assert len(done.result.series) == 4
    assert done.result.series[0].points
    assert any(
        metric.id == "acceleration" and metric.display_value == "rtx"
        for metric in done.result.metrics
    )
    job_dir = settings.job_root / job.job_id
    assert (job_dir / "outputs" / "table.txt").exists()
    assert (job_dir / "outputs" / "references.bib").exists()


def test_worker_crash_failure_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemoryJobStore()
    queue = InMemorySimulationQueue()
    settings = Settings(mumax3_binary=str(tmp_path / "fake"), job_root=tmp_path / "jobs", worker_enabled=False)
    (tmp_path / "fake").write_text("#!/bin/sh\n", encoding="utf-8")
    (tmp_path / "fake").chmod(0o755)
    adapter = Mumax3Adapter(settings=settings)

    def boom(_request, *, job_id: str):  # noqa: ARG001
        raise RuntimeError("simulated prepare failure")

    monkeypatch.setattr(adapter, "is_available", lambda: True)
    monkeypatch.setattr(adapter, "prepare", boom)
    worker = LocalWorker(
        store=store,
        queue=queue,
        settings=settings,
        adapter=adapter,
        gpu_detector=lambda: __import__("app.models.gpu", fromlist=["GpuInfo"]).GpuInfo(
            gpu_available=False,
            acceleration="not_configured",
            details="No NVIDIA runtime detected.",
        ),
    )
    request = SimulationRequest.model_validate(sample_mumax_payload())
    job = JobRecord(
        job_id="job_crash",
        scenario_id=request.scenario_id,
        title=request.title,
        requested_solver="mumax3",
        status="queued",
        created_at=utc_now(),
        updated_at=utc_now(),
        provenance=Provenance(created_by="system", solver="mumax3", notes=[]),
        request=request,
    )
    store.create(job)
    queue.enqueue(job.job_id)
    assert worker.run_once() is True
    done = store.get(job.job_id)
    assert done is not None
    assert done.status == "failed"
    assert any(error.code == "worker_crash" for error in done.errors)


def test_worker_cancellation(tmp_path: Path) -> None:
    store = InMemoryJobStore()
    queue = InMemorySimulationQueue()
    settings = Settings(mumax3_binary=None, job_root=tmp_path / "jobs", worker_enabled=False)
    worker = LocalWorker(store=store, queue=queue, settings=settings)
    request = SimulationRequest.model_validate(sample_mumax_payload())
    job = JobRecord(
        job_id="job_cancel",
        scenario_id=request.scenario_id,
        title=request.title,
        requested_solver="mumax3",
        status="queued",
        created_at=utc_now(),
        updated_at=utc_now(),
        provenance=Provenance(created_by="system", solver="mumax3", notes=[]),
        request=request,
    )
    store.create(job)
    queue.enqueue(job.job_id)
    queue.cancel(job.job_id)
    assert worker.run_once() is True
    done = store.get(job.job_id)
    assert done is not None
    assert done.status == "cancelled"


def test_api_mumax_queued_then_worker(client: TestClient) -> None:
    response = client.post("/api/simulations", json=sample_mumax_payload())
    assert response.status_code == 201
    job = response.json()["job"]
    assert job["status"] == "queued"
    assert job["progressPhase"] == "queued"
    worker_status = client.get("/api/worker").json()
    assert worker_status["pendingJobs"] >= 1
    drain_worker(client)
    job = client.get(f"/api/simulations/{job['jobId']}").json()
    assert job["status"] == "not_configured"
    assert job["workerId"]
    assert job["result"] is None
    assert any(error["code"] == "mumax3_not_configured" for error in job["errors"])


def test_api_cancel_queued_mumax(client: TestClient) -> None:
    created = client.post("/api/simulations", json=sample_mumax_payload()).json()["job"]
    assert created["status"] == "queued"
    cancelled = client.post(f"/api/simulations/{created['jobId']}/cancel").json()
    assert cancelled["status"] == "cancelled"
    drain_worker(client)
    final = client.get(f"/api/simulations/{created['jobId']}").json()
    assert final["status"] == "cancelled"


def test_solvers_includes_gpu(client: TestClient) -> None:
    body = client.get("/api/solvers").json()
    assert "gpu" in body
    assert body["gpu"]["acceleration"] in {
        "not_configured",
        "host_gpu_available",
        "gpu_detected",
    } or isinstance(body["gpu"]["gpuAvailable"], bool)
    assert body["mumax3"]["asyncWorker"] is True
