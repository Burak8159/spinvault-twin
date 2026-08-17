"""Map a Twin SimulationRequest onto the local Python micromagnetic mesh solver.

Result source is always python_micromagnetic. This adapter never claims MuMax3.
"""

from __future__ import annotations

from pathlib import Path

from app.config import get_settings
from app.models.jobs import JobError, JobWarning
from app.models.provenance import Provenance, utc_now
from app.models.simulation import (
    ResultMetric,
    ResultSeries,
    ResultSeriesPoint,
    SimulationArtifacts,
    SimulationRequest,
    SimulationResult,
)
from app.solvers.base import SolverOutcome
from app.solvers.mumax3.metrics import SwitchingDiagnosticContext, magnetization_metrics_from_series
from app.solvers.mumax3.script import resolve_model_kind
from app.solvers.mumax3.units import to_si
from app.solvers.mumax3.validate_request import validate_mumax_request
from app.solvers.python_llg.adapter import (
    _PYTHON_LLG_DROPPED_ERRORS,
    _PYTHON_LLG_DROPPED_WARNINGS,
    _bias_tesla,
    _current_magnitude,
    _hash_request,
    _polarization,
    _preset_m0_and_pulse,
    _seed,
    _stt_drive,
    _temperature_k,
)
from app.solvers.python_llg.engine import keff_and_hk, normalize
from app.solvers.python_micromagnetic.artifact import (
    ARTIFACT_NAME,
    FRAME_FORMAT,
    frame_catalog,
    save_magnetization_npz,
)
from app.solvers.python_micromagnetic.engine import (
    DEFAULT_FRAME_COUNT,
    DEFAULT_NX,
    DEFAULT_NY,
    SOLVER_VERSION,
    build_mask,
    integrate_mesh,
    prepare_initial,
)
from app.solvers.python_micromagnetic.fields import exchange_length, recommended_dt_s
from app.solvers.python_micromagnetic.integrator import IntegrationCancelled, MeshParams

SOLVER_NAME = "python_micromagnetic"

_MESH_DROPPED_ERRORS = _PYTHON_LLG_DROPPED_ERRORS | {
    "mumax3-geom-larger-than-world",
    "mumax3-thickness-mismatch",
    "mumax3-field-pulse-missing",
    "mumax3-field-pulse-duration-missing",
    "mumax3-field-pulse-nonpositive",
    "mumax3-pulse-below-switching-field",
}


def _series(component: str, times, values) -> ResultSeries:
    return ResultSeries(
        id=component,
        label=component,
        x_label="time",
        x_unit="s",
        y_label=component,
        y_unit="dimensionless" if component.startswith("m") else "J",
        points=[ResultSeriesPoint(x=float(t), y=float(y)) for t, y in zip(times, values)],
    )


def _mesh_geometry(request: SimulationRequest) -> tuple[int, int, float, float, float, list[JobWarning]]:
    warnings: list[JobWarning] = []
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    length = to_si(request.geometry.free_layer_length, kind="length")
    width = to_si(request.geometry.free_layer_width, kind="length")
    thickness = to_si(request.geometry.free_layer_thickness, kind="length")
    grid = mumax.grid_size
    nx = int(grid.nx) if grid is not None else DEFAULT_NX
    ny = int(grid.ny) if grid is not None else DEFAULT_NY
    nz = int(grid.nz) if grid is not None else 1
    if nx <= 0 or ny <= 0:
        nx, ny = DEFAULT_NX, DEFAULT_NY
    if nz != 1:
        warnings.append(
            JobWarning(
                code="python-micromagnetic-nz",
                field="solverDrafts.mumax3.gridSize",
                message=f"nz={nz} was requested; this solver is strictly nz=1 and does not invent through-thickness structure.",
            )
        )
    dx = to_si(mumax.mesh_cell_size.x, kind="length")
    dy = to_si(mumax.mesh_cell_size.y, kind="length")
    dz = thickness
    if abs(nx * dx - length) / max(length, 1e-18) > 0.05:
        dx = length / nx
        warnings.append(
            JobWarning(
                code="python-micromagnetic-dx",
                message=f"dx was set to length/nx = {dx:.4g} m so the {nx}×{ny} mesh covers the free-layer footprint.",
            )
        )
    if abs(ny * dy - width) / max(width, 1e-18) > 0.05:
        dy = width / ny
        warnings.append(
            JobWarning(
                code="python-micromagnetic-dy",
                message=f"dy was set to width/ny = {dy:.4g} m so the {nx}×{ny} mesh covers the free-layer footprint.",
            )
        )
    return nx, ny, dx, dy, dz, warnings


def _script_preview(request: SimulationRequest, params: MeshParams, traj) -> str:
    kind = resolve_model_kind(request)
    return "\n".join(
        [
            "# CPU Python finite-difference LLGS (not MuMax3)",
            f"# solver_version={SOLVER_VERSION}",
            f"# modelKind={kind}",
            f"# mesh={params.__dict__.get('_nx', '?')}  dx={params.dx} dy={params.dy} dz={params.dz}",
            f"# Ms={params.msat} A/m  Aex={params.aex} J/m  alpha={params.alpha}  Ku1={params.ku1} J/m^3",
            f"# u_hat={params.u_hat}",
            f"# K_eff={traj.k_eff:.6g} J/m^3  mu0*Hk={traj.mu0_hk:.6g} T  lex={traj.lex:.6g} m",
            f"# T={params.temperature_k} K  J={params.current_a_per_m2:.6g} A/m^2  P={params.polarization}  Lambda={params.asymmetry}",
            f"# dt={params.dt_s} s  gamma*dt*B_ex={traj.dt_criterion:.4g}  n_steps={traj.n_steps}",
            "# Demag: finite-cell Newell tensor, zero-padded FFT, open boundaries.",
            "# Exchange: free-boundary Laplacian. STT: Slonczewski, positive J toward polarizer.",
        ]
    )


class PythonMicromagneticAdapter:
    name = SOLVER_NAME

    def execute(
        self,
        request: SimulationRequest,
        *,
        job_id: str | None = None,
        cancel_check=None,
        progress=None,
    ) -> SolverOutcome:
        validation = validate_mumax_request(request)
        mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
        errors = [err for err in validation.errors if err.code not in _MESH_DROPPED_ERRORS]
        warnings = [warn for warn in validation.warnings if warn.code not in _PYTHON_LLG_DROPPED_WARNINGS]
        if errors:
            return SolverOutcome(
                status="failed",
                errors=errors,
                warnings=warnings,
                provenance=Provenance(
                    created_at=utc_now(),
                    created_by="system",
                    solver="python_micromagnetic",
                    notes=["Python micromagnetic request validation failed before integration."],
                ),
            )

        nx, ny, dx, dy, dz, mesh_warnings = _mesh_geometry(request)
        warnings.extend(mesh_warnings)
        msat = to_si(mumax.saturation_magnetization, kind="magnetization")  # type: ignore[arg-type]
        alpha = to_si(mumax.damping_alpha, kind="damping")  # type: ignore[arg-type]
        aex = (
            to_si(mumax.exchange_stiffness, kind="exchange")
            if mumax.exchange_stiffness is not None
            else 1e-11
        )
        ku1 = (
            to_si(mumax.anisotropy_constant, kind="anisotropy")
            if mumax.anisotropy_constant is not None
            else 0.0
        )
        if mumax.anisotropy_axis is not None:
            u_hat = (mumax.anisotropy_axis.x, mumax.anisotropy_axis.y, mumax.anisotropy_axis.z)
        else:
            u_hat = (0.0, 0.0, 1.0)
        u_hat = normalize(u_hat)
        k_eff, mu0_hk = keff_and_hk(msat, ku1, out_of_plane=abs(u_hat[2]) > 0.9)
        if ku1 > 0 and abs(u_hat[2]) > 0.9 and k_eff <= 0:
            return SolverOutcome(
                status="failed",
                errors=[
                    JobError(
                        code="python-micromagnetic-keff-nonpositive",
                        field="solverDrafts.mumax3.anisotropyConstant",
                        message=(
                            f"K_eff={k_eff:.4g} J/m^3 is not positive; out-of-plane P/AP "
                            "are not the energy minimum in this uniaxial+demag model."
                        ),
                    )
                ],
                warnings=warnings,
                provenance=Provenance(
                    created_at=utc_now(),
                    created_by="system",
                    solver="python_micromagnetic",
                    notes=["Aborted: K_eff <= 0."],
                ),
            )

        t_ctrl = to_si(request.controls.duration, kind="time")
        if mumax.simulation_time is not None:
            t_sim = to_si(mumax.simulation_time, kind="time")
            t_max = min(t_ctrl, t_sim)
        else:
            t_max = t_ctrl
        dt_safe = recommended_dt_s(aex=aex, msat=msat, dx=dx, dy=dy, extra_b_tesla=1.0, safety=0.04)
        dt = dt_safe
        if mumax.time_step_hint is not None:
            hinted = to_si(mumax.time_step_hint, kind="time")
            if hinted > dt_safe:
                warnings.append(
                    JobWarning(
                        code="python-micromagnetic-dt-capped",
                        field="solverDrafts.mumax3.timeStepHint",
                        message=(
                            f"timeStepHint={hinted:.3g} s exceeds the exchange CFL bound "
                            f"{dt_safe:.3g} s (γ Δt B_ex < 0.04). The bound was used."
                        ),
                    )
                )
            else:
                dt = hinted

        current_j, current_dur, polarization, stt_notes = _stt_drive(request, t_max_s=t_max)
        m0_vec, pulse_t, pulse_dur, drive_notes = _preset_m0_and_pulse(
            request, t_max_s=t_max, stt_current=current_j
        )
        temperature_k = _temperature_k(request)
        pinned = normalize(
            (mumax.pinned_direction.x, mumax.pinned_direction.y, mumax.pinned_direction.z)
        )
        lambda_stt = 1.0
        field_like = 0.0
        if getattr(mumax, "stt_lambda", None) is not None:
            lambda_stt = to_si(mumax.stt_lambda, kind="damping")
        if getattr(mumax, "field_like_ratio", None) is not None:
            field_like = to_si(mumax.field_like_ratio, kind="damping")

        params = MeshParams(
            msat=msat,
            alpha=alpha,
            aex=aex,
            ku1=ku1,
            u_hat=u_hat,
            dx=dx,
            dy=dy,
            dz=dz,
            bias_t=_bias_tesla(request),
            pulse_t=pulse_t,
            pulse_duration_s=pulse_dur,
            t_max_s=t_max,
            dt_s=dt,
            p_hat=pinned,
            current_a_per_m2=current_j,
            current_duration_s=current_dur,
            polarization=polarization,
            asymmetry=lambda_stt,
            field_like_ratio=field_like,
            temperature_k=temperature_k,
            seed=_seed(request),
        )
        mask = build_mask(nx, ny, dx, dy, request.geometry.cell_shape)
        m0 = prepare_initial(mask, m0_vec)
        try:
            traj = integrate_mesh(
                m0,
                mask,
                params,
                n_frames=DEFAULT_FRAME_COUNT,
                cancel_check=cancel_check,
                progress=progress,
            )
        except IntegrationCancelled:
            return SolverOutcome(
                status="cancelled",
                warnings=warnings,
                provenance=Provenance(
                    created_at=utc_now(),
                    created_by="system",
                    solver="python_micromagnetic",
                    notes=["Cancelled during mesh integration."],
                ),
            )

        series = [
            _series("mx", traj.t, traj.mx),
            _series("my", traj.t, traj.my),
            _series("mz", traj.t, traj.mz),
            _series("e_total", traj.t, traj.energy["e_total"]),
            _series("e_ex", traj.t, traj.energy["e_ex"]),
            _series("e_demag", traj.t, traj.energy["e_demag"]),
            _series("e_anis", traj.t, traj.energy["e_anis"]),
        ]
        kind = resolve_model_kind(request)
        switching = None
        if kind == "spinvault_mtj_free_layer_switching_v1":
            switching = SwitchingDiagnosticContext(
                pinned_direction=pinned,
                state_preset=mumax.state_preset,
                threshold=mumax.switching_threshold,
            )
        jc0 = traj.critical_current_a_per_m2
        j_ratio = abs(current_j) / jc0 if jc0 not in (0.0, float("inf")) else 0.0
        settings = get_settings()
        job_dir = Path(settings.job_root) / (job_id or "python_micromagnetic")
        artifact_path = job_dir / ARTIFACT_NAME
        save_magnetization_npz(
            artifact_path,
            frames=traj.frames,
            times=traj.times,
            mask=traj.mask,
            dx=dx,
            dy=dy,
            dz=dz,
            extra={"solver_version": SOLVER_VERSION, "nx": nx, "ny": ny},
        )
        frames = frame_catalog(artifact_path, times=traj.times)
        request_hash = _hash_request(request)
        lex_over_dx = traj.lex / dx if dx > 0 else float("inf")
        metrics = [
            *magnetization_metrics_from_series(series, switching),
            ResultMetric(
                id="model-kind",
                label="Model kind",
                display_value=kind,
                unit="dimensionless",
                note="Request modelKind. Dynamics are CPU Python FD-LLGS, not MuMax3.",
            ),
            ResultMetric(
                id="solver-engine",
                label="Engine",
                display_value=SOLVER_NAME,
                unit="dimensionless",
                note=f"{SOLVER_VERSION}. nz=1 Newell-FFT mesh. Not MuMax3. Not OVF.",
            ),
            ResultMetric(
                id="mesh",
                label="Mesh",
                display_value=f"{nx}×{ny}×1",
                unit="cells",
                note=f"dx={dx:.4g} m, dy={dy:.4g} m, dz={dz:.4g} m. Active cells={int(mask.sum())}.",
            ),
            ResultMetric(
                id="exchange-length",
                label="lex / dx",
                display_value=f"{lex_over_dx:.3g}",
                unit="dimensionless",
                note=f"lex=sqrt(2A/(μ0 Ms²))={traj.lex:.4g} m. Values ≲ 1 mean the mesh poorly resolves exchange.",
            ),
            ResultMetric(
                id="timestep-criterion",
                label="γ Δt B_ex",
                display_value=f"{traj.dt_criterion:.4g}",
                unit="dimensionless",
                note=f"dt={traj.dt_s:.4g} s, n_steps={traj.n_steps}. Target < 0.05.",
            ),
            ResultMetric(
                id="keff",
                label="K_eff",
                display_value=f"{traj.k_eff:.6g}",
                unit="J/m^3",
                note="Ku1 minus thin-film μ0 Ms²/2 when the easy axis is out of plane.",
            ),
            ResultMetric(
                id="jc0",
                label="Jc0",
                display_value=f"{jc0:.6g}",
                unit="A/m^2",
                note="Macrospin coherent-rotation threshold. Mesh nucleation can switch below this.",
            ),
            ResultMetric(
                id="current-density",
                label="J",
                display_value=f"{current_j:.6g}",
                unit="A/m^2",
                note="Signed write current. Positive drives toward the polarizer (P); negative toward AP.",
            ),
            ResultMetric(
                id="j-over-jc0",
                label="J/Jc0",
                display_value=f"{j_ratio:.4g}",
                unit="dimensionless",
                note="Write margin versus the macrospin estimate, not a mesh nucleation threshold.",
            ),
            ResultMetric(
                id="temperature",
                label="T",
                display_value=f"{temperature_k:.6g}",
                unit="K",
                note="Brown field is drawn independently in every magnetic cell. T=0 is deterministic.",
            ),
            ResultMetric(
                id="thermal-sigma",
                label="sigma_T",
                display_value=f"{traj.thermal_sigma_t:.6g}",
                unit="T",
                note="Per-cell Brown amplitude sqrt(2 alpha kB T / (Ms gamma V_cell dt)).",
            ),
            ResultMetric(
                id="max-neighbor-angle",
                label="max neighbor angle",
                display_value=f"{traj.max_neighbor_angle_rad:.4g}",
                unit="rad",
                note="Largest angle between in-plane magnetic neighbors across sampled frames.",
            ),
            ResultMetric(
                id="norm-drift",
                label="max |m|-1",
                display_value=f"{traj.max_norm_drift:.3g}",
                unit="dimensionless",
                note="Peak deviation from |m|=1 before renormalization.",
            ),
            ResultMetric(
                id="seed",
                label="RNG seed",
                display_value=str(params.seed if params.seed is not None else 0),
                unit="dimensionless",
                note="Stochastic Heun seed. Ignored at T=0.",
            ),
            ResultMetric(
                id="mesh-frame-count",
                label="Mesh frames",
                display_value=str(len(frames)),
                unit="frames",
                note=f"{FRAME_FORMAT} magnetization snapshots. Not OVF.",
            ),
        ]
        notes = [
            f"modelKind={kind}",
            "CPU Python finite-difference LLGS. Not MuMax3. Not CUDA. Not calibrated.",
            "nz=1. No through-thickness domain structure is simulated.",
            "Demag: full finite-cell Newell tensor, zero-padded FFT, open boundaries.",
            f"mesh={nx}x{ny}x1 dx={dx:.4g} dy={dy:.4g} dz={dz:.4g}",
            f"lex={traj.lex:.4g} m  lex/dx={lex_over_dx:.3g}",
            f"dt={traj.dt_s:.4g} s  gamma*dt*B_ex={traj.dt_criterion:.4g}  steps={traj.n_steps}",
            f"J={current_j:.6g} A/m^2  Jc0_macrospin={jc0:.6g} A/m^2",
            f"T={temperature_k:.6g} K  seed={params.seed}",
            f"solver_version={SOLVER_VERSION}",
            f"request_hash={request_hash}",
            *drive_notes,
            *stt_notes,
        ]
        provenance = Provenance(
            created_at=utc_now(),
            created_by="system",
            solver="python_micromagnetic",
            solver_version=SOLVER_VERSION,
            input_hash=request_hash,
            notes=notes,
        )
        warnings = warnings + [
            JobWarning(
                code="python-micromagnetic-not-mumax3",
                message=(
                    "MuMax3 was not run. This result is a local CPU 2-D finite-difference "
                    "LLGS solve with Newell FFT demagnetization."
                ),
            )
        ]
        for note in [*drive_notes, *stt_notes]:
            warnings.append(JobWarning(code="python-micromagnetic-drive", message=note))
        result = SimulationResult(
            source="python_micromagnetic",
            is_physical_simulation=True,
            summary=(
                f"CPU Python {nx}×{ny}×1 LLGS completed. "
                f"{len(frames)} mesh frames. J/Jc0={j_ratio:.3g}, T={temperature_k:.4g} K. "
                "Not MuMax3. Not a measured-device prediction."
            ),
            series=series,
            metrics=metrics,
            provenance=provenance,
            artifacts=SimulationArtifacts(
                script_preview=_script_preview(request, params, traj),
                stdout=(
                    f"python_micromagnetic steps={traj.n_steps} frames={len(frames)} "
                    f"final <m>=({traj.mx[-1]:.6f}, {traj.my[-1]:.6f}, {traj.mz[-1]:.6f})\n"
                ),
                stderr="",
                manifest={
                    "engine": SOLVER_NAME,
                    "mesh": True,
                    "ovf": False,
                    "format": FRAME_FORMAT,
                    "nx": nx,
                    "ny": ny,
                    "nz": 1,
                },
                frames=frames,
            ),
        )
        return SolverOutcome(
            status="complete",
            result=result,
            warnings=warnings,
            provenance=provenance,
        )
