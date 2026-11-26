from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

import pytest

from app.solvers.mumax3.runner import CANCELLED_RETURN_CODE, default_runner
from app.config import Settings
from app.models.jobs import JobRecord
from app.models.provenance import Provenance, utc_now
from app.models.simulation import SimulationRequest
from app.storage.memory_store import InMemoryJobStore
from app.workers.gpu import detect_gpu
from app.workers.local_worker import LocalWorker
from app.workers.queue import InMemorySimulationQueue
from app.workers.process_check import process_is_alive
from tests.conftest import sample_mumax_payload


def test_default_runner_captures_completed_process(tmp_path: Path) -> None:
    code, timed_out, stdout, stderr = default_runner(
        [sys.executable, "-c", "print('solver-output')"], tmp_path, 5
    )
    assert code == 0
    assert not timed_out
    assert stdout.strip() == "solver-output"
    assert stderr == ""


def test_default_runner_terminates_and_reaps_cancelled_process_group(tmp_path: Path) -> None:
    if os.name == "nt":
        pytest.skip("POSIX process-group fixture; Windows uses taskkill /T in the runner")
    child_pid_path = tmp_path / "child.pid"
    child_stopped_path = tmp_path / "child.stopped"
    child_code = (
        "import pathlib,signal,sys,time; "
        f"p=pathlib.Path({str(child_stopped_path)!r}); "
        "signal.signal(signal.SIGTERM, lambda *_: (p.write_text('stopped'), sys.exit(0))); "
        "time.sleep(30)"
    )
    parent_code = (
        "import pathlib,subprocess,sys,time; "
        f"child=subprocess.Popen([sys.executable,'-c',{child_code!r}]); "
        f"pathlib.Path({str(child_pid_path)!r}).write_text(str(child.pid)); "
        "print('parent-ready',flush=True); time.sleep(30)"
    )

    code, timed_out, stdout, stderr = default_runner(
        [sys.executable, "-c", parent_code],
        tmp_path,
        10,
        cancel_check=lambda: child_pid_path.exists(),
    )

    assert code == CANCELLED_RETURN_CODE
    assert not timed_out
    assert "parent-ready" in stdout
    assert "cancelled" in stderr.lower()
    child_pid = int(child_pid_path.read_text())
    deadline = time.monotonic() + 2
    while not child_stopped_path.exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert child_stopped_path.exists()
    # The marker is written by a SIGTERM handler; the runner has reaped the group leader.
    assert not process_is_alive(child_pid)


def test_default_runner_timeout_terminates_process_and_marks_timeout(tmp_path: Path) -> None:
    code, timed_out, _stdout, stderr = default_runner(
        [sys.executable, "-c", "import time; time.sleep(30)"], tmp_path, 0.1
    )
    assert code == 124
    assert timed_out
    assert "timed out" in stderr.lower()


def test_worker_cancel_during_solver_run_waits_for_process_exit(tmp_path: Path) -> None:
    binary = tmp_path / "fake-mumax3"
    binary.write_text(
        f"#!{sys.executable}\n"
        "import sys, time\n"
        "if '-v' in sys.argv:\n"
        "    print('MuMax3 cancellation fixture')\n"
        "else:\n"
        "    print('solver-started', flush=True)\n"
        "    time.sleep(30)\n",
        encoding="utf-8",
    )
    binary.chmod(0o755)
    settings = Settings(
        mumax3_binary=str(binary),
        job_root=tmp_path / "jobs",
        mumax3_timeout_seconds=20,
        worker_enabled=False,
    )
    store = InMemoryJobStore()
    queue = InMemorySimulationQueue()
    worker = LocalWorker(
        store=store,
        queue=queue,
        settings=settings,
        gpu_detector=lambda: detect_gpu(runner=lambda *_: (127, "", "not installed")),
    )
    request = SimulationRequest.model_validate(sample_mumax_payload())
    job = JobRecord(
        job_id="cancel-running-solver",
        scenario_id=request.scenario_id,
        title=request.title,
        requested_solver="mumax3",
        status="queued",
        progress_phase="queued",
        created_at=utc_now(),
        updated_at=utc_now(),
        provenance=Provenance(created_by="system", solver="mumax3"),
        request=request,
    )
    store.create(job)
    queue.enqueue(job.job_id)

    worker_thread = threading.Thread(target=worker.run_once)
    worker_thread.start()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        current = store.get(job.job_id)
        if current is not None and current.status == "running_solver":
            break
        time.sleep(0.01)
    else:
        pytest.fail("worker did not reach the solver subprocess")

    queue.cancel(job.job_id)
    worker_thread.join(timeout=5)
    assert not worker_thread.is_alive(), "worker returned before confirming solver process exit"
    cancelled = store.get(job.job_id)
    assert cancelled is not None and cancelled.status == "cancelled"
    assert "cancelled" in (settings.job_root / job.job_id / "stderr.log").read_text().lower()
    assert not queue.is_cancelled(job.job_id)
