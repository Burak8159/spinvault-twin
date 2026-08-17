"""MuMax3 adapter: availability, prepare, run, parse."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from math import sqrt
from pathlib import Path

from app.config import Settings, get_settings
from app.models.jobs import JobError, JobWarning
from app.models.provenance import Provenance, utc_now
from app.models.simulation import SimulationRequest, SimulationResult
from app.physics.reference_pmtj import reference_parameter_manifest
from app.solvers.base import SolverOutcome
from app.solvers.mumax3.parser import parse_outputs
from app.solvers.mumax3.metrics import SwitchingDiagnosticContext
from app.solvers.mumax3.runner import (
    PreparedMumaxJob,
    RunnerFn,
    is_executable_binary,
    prepare_job_dir,
    probe_mumax3_version,
    resolve_binary,
    run_mumax3,
    write_request_json,
    write_result_json,
    write_script,
)
from app.solvers.mumax3.script import generate_mx3_script, resolve_model_kind
from app.solvers.mumax3.validate_request import validate_mumax_request


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def switching_context_for_request(
    request: SimulationRequest,
) -> SwitchingDiagnosticContext | None:
    """Build post-run P/AP diagnostics context for switching_v1 only."""
    if resolve_model_kind(request) != "spinvault_mtj_free_layer_switching_v1":
        return None
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    pinned = mumax.pinned_direction
    norm = sqrt(pinned.x**2 + pinned.y**2 + pinned.z**2)
    return SwitchingDiagnosticContext(
        pinned_direction=(pinned.x / norm, pinned.y / norm, pinned.z / norm),
        state_preset=mumax.state_preset,
        threshold=mumax.switching_threshold,
    )


@dataclass
class Mumax3Adapter:
    settings: Settings | None = None
    runner: RunnerFn | None = None

    def __post_init__(self) -> None:
        self.settings = self.settings or get_settings()

    @property
    def binary_path(self) -> Path | None:
        raw = self.settings.mumax3_binary if self.settings else None
        if not raw:
            return None
        return resolve_binary(raw)

    def is_available(self) -> bool:
        raw = self.settings.mumax3_binary if self.settings else None
        return is_executable_binary(raw)

    def availability_message(self) -> str:
        if self.is_available():
            version = probe_mumax3_version(self.binary_path, self.runner) if self.binary_path else None
            return f"MuMax3 is configured ({self.binary_path})" + (f": {version}" if version else ".")
        return "MuMax3 binary is not configured on this machine."

    def prepare(self, request: SimulationRequest, *, job_id: str) -> PreparedMumaxJob:
        validation = validate_mumax_request(request)
        if not validation.ok:
            raise ValueError("; ".join(error.message for error in validation.errors))

        root = Path(self.settings.job_root)
        job_dir = prepare_job_dir(root, job_id)
        script_text = generate_mx3_script(request)
        request_json = request.model_dump_json(by_alias=True)
        request_hash = _hash_text(request_json)
        script_hash = _hash_text(script_text)

        request_path = job_dir / "request.json"
        script_path = job_dir / "generated.mx3"
        write_request_json(request_path, request)
        write_request_json(job_dir / "input_parameters.json", request)
        write_script(script_path, script_text)
        if resolve_model_kind(request) == "reference_pmtj_v01_equilibrium":
            (job_dir / "reference_parameters.json").write_text(
                json.dumps(reference_parameter_manifest(), indent=2),
                encoding="utf-8",
            )

        return PreparedMumaxJob(
            job_id=job_id,
            job_dir=job_dir,
            script_path=script_path,
            request_path=request_path,
            outputs_dir=job_dir / "outputs",
            script_text=script_text,
            request_hash=request_hash,
            script_hash=script_hash,
        )

    def run(self, prepared: PreparedMumaxJob):
        if not self.is_available() or self.binary_path is None:
            raise RuntimeError("MuMax3 binary is not configured on this machine.")
        version = probe_mumax3_version(self.binary_path, self.runner)
        return run_mumax3(
            binary=self.binary_path,
            prepared=prepared,
            timeout_seconds=self.settings.mumax3_timeout_seconds,
            runner=self.runner,
            version=version,
        )

    def parse_outputs(self, job_dir: Path, **kwargs) -> SimulationResult:
        return parse_outputs(job_dir, **kwargs)

    def execute(self, request: SimulationRequest, *, job_id: str) -> SolverOutcome:
        validation = validate_mumax_request(request)
        if not validation.ok:
            return SolverOutcome(
                status="failed",
                errors=list(validation.errors),
                warnings=list(validation.warnings),
                provenance=Provenance(
                    created_at=utc_now(),
                    created_by="system",
                    solver="mumax3",
                    notes=["MuMax3 request validation failed before script generation."],
                ),
            )

        prepared = self.prepare(request, job_id=job_id)
        if not self.is_available():
            return SolverOutcome(
                status="not_configured",
                errors=[
                    JobError(
                        code="mumax3_not_configured",
                        message=(
                            "MuMax3 was requested but no executable is configured. "
                            "NOT IMPLEMENTED / MODEL REQUIRED. Set MUMAX3_BINARY to "
                            "an executable MuMax3 binary; no substitute solver was run."
                        ),
                    )
                ],
                warnings=list(validation.warnings),
                provenance=Provenance(
                    created_at=utc_now(),
                    created_by="system",
                    solver="mumax3",
                    notes=[
                        "MuMax3 execution did not start because no executable was configured.",
                        "No Python LLG, demo, or synthetic fallback was used.",
                        f"generated_script={prepared.script_path}",
                        f"artifacts_dir={prepared.job_dir}",
                    ],
                ),
            )

        run_result = self.run(prepared)
        success = run_result.returncode == 0 and not run_result.timed_out
        result = self.parse_outputs(
            prepared.job_dir,
            request_hash=prepared.request_hash,
            script_hash=prepared.script_hash,
            script_text=prepared.script_text,
            solver_version=run_result.version,
            started_at=run_result.started_at.isoformat(),
            ended_at=run_result.ended_at.isoformat(),
            success=success,
            model_kind=resolve_model_kind(request),
            switching_context=switching_context_for_request(request),
        )
        write_result_json(
            prepared.job_dir / "result.json",
            json.loads(result.model_dump_json(by_alias=True)),
        )

        warnings = list(validation.warnings)
        errors: list[JobError] = []
        status = "complete"
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
            warnings.append(
                JobWarning(
                    code="mumax3-unvalidated-model",
                    message=(
                        "MuMax3 ran with user-provided parameters. "
                        "This is not a calibrated or validated device model."
                    ),
                )
            )
            if (
                resolve_model_kind(request)
                == "spinvault_mtj_free_layer_switching_v1"
                and result.artifacts is not None
                and request.solver_drafts.mumax3.state_preset  # type: ignore[union-attr]
                in {"transition_0_to_1", "transition_1_to_0"}
                and len(result.artifacts.frames) < 100
            ):
                warnings.append(
                    JobWarning(
                        code="mumax3-switching-frame-count-low",
                        field="result.artifacts.frames",
                        message=(
                            f"switching_v1 transition produced {len(result.artifacts.frames)} OVF "
                            "frames; at least 100 were requested for visible dynamics. "
                            "The available raw frames are preserved without interpolation."
                        ),
                    )
                )

        # Attach script hash into provenance notes if parser didn't already.
        provenance = result.provenance
        return SolverOutcome(
            status=status,
            result=result if success else result,  # keep artifacts even on failure
            errors=errors,
            warnings=warnings,
            provenance=provenance,
        )
