"""Local worker that runs MuMax3 jobs outside the API request path."""

from __future__ import annotations

import json
import socket
import time
from pathlib import Path
from uuid import uuid4

from app.config import Settings, get_settings
from app.models.jobs import JobError, JobRecord, JobStatus, JobWarning
from app.models.provenance import Provenance, utc_now
from app.models.simulation import (
    ResultMetric,
    ResultSeries,
    ResultSeriesPoint,
    SimulationArtifacts,
    SimulationResult,
)
from app.solvers.mumax3.adapter import Mumax3Adapter, switching_context_for_request
from app.solvers.mumax3.frames import find_ovf_frames
from app.solvers.mumax3.metrics import magnetization_metrics_from_series
from app.solvers.mumax3.runner import prepare_job_dir, write_request_json, write_result_json
from app.solvers.mumax3.script import resolve_model_kind
from app.solvers.mumax3.validate_request import validate_mumax_request
from app.solvers.python_micromagnetic.adapter import PythonMicromagneticAdapter
from app.solvers.python_micromagnetic.matplotlib_report import render_matplotlib_twin_report
from app.storage.protocol import JobStore
from app.workers.artifacts import write_artifact_manifest
from app.workers.gpu import detect_gpu, run_acceleration_label
from app.workers.parser import parse_job_outputs
from app.workers.queue import InMemorySimulationQueue, SimulationQueue
from app.workers.status import WorkerStatusDocument, write_status_document

ACTIVE_PHASES: tuple[JobStatus, ...] = (
    "preparing",
    "checking_environment",
    "generating_solver_input",
    "running_solver",
    "parsing_outputs",
)


class LocalWorker:
    def __init__(
        self,
        *,
        store: JobStore,
        queue: SimulationQueue,
        settings: Settings | None = None,
        adapter: Mumax3Adapter | None = None,
        worker_id: str | None = None,
        gpu_detector=detect_gpu,
    ) -> None:
        self.store = store
        self.queue = queue
        self.settings = settings or get_settings()
        self.adapter = adapter or Mumax3Adapter(settings=self.settings)
        self.worker_id = worker_id or f"worker-{socket.gethostname()}-{uuid4().hex[:8]}"
        self.gpu_detector = gpu_detector
        self._stop = False

    def stop(self) -> None:
        self._stop = True

    def run_forever(self, poll_seconds: float = 0.25) -> None:
        self._stop = False
        while not self._stop:
            processed = self.run_once()
            if not processed:
                time.sleep(poll_seconds)

    def run_once(self) -> bool:
        job_id = self.queue.claim_next()
        if not job_id:
            return False
        if self.queue.is_cancelled(job_id):
            self._mark_cancelled(job_id)
            return True
        job = self.store.get(job_id)
        if job is None:
            return True
        if job.requested_solver == "python_micromagnetic":
            try:
                self._process_python_micromagnetic_job(job)
            except Exception as exc:  # noqa: BLE001 - worker must never die on one job
                latest = self.store.get(job_id) or job
                self._fail(
                    latest,
                    code="worker_crash",
                    message=f"Worker crashed while processing job: {exc}",
                    phase="failed",
                )
            finally:
                self.queue.clear_cancelled(job_id)
            return True
        if job.requested_solver != "mumax3":
            self._fail(
                job,
                code="worker_unsupported_solver",
                message=f"Local worker only handles mumax3 jobs (got {job.requested_solver}).",
                phase="failed",
            )
            return True
        if job.request is None:
            self._fail(job, code="worker_missing_request", message="Job has no request payload.", phase="failed")
            return True

        try:
            self._process_mumax_job(job)
        except Exception as exc:  # noqa: BLE001 - worker must never die on one job
            latest = self.store.get(job_id) or job
            self._fail(
                latest,
                code="worker_crash",
                message=f"Worker crashed while processing job: {exc}",
                phase="failed",
            )
        finally:
            self.queue.clear_cancelled(job_id)
        return True

    def _process_mumax_job(self, job: JobRecord) -> None:
        assert job.request is not None
        job_dir = prepare_job_dir(Path(self.settings.job_root), job.job_id)
        write_request_json(job_dir / "request.json", job.request)
        started = utc_now()
        gpu = self.gpu_detector()

        def checkpoint(phase: JobStatus, message: str, *, errors=None, warnings=None) -> JobRecord:
            if self.queue.is_cancelled(job.job_id):
                raise RuntimeError("__cancelled__")
            latest = self.store.get(job.job_id) or job
            latest.status = phase
            latest.progress_phase = phase
            latest.worker_id = self.worker_id
            latest.gpu = gpu
            latest.updated_at = utc_now()
            if latest.started_at is None:
                latest.started_at = started
            if errors is not None:
                latest.errors = list(errors)
            if warnings is not None:
                latest.warnings = list(warnings)
            latest.provenance = Provenance(
                created_at=utc_now(),
                created_by="system",
                solver="mumax3",
                    notes=[
                    f"phase={phase}",
                    f"worker_id={self.worker_id}",
                    f"gpu_available={gpu.gpu_available}",
                    f"host_gpu_label={gpu.acceleration}",
                    message,
                ],
            )
            updated = self.store.update(latest)
            write_status_document(
                job_dir,
                WorkerStatusDocument(
                    job_id=updated.job_id,
                    status=updated.status,
                    progress_phase=updated.progress_phase or updated.status,
                    started_at=updated.started_at,
                    updated_at=updated.updated_at,
                    completed_at=updated.completed_at,
                    worker_id=self.worker_id,
                    solver="mumax3",
                    gpu=gpu,
                    warnings=updated.warnings,
                    errors=updated.errors,
                    message=message,
                ),
            )
            return updated

        try:
            job = checkpoint("preparing", "Worker claimed job and prepared directory.")
            job = checkpoint("checking_environment", gpu.details)

            if not self.adapter.is_available():
                mumax_validation = validate_mumax_request(job.request)
                if not mumax_validation.ok:
                    job.status = "failed"
                    job.progress_phase = "failed"
                    job.updated_at = utc_now()
                    job.completed_at = job.updated_at
                    job.worker_id = self.worker_id
                    job.errors = list(mumax_validation.errors)
                    job.warnings = list(job.warnings) + list(mumax_validation.warnings)
                    job.provenance = Provenance(
                        created_at=utc_now(),
                        created_by="system",
                        solver="mumax3",
                        notes=["MuMax3 request validation failed before script generation."],
                    )
                    self.store.update(job)
                    write_status_document(
                        job_dir,
                        WorkerStatusDocument(
                            job_id=job.job_id,
                            status="failed",
                            progress_phase="failed",
                            started_at=job.started_at,
                            updated_at=job.updated_at,
                            completed_at=job.completed_at,
                            worker_id=self.worker_id,
                            solver="mumax3",
                            gpu=gpu,
                            warnings=job.warnings,
                            errors=job.errors,
                            message="Request validation failed.",
                        ),
                    )
                    return

                prepared = self.adapter.prepare(job.request, job_id=job.job_id)
                (job_dir / "run_metadata.json").write_text(
                    json.dumps(
                        {
                            "schemaVersion": "1",
                            "solver": "MuMax3",
                            "solverVersion": None,
                            "command": None,
                            "workingDirectory": str(job_dir),
                            "script": prepared.script_path.name,
                            "requestHash": prepared.request_hash,
                            "scriptHash": prepared.script_hash,
                            "startedAt": None,
                            "endedAt": None,
                            "returnCode": None,
                            "timedOut": False,
                            "success": False,
                            "status": "not_configured",
                            "message": "No MuMax3 executable was configured; subprocess was not started.",
                            "parserVersion": "mumax3-parser-v1",
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                )
                write_artifact_manifest(job_dir, job_id=job.job_id, solver="mumax3")
                latest = self.store.get(job.job_id) or job
                latest.status = "not_configured"
                latest.progress_phase = "not_configured"
                latest.updated_at = utc_now()
                latest.completed_at = latest.updated_at
                latest.worker_id = self.worker_id
                latest.result = None
                latest.errors = [
                    JobError(
                        code="mumax3_not_configured",
                        message=(
                            "MuMax3 was requested but no executable is configured. "
                            "NOT IMPLEMENTED / MODEL REQUIRED. Set MUMAX3_BINARY to "
                            "an executable MuMax3 binary; no substitute solver was run."
                        ),
                    )
                ]
                latest.warnings = list(latest.warnings) + list(mumax_validation.warnings)
                latest.provenance = Provenance(
                    created_at=utc_now(),
                    created_by="system",
                    solver="mumax3",
                    notes=[
                        "MuMax3 execution did not start because no executable was configured.",
                        "No Python LLG, demo, or synthetic fallback was used.",
                        f"generated_script={prepared.script_path}",
                        f"artifacts_dir={prepared.job_dir}",
                    ],
                )
                self.store.update(latest)
                write_status_document(
                    job_dir,
                    WorkerStatusDocument(
                        job_id=latest.job_id,
                        status=latest.status,
                        progress_phase=latest.progress_phase or latest.status,
                        started_at=latest.started_at,
                        updated_at=latest.updated_at,
                        completed_at=latest.completed_at,
                        worker_id=self.worker_id,
                        solver="mumax3",
                        gpu=gpu,
                        warnings=latest.warnings,
                        errors=latest.errors,
                        message="MuMax3 not configured; no substitute solver was run.",
                    ),
                )
                write_artifact_manifest(job_dir, job_id=latest.job_id, solver="mumax3")
                return

            if not gpu.gpu_available:
                job.warnings = list(job.warnings) + [
                    JobWarning(
                        code="gpu_unavailable",
                        message=(
                            "No NVIDIA GPU runtime detected on the host. MuMax3 will still be invoked if the "
                            "binary is configured, but this run will not be labeled cuda/rtx unless MuMax3 "
                            "logs confirm GPU execution."
                        ),
                    )
                ]
            elif gpu.acceleration in {"host_gpu_available", "gpu_detected"}:
                job.warnings = list(job.warnings) + [
                    JobWarning(
                        code="host_gpu_available",
                        message=(
                            f"Host GPU detected ({', '.join(gpu.devices) or 'unnamed'}). "
                            "Run acceleration stays not_configured until MuMax3 logs confirm CUDA/GPU use."
                        ),
                    )
                ]

            job = checkpoint(
                "generating_solver_input",
                "Generating auditable MuMax3 script from validated fields.",
                warnings=job.warnings,
            )
            mumax_validation = validate_mumax_request(job.request)
            if not mumax_validation.ok:
                job.status = "failed"
                job.progress_phase = "failed"
                job.updated_at = utc_now()
                job.completed_at = job.updated_at
                job.worker_id = self.worker_id
                job.errors = list(mumax_validation.errors)
                job.warnings = list(job.warnings) + list(mumax_validation.warnings)
                job.provenance = Provenance(
                    created_at=utc_now(),
                    created_by="system",
                    solver="mumax3",
                    notes=["MuMax3 request validation failed before script generation."],
                )
                self.store.update(job)
                write_status_document(
                    job_dir,
                    WorkerStatusDocument(
                        job_id=job.job_id,
                        status="failed",
                        progress_phase="failed",
                        started_at=job.started_at,
                        updated_at=job.updated_at,
                        completed_at=job.completed_at,
                        worker_id=self.worker_id,
                        solver="mumax3",
                        gpu=gpu,
                        warnings=job.warnings,
                        errors=job.errors,
                        message="MuMax3 request validation failed.",
                    ),
                )
                return
            job.warnings = list(job.warnings) + list(mumax_validation.warnings)
            job.updated_at = utc_now()
            job = self.store.update(job)
            prepared = self.adapter.prepare(job.request, job_id=job.job_id)

            job = checkpoint("running_solver", "Executing MuMax3 subprocess.")
            run_result = self.adapter.run(prepared)
            success = run_result.returncode == 0 and not run_result.timed_out
            stdout_text = (
                (prepared.job_dir / "stdout.log").read_text(encoding="utf-8", errors="replace")
                if (prepared.job_dir / "stdout.log").exists()
                else ""
            )
            stderr_text = (
                (prepared.job_dir / "stderr.log").read_text(encoding="utf-8", errors="replace")
                if (prepared.job_dir / "stderr.log").exists()
                else ""
            )

            job = checkpoint("parsing_outputs", "Parsing known output tables without physics inference.")
            accel = run_acceleration_label(
                gpu,
                success=success,
                stdout=stdout_text,
                stderr=stderr_text,
            )
            model_kind = resolve_model_kind(job.request)
            provenance = Provenance(
                created_at=utc_now(),
                created_by="system",
                solver="mumax3",
                solver_version=run_result.version,
                input_hash=prepared.request_hash,
                notes=[
                    f"modelKind={model_kind}",
                    "MuMax3 numerical run with user-provided parameters.",
                    "Not a calibrated or experimentally validated device model.",
                    f"request_hash={prepared.request_hash}",
                    f"script_hash={prepared.script_hash}",
                    f"started_at={run_result.started_at.isoformat()}",
                    f"ended_at={run_result.ended_at.isoformat()}",
                    f"run_acceleration={accel}",
                    f"host_gpu_label={gpu.acceleration}",
                    f"gpu_available={gpu.gpu_available}",
                    f"worker_id={self.worker_id}",
                    f"artifacts_dir={prepared.job_dir}",
                ],
            )
            manifest = write_artifact_manifest(prepared.job_dir, job_id=job.job_id, solver="mumax3")
            parsed = parse_job_outputs(
                prepared.job_dir,
                job_id=job.job_id,
                solver="mumax3",
                is_physical_simulation=success,
                provenance=provenance,
                artifact_refs=manifest.files,
            )

            series = [
                ResultSeries(
                    id=item.id,
                    label=item.label,
                    x_label="x",
                    x_unit=item.x_unit or "unknown",
                    y_label=item.label,
                    y_unit=item.y_unit or "unknown",
                    points=[ResultSeriesPoint(x=x, y=y) for x, y in item.points],
                )
                for item in parsed.series
            ]
            frames = find_ovf_frames(prepared.job_dir)
            ovf_summary = None
            if frames:
                try:
                    from app.solvers.mumax3.frames import load_ovf_frame

                    ovf_summary = load_ovf_frame(prepared.job_dir, frames[-1]).get("sanity")
                except (OSError, ValueError):
                    ovf_summary = None
            mag_metrics = magnetization_metrics_from_series(
                series,
                switching_context_for_request(job.request),
                ovf_summary=ovf_summary,
            )
            result = SimulationResult(
                source="mumax3",
                is_physical_simulation=success,
                summary=(
                    f"MuMax3 modelKind={model_kind} completed; raw table series and {len(frames)} "
                    "OVF magnetization frame(s) archived without "
                    "TMR/resistance/performance inference."
                    if success
                    else "MuMax3 exited with failure. Logs and partial artifacts were preserved."
                ),
                series=series,
                metrics=[
                    *mag_metrics,
                    ResultMetric(
                        id="model-kind",
                        label="Model kind",
                        display_value=model_kind,
                        unit="dimensionless",
                        note="Request modelKind used for script generation.",
                    ),
                    ResultMetric(
                        id="acceleration",
                        label="Run acceleration label",
                        display_value=accel,
                        unit="dimensionless",
                        note=(
                            "cuda/rtx only when MuMax3 logs confirm GPU execution; "
                            "host nvidia-smi alone stays not_configured for this metric."
                        ),
                    ),
                    ResultMetric(
                        id="host-gpu-label",
                        label="Host GPU detection",
                        display_value=gpu.acceleration,
                        unit="dimensionless",
                        note="Host nvidia-smi probe only (host_gpu_available / not_configured).",
                    ),
                    ResultMetric(
                        id="ovf-frame-count",
                        label="OVF frames",
                        display_value=str(len(frames)),
                        unit="frames",
                        note="Raw MuMax3 magnetization frame files available for visualization only.",
                    ),
                ],
                provenance=provenance,
                artifacts=SimulationArtifacts(
                    script_preview=prepared.script_text,
                    stdout=stdout_text or None,
                    stderr=stderr_text or None,
                    manifest=manifest.model_dump(by_alias=True),
                    frames=frames,
                ),
            )
            write_result_json(
                prepared.job_dir / "result.json",
                result.model_dump(by_alias=True, mode="json"),
            )
            write_artifact_manifest(prepared.job_dir, job_id=job.job_id, solver="mumax3")

            errors: list[JobError] = []
            warnings = list(job.warnings)
            warnings.extend(JobWarning(code="parser", message=msg) for msg in parsed.warnings)
            status: JobStatus = "complete"
            if run_result.timed_out:
                status = "failed"
                errors.append(
                    JobError(
                        code="mumax3_timeout",
                        message=f"MuMax3 timed out after {self.settings.mumax3_timeout_seconds}s.",
                    )
                )
            elif run_result.returncode != 0:
                status = "failed"
                errors.append(
                    JobError(
                        code="mumax3_failed",
                        message=f"MuMax3 exited with code {run_result.returncode}. See stderr.log.",
                    )
                )
            else:
                if not any(w.code == "mumax3-unvalidated-model" for w in warnings):
                    warnings.append(
                        JobWarning(
                            code="mumax3-unvalidated-model",
                            message=(
                                "MuMax3 ran with user-provided parameters. "
                                "This is not a calibrated or experimentally validated device model."
                            ),
                        )
                    )
                if (
                    model_kind == "spinvault_mtj_free_layer_switching_v1"
                    and job.request.solver_drafts
                    and job.request.solver_drafts.mumax3.state_preset
                    in {"transition_0_to_1", "transition_1_to_0"}
                    and len(frames) < 100
                ):
                    warnings.append(
                        JobWarning(
                            code="mumax3-switching-frame-count-low",
                            field="result.artifacts.frames",
                            message=(
                                f"switching_v1 transition produced {len(frames)} OVF frames; "
                                "at least 100 were requested for visible dynamics. "
                                "The available raw frames are preserved without interpolation."
                            ),
                        )
                    )

            latest = self.store.get(job.job_id) or job
            latest.status = status
            latest.progress_phase = status
            latest.result = result
            latest.errors = errors
            latest.warnings = warnings
            latest.gpu = gpu
            latest.worker_id = self.worker_id
            latest.updated_at = utc_now()
            latest.completed_at = latest.updated_at
            latest.provenance = provenance
            self.store.update(latest)
            write_status_document(
                prepared.job_dir,
                WorkerStatusDocument(
                    job_id=latest.job_id,
                    status=latest.status,
                    progress_phase=latest.progress_phase or latest.status,
                    started_at=latest.started_at,
                    updated_at=latest.updated_at,
                    completed_at=latest.completed_at,
                    worker_id=self.worker_id,
                    solver="mumax3",
                    gpu=gpu,
                    warnings=latest.warnings,
                    errors=latest.errors,
                    message=f"Finished with status={status}",
                ),
            )
        except RuntimeError as exc:
            if str(exc) == "__cancelled__":
                self._mark_cancelled(job.job_id, job_dir=job_dir, gpu=gpu, started=started)
                return
            raise

    def _process_python_micromagnetic_job(self, job: JobRecord) -> None:
        assert job.request is not None
        job_dir = prepare_job_dir(Path(self.settings.job_root), job.job_id)
        write_request_json(job_dir / "request.json", job.request)
        started = utc_now()
        adapter = PythonMicromagneticAdapter()

        def checkpoint(phase: JobStatus, message: str) -> JobRecord:
            if self.queue.is_cancelled(job.job_id):
                raise RuntimeError("__cancelled__")
            latest = self.store.get(job.job_id) or job
            latest.status = phase
            latest.progress_phase = phase
            latest.worker_id = self.worker_id
            latest.updated_at = utc_now()
            if latest.started_at is None:
                latest.started_at = started
            latest.provenance = Provenance(
                created_at=utc_now(),
                created_by="system",
                solver="python_micromagnetic",
                notes=[f"phase={phase}", f"worker_id={self.worker_id}", message],
            )
            updated = self.store.update(latest)
            write_status_document(
                job_dir,
                WorkerStatusDocument(
                    job_id=updated.job_id,
                    status=updated.status,
                    progress_phase=updated.progress_phase or updated.status,
                    started_at=updated.started_at,
                    updated_at=updated.updated_at,
                    completed_at=updated.completed_at,
                    worker_id=self.worker_id,
                    solver="python_micromagnetic",
                    gpu=updated.gpu,
                    warnings=updated.warnings,
                    errors=updated.errors,
                    message=message,
                ),
            )
            return updated

        try:
            job = checkpoint("preparing", "Worker claimed Python micromagnetic job.")
            job = checkpoint("running_solver", "Integrating finite-difference LLGS.")

            def cancel_check() -> bool:
                return self.queue.is_cancelled(job.job_id)

            def progress(step: int, n_steps: int) -> None:
                if n_steps <= 0:
                    return
                pct = min(99, int(100 * step / n_steps))
                checkpoint("running_solver", f"python_micromagnetic {step}/{n_steps} ({pct}%)")

            outcome = adapter.execute(
                job.request,
                job_id=job.job_id,
                cancel_check=cancel_check,
                progress=progress,
            )
            if outcome.status == "cancelled":
                self._mark_cancelled(job.job_id, job_dir=job_dir, started=started)
                return
            job = checkpoint("parsing_outputs", "Rendering NumPy/matplotlib Twin report from mesh frames.")
            if outcome.result is not None:
                try:
                    report = render_matplotlib_twin_report(
                        job_dir,
                        outcome.result,
                        request=job.request,
                    )
                    if outcome.result.artifacts is not None:
                        manifest = dict(outcome.result.artifacts.manifest or {})
                        manifest["matplotlibTwin"] = report
                        outcome.result.artifacts.manifest = manifest
                except Exception as exc:  # noqa: BLE001 - preserve valid physics result
                    outcome.warnings.append(
                        JobWarning(
                            code="matplotlib-report-failed",
                            message=(
                                "The micromagnetic solve completed, but the matplotlib report "
                                f"could not be rendered: {exc}"
                            ),
                        )
                    )
            latest = self.store.get(job.job_id) or job
            latest.status = outcome.status
            latest.progress_phase = outcome.status
            latest.result = outcome.result
            latest.errors = list(outcome.errors)
            latest.warnings = list(latest.warnings) + list(outcome.warnings)
            latest.worker_id = self.worker_id
            latest.updated_at = utc_now()
            latest.completed_at = latest.updated_at
            latest.provenance = outcome.provenance or latest.provenance
            self.store.update(latest)
            if outcome.result is not None:
                write_result_json(
                    job_dir / "result.json",
                    outcome.result.model_dump(by_alias=True, mode="json"),
                )
            write_artifact_manifest(job_dir, job_id=latest.job_id, solver="python_micromagnetic")
            write_status_document(
                job_dir,
                WorkerStatusDocument(
                    job_id=latest.job_id,
                    status=latest.status,
                    progress_phase=latest.progress_phase or latest.status,
                    started_at=latest.started_at,
                    updated_at=latest.updated_at,
                    completed_at=latest.completed_at,
                    worker_id=self.worker_id,
                    solver="python_micromagnetic",
                    gpu=latest.gpu,
                    warnings=latest.warnings,
                    errors=latest.errors,
                    message=f"Finished with status={latest.status}",
                ),
            )
        except RuntimeError as exc:
            if str(exc) == "__cancelled__":
                self._mark_cancelled(job.job_id, job_dir=job_dir, started=started)
                return
            raise

    def _mark_cancelled(self, job_id: str, job_dir: Path | None = None, gpu=None, started=None) -> None:
        job = self.store.get(job_id)
        if job is None:
            return
        job.status = "cancelled"
        job.progress_phase = "cancelled"
        job.updated_at = utc_now()
        job.completed_at = job.updated_at
        job.worker_id = self.worker_id
        if started and job.started_at is None:
            job.started_at = started
        if gpu is not None:
            job.gpu = gpu
        job.warnings = list(job.warnings) + [
            JobWarning(code="cancelled", message="Job cancelled by queue/worker request.")
        ]
        job.provenance = Provenance(
            created_at=utc_now(),
            created_by="system",
            solver=job.requested_solver if job.requested_solver in {"mumax3", "python_micromagnetic"} else "none",
            notes=["Job cancelled before completion."],
        )
        self.store.update(job)
        if job_dir is not None:
            write_status_document(
                job_dir,
                WorkerStatusDocument(
                    job_id=job.job_id,
                    status="cancelled",
                    progress_phase="cancelled",
                    started_at=job.started_at,
                    updated_at=job.updated_at,
                    completed_at=job.completed_at,
                    worker_id=self.worker_id,
                    solver=job.requested_solver,
                    gpu=job.gpu,
                    warnings=job.warnings,
                    errors=job.errors,
                    message="Cancelled",
                ),
            )
            write_artifact_manifest(job_dir, job_id=job.job_id, solver=job.requested_solver)
        self.queue.clear_cancelled(job_id)

    def _fail(self, job: JobRecord, *, code: str, message: str, phase: JobStatus) -> None:
        job.status = phase
        job.progress_phase = phase
        job.updated_at = utc_now()
        job.completed_at = job.updated_at
        job.worker_id = self.worker_id
        job.errors = list(job.errors) + [JobError(code=code, message=message)]
        job.provenance = Provenance(
            created_at=utc_now(),
            created_by="system",
            solver=job.requested_solver if job.requested_solver in {"mumax3", "python_micromagnetic"} else "none",
            notes=[message],
        )
        self.store.update(job)
