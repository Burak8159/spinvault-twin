"""Map a Twin SimulationRequest onto CPU macrospin LLG.

Result source is always python_llg_twin. This adapter never claims MuMax3.
"""

from __future__ import annotations

import hashlib
from math import pi, sqrt

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
from app.solvers.python_llg.engine import (
    MacrospinParams,
    Vec,
    integrate,
    keff_and_hk,
    normalize,
    transition_initial,
)

SOLVER_NAME = "python_llg_twin"
SOLVER_VERSION = "python-llg-0.2.0"

# MuMax3-only messages: this adapter does consume current and temperature.
_PYTHON_LLG_DROPPED_ERRORS = {
    "mumax3-pulse-below-switching-field",
    "mumax3-field-pulse-missing",
    "mumax3-field-pulse-nonpositive",
}
_PYTHON_LLG_DROPPED_WARNINGS = {
    "mumax3-current-unused",
    "mumax3-temp-unused",
    "mumax3-pulse-marginal",
}


def _hash_request(request: SimulationRequest) -> str:
    payload = request.model_dump_json(by_alias=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _series(component: str, times: list[float], values: list[float]) -> ResultSeries:
    return ResultSeries(
        id=component,
        label=component,
        x_label="time",
        x_unit="s",
        y_label=component,
        y_unit="dimensionless",
        points=[ResultSeriesPoint(x=t, y=y) for t, y in zip(times, values)],
    )


def _transverse_unit(pinned: Vec) -> Vec:
    px, py, pz = pinned
    trial = (1.0, 0.0, 0.0) if abs(px) < 0.9 else (0.0, 1.0, 0.0)
    dot = trial[0] * px + trial[1] * py + trial[2] * pz
    return normalize((trial[0] - dot * px, trial[1] - dot * py, trial[2] - dot * pz))


def _free_layer_volume_m3(request: SimulationRequest) -> tuple[float, float]:
    geom = request.geometry
    length = to_si(geom.free_layer_length, kind="length")
    width = to_si(geom.free_layer_width, kind="length")
    thickness = to_si(geom.free_layer_thickness, kind="length")
    area = length * width
    if geom.cell_shape != "rectangle":
        area *= pi / 4.0
    return area * thickness, thickness


def _current_magnitude(request: SimulationRequest) -> float:
    torque = request.torque
    if torque is not None and torque.current_density is not None:
        return to_si(torque.current_density, kind="current_density")
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    if mumax.current_density is not None:
        return to_si(mumax.current_density, kind="current_density")
    return 0.0


def _polarization(request: SimulationRequest) -> float:
    torque = request.torque
    if torque is not None and torque.polarization is not None:
        return to_si(torque.polarization, kind="damping")
    return 0.6


def _temperature_k(request: SimulationRequest) -> float:
    temp = request.controls.temperature
    if temp is None:
        return 0.0
    if temp.unit != "K":
        return 0.0
    return max(0.0, temp.value)


def _seed(request: SimulationRequest) -> int | None:
    init = request.initial_magnetization
    if init is None:
        return None
    return init.seed


def _preset_m0_and_pulse(
    request: SimulationRequest,
    *,
    t_max_s: float,
    stt_current: float,
) -> tuple[Vec, Vec, float, list[str]]:
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    kind = resolve_model_kind(request)
    notes: list[str] = []
    pinned = normalize(
        (mumax.pinned_direction.x, mumax.pinned_direction.y, mumax.pinned_direction.z)
    )
    pulse_amp = (
        to_si(mumax.field_pulse_amplitude, kind="field")
        if mumax.field_pulse_amplitude is not None
        else 0.0
    )
    pulse_dur = (
        to_si(mumax.field_pulse_duration, kind="time")
        if mumax.field_pulse_duration is not None
        else 0.0
    )

    if kind == "spinvault_mtj_free_layer_switching_v1":
        preset = mumax.state_preset
        if preset == "state_0_ap":
            return (-pinned[0], -pinned[1], -pinned[2]), (0.0, 0.0, 0.0), 0.0, notes
        if preset == "state_1_p":
            return pinned, (0.0, 0.0, 0.0), 0.0, notes
        # STT is the write. A field pulse is applied only when the user sent
        # no current, so older field-driven tests still reverse.
        if abs(stt_current) > 0.0:
            notes.append(
                "macrospin-drive: Slonczewski STT is the write; the field pulse "
                "is not applied. Current sign selects P (positive) or AP (negative)."
            )
            source_sign = -1.0 if preset == "transition_0_to_1" else 1.0
            return transition_initial(pinned, source_sign), (0.0, 0.0, 0.0), 0.0, notes
        trans = _transverse_unit(pinned)
        tilt = 0.33 * pulse_amp
        axial = (
            pulse_amp * pinned[0],
            pulse_amp * pinned[1],
            pulse_amp * pinned[2],
        )
        seed = (tilt * trans[0], tilt * trans[1], tilt * trans[2])
        notes.append(
            "macrospin-drive: no STT current was supplied, so a field pulse is "
            f"held for {pulse_dur if pulse_dur > 0 else t_max_s:.3g} s with a "
            "0.33*amplitude hard-axis seed. Not a MuMax3 rectangular mesh pulse."
        )
        hold = pulse_dur if pulse_dur > 0.0 else t_max_s
        if preset == "transition_0_to_1":
            pulse = (axial[0] + seed[0], axial[1] + seed[1], axial[2] + seed[2])
            return transition_initial(pinned, -1.0), pulse, hold, notes
        pulse = (-axial[0] + seed[0], -axial[1] + seed[1], -axial[2] + seed[2])
        return transition_initial(pinned, 1.0), pulse, hold, notes

    vector = request.initial_magnetization.vector if request.initial_magnetization else None
    if vector is None:
        m0 = (0.0, 0.0, 1.0)
    else:
        m0 = normalize((vector.x, vector.y, vector.z))
    return m0, (0.0, 0.0, 0.0), 0.0, notes


def _stt_drive(
    request: SimulationRequest,
    *,
    t_max_s: float,
) -> tuple[float, float, float, list[str]]:
    """Return (signed J, duration, polarization, notes)."""
    notes: list[str] = []
    magnitude = abs(_current_magnitude(request))
    polarization = max(0.0, min(1.0, _polarization(request)))
    kind = resolve_model_kind(request)
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    duration = t_max_s
    if kind == "spinvault_mtj_free_layer_switching_v1":
        preset = mumax.state_preset
        if preset in {"state_0_ap", "state_1_p"}:
            notes.append("static preset: write current is off so the stored bit can hold.")
            return 0.0, 0.0, polarization, notes
        sign = 1.0 if preset == "transition_0_to_1" else -1.0
        if magnitude <= 0.0:
            notes.append("transition preset with J=0; STT torque is identically zero.")
            return 0.0, 0.0, polarization, notes
        notes.append(
            f"STT write: J={sign * magnitude:.6g} A/m^2 for {duration:.3g} s, "
            f"P={polarization:.3g}, Lambda=1. Positive current drives toward the polarizer (P)."
        )
        return sign * magnitude, duration, polarization, notes
    torque = request.torque
    if torque is None or not torque.enabled or magnitude <= 0.0:
        return 0.0, 0.0, polarization, notes
    sign = 1.0 if request.controls.current_direction == "positive_z" else -1.0
    return sign * magnitude, duration, polarization, notes


def _bias_tesla(request: SimulationRequest) -> Vec:
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    ext = mumax.external_field or request.external_field
    if ext is None:
        return (0.0, 0.0, 0.0)
    return (
        to_si(ext.x, kind="field"),
        to_si(ext.y, kind="field"),
        to_si(ext.z, kind="field"),
    )


def _script_preview(request: SimulationRequest, params: MacrospinParams, k_eff: float, mu0_hk: float) -> str:
    kind = resolve_model_kind(request)
    return "\n".join(
        [
            "# CPU Python macrospin LLGS (not MuMax3)",
            f"# modelKind={kind}",
            f"# Ms={params.msat} A/m  alpha={params.alpha}  Ku1={params.ku1} J/m^3",
            f"# u_hat={params.u_hat}  thin-film demag={params.include_demag}",
            f"# K_eff={k_eff:.6g} J/m^3  mu0*Hk={mu0_hk:.6g} T",
            f"# T={params.temperature_k} K  V={params.volume_m3:.6g} m^3  t_free={params.free_thickness_m:.6g} m",
            f"# J={params.current_a_per_m2:.6g} A/m^2  P={params.polarization}  Lambda={params.asymmetry}",
            "# dm/dt = -γ' m×B_eff - γ'α m×(m×B_eff) - γ' a_J m×(m×p) + γ' α a_J m×p",
            "# a_J = ħ η(θ) J / (2 e Ms t),  η = P Λ² / [(Λ²+1)+(Λ²-1) cosθ]",
            "# B_eff = μ0 (H_ext(t) + H_anis + H_demag) + Brown noise (T>0)",
            "# Pinned layer is a fixed polarizer. Not a mesh, not calibrated.",
        ]
    )


class PythonLlgAdapter:
    name = SOLVER_NAME

    def execute(self, request: SimulationRequest, *, job_id: str | None = None) -> SolverOutcome:
        _ = job_id
        validation = validate_mumax_request(request)
        mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
        errors = [err for err in validation.errors if err.code not in _PYTHON_LLG_DROPPED_ERRORS]
        warnings = [warn for warn in validation.warnings if warn.code not in _PYTHON_LLG_DROPPED_WARNINGS]
        if errors:
            return SolverOutcome(
                status="failed",
                errors=errors,
                warnings=warnings,
                provenance=Provenance(
                    created_at=utc_now(),
                    created_by="system",
                    solver="python_llg",
                    notes=["Python LLG request validation failed before integration."],
                ),
            )

        msat = to_si(mumax.saturation_magnetization, kind="magnetization")  # type: ignore[arg-type]
        alpha = to_si(mumax.damping_alpha, kind="damping")  # type: ignore[arg-type]
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
        include_demag = abs(u_hat[2]) > 0.9
        k_eff, mu0_hk = keff_and_hk(msat, ku1, out_of_plane=include_demag)
        if ku1 > 0 and include_demag and k_eff <= 0:
            return SolverOutcome(
                status="failed",
                errors=[
                    JobError(
                        code="python-llg-keff-nonpositive",
                        field="solverDrafts.mumax3.anisotropyConstant",
                        message=(
                            f"K_eff={k_eff:.4g} J/m^3 is not positive; out-of-plane P/AP "
                            "are not the energy minimum in this thin-film model."
                        ),
                    )
                ],
                warnings=warnings,
                provenance=Provenance(
                    created_at=utc_now(),
                    created_by="system",
                    solver="python_llg",
                    notes=["Aborted: K_eff <= 0."],
                ),
            )

        t_max = to_si(mumax.simulation_time or request.controls.duration, kind="time")
        dt = 5e-13
        if mumax.time_step_hint is not None:
            dt = min(dt, to_si(mumax.time_step_hint, kind="time"))
        current_j, current_dur, polarization, stt_notes = _stt_drive(request, t_max_s=t_max)
        m0, pulse_t, pulse_dur, drive_notes = _preset_m0_and_pulse(
            request, t_max_s=t_max, stt_current=current_j
        )
        volume_m3, thickness_m = _free_layer_volume_m3(request)
        temperature_k = _temperature_k(request)
        pinned = normalize(
            (mumax.pinned_direction.x, mumax.pinned_direction.y, mumax.pinned_direction.z)
        )
        params = MacrospinParams(
            msat=msat,
            alpha=alpha,
            ku1=ku1,
            u_hat=u_hat,
            include_demag=include_demag,
            bias_t=_bias_tesla(request),
            pulse_t=pulse_t,
            pulse_duration_s=pulse_dur,
            t_max_s=t_max,
            dt_s=dt,
            p_hat=pinned,
            current_a_per_m2=current_j,
            current_duration_s=current_dur,
            polarization=polarization,
            asymmetry=1.0,
            field_like_ratio=0.0,
            free_thickness_m=thickness_m,
            temperature_k=temperature_k,
            volume_m3=volume_m3,
            seed=_seed(request),
        )
        traj = integrate(m0, params)
        series = [
            _series("mx", traj.t, traj.mx),
            _series("my", traj.t, traj.my),
            _series("mz", traj.t, traj.mz),
        ]
        kind = resolve_model_kind(request)
        pinned_vec = mumax.pinned_direction
        pnorm = sqrt(pinned_vec.x**2 + pinned_vec.y**2 + pinned_vec.z**2)
        switching = None
        if kind == "spinvault_mtj_free_layer_switching_v1" and pnorm > 0:
            switching = SwitchingDiagnosticContext(
                pinned_direction=(pinned_vec.x / pnorm, pinned_vec.y / pnorm, pinned_vec.z / pnorm),
                state_preset=mumax.state_preset,
                threshold=mumax.switching_threshold,
            )
        jc0 = traj.critical_current_a_per_m2
        j_ratio = abs(current_j) / jc0 if jc0 not in (0.0, float("inf")) else 0.0
        if kind == "spinvault_mtj_free_layer_switching_v1" and mumax.state_preset.startswith("transition") and 0.0 < j_ratio < 1.0:
            warnings.append(
                JobWarning(
                    code="python-llg-stt-below-threshold",
                    message=(
                        f"|J|={abs(current_j):.4g} A/m^2 is below the zero-temperature "
                        f"macrospin threshold Jc0={jc0:.4g} A/m^2 (J/Jc0={j_ratio:.3g}). "
                        "Coherent rotation is not expected to reverse the free layer."
                    ),
                )
            )
        integrator_note = (
            "CPU stochastic Heun LLGS." if traj.stochastic else "CPU RK4 LLGS."
        )
        metrics = [
            *magnetization_metrics_from_series(series, switching),
            ResultMetric(
                id="model-kind",
                label="Model kind",
                display_value=kind,
                unit="dimensionless",
                note="Request modelKind. Dynamics are CPU macrospin LLGS, not MuMax3.",
            ),
            ResultMetric(
                id="solver-engine",
                label="Engine",
                display_value=SOLVER_NAME,
                unit="dimensionless",
                note=f"{integrator_note} Not MuMax3. Not a mesh. No OVF.",
            ),
            ResultMetric(
                id="keff",
                label="K_eff",
                display_value=f"{traj.k_eff:.6g}",
                unit="J/m^3",
                note="Ku1 minus thin-film mu0 Ms^2/2 when the easy axis is out of plane.",
            ),
            ResultMetric(
                id="mu0-hk",
                label="mu0 Hk",
                display_value=f"{traj.mu0_hk:.6g}",
                unit="T",
                note="2 K_eff / Ms. Macrospin estimate.",
            ),
            ResultMetric(
                id="jc0",
                label="Jc0",
                display_value=f"{jc0:.6g}",
                unit="A/m^2",
                note="Zero-temperature macrospin threshold 4 e alpha K_eff t / (hbar eta0). Coherent rotation overestimates real nucleation Jc.",
            ),
            ResultMetric(
                id="current-density",
                label="J",
                display_value=f"{current_j:.6g}",
                unit="A/m^2",
                note="Signed write current. Positive drives toward the polarizer (P); negative drives toward AP.",
            ),
            ResultMetric(
                id="j-over-jc0",
                label="J/Jc0",
                display_value=f"{j_ratio:.4g}",
                unit="dimensionless",
                note="Write margin. Values below 1 cannot reverse a zero-temperature uniaxial macrospin.",
            ),
            ResultMetric(
                id="temperature",
                label="T",
                display_value=f"{temperature_k:.6g}",
                unit="K",
                note="Brown thermal field. T=0 is deterministic RK4; T>0 is stochastic Heun.",
            ),
            ResultMetric(
                id="thermal-sigma",
                label="sigma_T",
                display_value=f"{traj.thermal_sigma_t:.6g}",
                unit="T",
                note="Per-component Brown amplitude sqrt(2 alpha kB T / (Ms gamma V dt)).",
            ),
            ResultMetric(
                id="ovf-frame-count",
                label="OVF frames",
                display_value="0",
                unit="frames",
                note="Macrospin twin does not write OVF meshes.",
            ),
        ]
        request_hash = _hash_request(request)
        notes = [
            f"modelKind={kind}",
            "CPU Python macrospin LLGS. Not MuMax3. Not CUDA. Not calibrated.",
            "Thin-film demag H_d ≈ -Ms mz z-hat. No exchange field (one spin).",
            "Slonczewski STT with Lambda=1. Pinned layer is a fixed polarizer, not a dynamical layer.",
            f"K_eff={traj.k_eff:.6g} J/m^3",
            f"mu0*Hk={traj.mu0_hk:.6g} T",
            f"J={current_j:.6g} A/m^2",
            f"Jc0={jc0:.6g} A/m^2",
            f"J/Jc0={j_ratio:.4g}",
            f"T={temperature_k:.6g} K",
            f"V={volume_m3:.6g} m^3",
            f"dt={params.dt_s} s",
            f"max_|m|-1_drift={traj.max_norm_drift:.3g}",
            f"request_hash={request_hash}",
            f"solver_version={SOLVER_VERSION}",
            *drive_notes,
            *stt_notes,
        ]
        provenance = Provenance(
            created_at=utc_now(),
            created_by="system",
            solver="python_llg",
            solver_version=SOLVER_VERSION,
            input_hash=request_hash,
            notes=notes,
        )
        warnings = warnings + [
            JobWarning(
                code="python-llg-not-mumax3",
                message=(
                    "MuMax3 was not run. This result is a CPU macrospin LLGS twin "
                    "(one free-layer moment, thin-film demag, Slonczewski STT, optional Brown field)."
                ),
            )
        ]
        for note in [*drive_notes, *stt_notes]:
            warnings.append(JobWarning(code="python-llg-macrospin-drive", message=note))
        result = SimulationResult(
            source="python_llg_twin",
            is_physical_simulation=True,
            summary=(
                "CPU Python macrospin LLGS completed. "
                f"J/Jc0={j_ratio:.3g}, T={temperature_k:.4g} K. "
                "Not MuMax3. Not a spatial mesh. Not a calibrated device prediction."
            ),
            series=series,
            metrics=metrics,
            provenance=provenance,
            artifacts=SimulationArtifacts(
                script_preview=_script_preview(request, params, traj.k_eff, traj.mu0_hk),
                stdout=(
                    f"python_llg_twin steps done. final m="
                    f"({traj.mx[-1]:.6f}, {traj.my[-1]:.6f}, {traj.mz[-1]:.6f}) "
                    f"J/Jc0={j_ratio:.4g} T={temperature_k:.4g} K\n"
                ),
                stderr="",
                manifest={"engine": SOLVER_NAME, "mesh": False, "ovf": False, "stt": True},
                frames=[],
            ),
        )
        return SolverOutcome(
            status="complete",
            result=result,
            warnings=warnings,
            provenance=provenance,
        )
