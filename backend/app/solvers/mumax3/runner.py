"""Safe MuMax3 subprocess execution and job artifact layout."""

from __future__ import annotations

import json
import os
import signal
import shutil
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

from app.models.provenance import utc_now
from app.models.simulation import SimulationRequest


@dataclass
class SolverRunResult:
    returncode: int
    timed_out: bool
    started_at: datetime
    ended_at: datetime
    stdout_path: Path
    stderr_path: Path
    version: str | None = None
    cancelled: bool = False


RunnerFn = Callable[[list[str], Path, float], tuple[int, bool, str, str]]
CANCELLED_RETURN_CODE = 125


def _terminate_process_tree(process: subprocess.Popen[str]) -> tuple[str, str]:
    """Terminate the solver process group and wait until its leader is reaped."""
    termination_error = ""
    if os.name == "nt":
        try:
            completed = subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
                shell=False,
            )
            if completed.returncode:
                termination_error = (completed.stderr or completed.stdout or "taskkill failed").strip()
        except (OSError, subprocess.TimeoutExpired) as exc:
            termination_error = f"taskkill error: {exc}"
        if process.poll() is None:
            process.kill()
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except OSError as exc:
            termination_error = f"process-group SIGTERM error: {exc}"
            if process.poll() is None:
                process.terminate()
    try:
        stdout, stderr = process.communicate(timeout=2)
        return stdout or "", (stderr or "") + (f"\n{termination_error}" if termination_error else "")
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            process.kill()
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except OSError:
                process.kill()
        stdout, stderr = process.communicate()
        return stdout or "", (stderr or "") + (f"\n{termination_error}" if termination_error else "")


def default_runner(
    command: list[str],
    cwd: Path,
    timeout: float,
    *,
    cancel_check: Callable[[], bool] | None = None,
) -> tuple[int, bool, str, str]:
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    try:
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=False,
            start_new_session=os.name != "nt",
            creationflags=creationflags,
        )
    except OSError:
        raise

    deadline = time.monotonic() + timeout
    while True:
        if process.poll() is not None:
            try:
                completed_stdout, completed_stderr = process.communicate(timeout=0.1)
                return process.returncode, False, completed_stdout or "", completed_stderr or ""
            except subprocess.TimeoutExpired:
                # A descendant may still hold inherited pipes; cancellation/timeout
                # below can still terminate the process group before final collection.
                pass
        if cancel_check is not None and cancel_check():
            stdout, stderr = _terminate_process_tree(process)
            stderr = (stderr + "\nMuMax3 execution cancelled; process tree termination was requested and leader exit confirmed.").strip()
            return CANCELLED_RETURN_CODE, False, stdout, stderr
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            stdout, stderr = _terminate_process_tree(process)
            stderr = (stderr + "\nMuMax3 execution timed out; process tree termination was requested and leader exit confirmed.").strip()
            return 124, True, stdout, stderr
        try:
            completed_stdout, completed_stderr = process.communicate(timeout=min(0.1, remaining))
            return process.returncode, False, completed_stdout or "", completed_stderr or ""
        except subprocess.TimeoutExpired:
            continue


def probe_mumax3_version(binary: Path, runner: RunnerFn | None = None) -> str | None:
    run = runner or default_runner
    try:
        code, _timed, stdout, stderr = run([str(binary), "-v"], Path.cwd(), 10)
        text = (stdout or stderr or "").strip()
        if code == 0 and text:
            return text.splitlines()[0].strip()
        # mumax3 often prints version on -h / bare invocation; keep best-effort.
        if text:
            return text.splitlines()[0].strip()
    except OSError:
        return None
    return None


def is_executable_binary(path: str | Path | None) -> bool:
    if not path:
        return False
    candidate = Path(path).expanduser()
    if not candidate.exists() or not candidate.is_file():
        # Also accept PATH lookups for bare command names on configured hosts.
        resolved = shutil.which(str(path))
        if not resolved:
            return False
        candidate = Path(resolved)
    return os.access(candidate, os.X_OK)


def resolve_binary(path: str | Path) -> Path:
    candidate = Path(path).expanduser()
    if candidate.exists():
        return candidate.resolve()
    which = shutil.which(str(path))
    if which:
        return Path(which).resolve()
    return candidate


@dataclass
class PreparedMumaxJob:
    job_id: str
    job_dir: Path
    script_path: Path
    request_path: Path
    outputs_dir: Path
    script_text: str
    request_hash: str
    script_hash: str


def prepare_job_dir(root: Path, job_id: str) -> Path:
    job_dir = root / job_id
    (job_dir / "outputs").mkdir(parents=True, exist_ok=True)
    return job_dir


def write_request_json(path: Path, request: SimulationRequest) -> None:
    path.write_text(
        request.model_dump_json(by_alias=True, indent=2),
        encoding="utf-8",
    )


def write_script(path: Path, script: str) -> None:
    path.write_text(script, encoding="utf-8")


def write_result_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def run_mumax3(
    *,
    binary: Path,
    prepared: PreparedMumaxJob,
    timeout_seconds: int,
    runner: RunnerFn | None = None,
    version: str | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> SolverRunResult:
    started = utc_now()
    # mumax3 writes next to the script; run with script path relative to job_dir.
    command = [str(binary), prepared.script_path.name]
    if runner is None:
        code, timed_out, stdout, stderr = default_runner(
            command, prepared.job_dir, float(timeout_seconds), cancel_check=cancel_check
        )
    else:
        # Existing injected runners keep the stable 3-argument test/integration contract.
        code, timed_out, stdout, stderr = runner(command, prepared.job_dir, float(timeout_seconds))
    cancelled = code == CANCELLED_RETURN_CODE and not timed_out
    ended = utc_now()

    stdout_path = prepared.job_dir / "stdout.log"
    stderr_path = prepared.job_dir / "stderr.log"
    stdout_path.write_text(stdout, encoding="utf-8")
    stderr_path.write_text(stderr, encoding="utf-8")
    (prepared.job_dir / "run_metadata.json").write_text(
        json.dumps(
            {
                "schemaVersion": "1",
                "solver": "MuMax3",
                "solverVersion": version,
                "command": command,
                "workingDirectory": str(prepared.job_dir),
                "script": prepared.script_path.name,
                "requestHash": prepared.request_hash,
                "scriptHash": prepared.script_hash,
                "startedAt": started.isoformat(),
                "endedAt": ended.isoformat(),
                "returnCode": code,
                "timedOut": timed_out,
                "cancelled": cancelled,
                "success": code == 0 and not timed_out,
                "parserVersion": "mumax3-parser-v1",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    # Copy any .out directory contents into outputs/ for a stable layout.
    outputs = prepared.outputs_dir
    for child in prepared.job_dir.iterdir():
        if child.name.endswith(".out") and child.is_dir():
            for artifact in child.rglob("*"):
                if artifact.is_file():
                    relative = artifact.relative_to(child)
                    target = outputs / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(artifact, target)

    return SolverRunResult(
        returncode=code,
        timed_out=timed_out,
        started_at=started,
        ended_at=ended,
        stdout_path=stdout_path,
        stderr_path=stderr_path,
        version=version,
        cancelled=cancelled,
    )
