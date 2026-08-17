"""Mesh LLGS engine: parameters, output sampling, diagnostics."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np

from app.solvers.python_llg.engine import (
    Vec,
    critical_current_density,
    keff_and_hk,
    normalize,
    stt_efficiency,
    stt_field_tesla,
)
from app.solvers.python_micromagnetic.demag_newell import demag_operator
from app.solvers.python_micromagnetic.fields import (
    energy_density_components,
    exchange_length,
    neighbor_angle_stats,
    recommended_dt_s,
    thermal_sigma_tesla,
)
from app.solvers.python_micromagnetic.geometry import magnetic_mask, normalize_active, uniform_magnetization
from app.solvers.python_micromagnetic.integrator import MeshParams, integrate_heun

SOLVER_VERSION = "python-micromagnetic-0.1.0"
FRAME_FORMAT = "spinvault-magnetization-npz-v1"
DEFAULT_NX = 64
DEFAULT_NY = 32
DEFAULT_NZ = 1
DEFAULT_FRAME_COUNT = 81


class MeshCancelled(RuntimeError):
    pass


@dataclass
class MeshTrajectory:
    t: np.ndarray
    mx: np.ndarray
    my: np.ndarray
    mz: np.ndarray
    frames: np.ndarray
    mask: np.ndarray
    times: np.ndarray
    max_norm_drift: float
    k_eff: float
    mu0_hk: float
    stochastic: bool
    thermal_sigma_t: float
    dt_s: float
    n_steps: int
    dx: float
    dy: float
    dz: float
    lex: float
    dt_criterion: float
    max_neighbor_angle_rad: float
    mean_neighbor_angle_rad: float
    energy: dict[str, list[float]]
    critical_current_a_per_m2: float
    stt_field_t: float


def select_output_steps(
    n_steps: int,
    dt_s: float,
    *,
    pulse_duration_s: float = 0.0,
    current_duration_s: float = 0.0,
    n_frames: int = DEFAULT_FRAME_COUNT,
) -> np.ndarray:
    """Sample 51–101 frames independently of the femtosecond integration step."""
    n_frames = int(min(101, max(51, n_frames)))
    n_steps = max(1, n_steps)
    uniform = np.unique(np.clip(np.round(np.linspace(0, n_steps, n_frames)).astype(int), 0, n_steps))
    extra: list[int] = []
    if pulse_duration_s > 0.0:
        extra.append(int(np.clip(round(pulse_duration_s / dt_s), 0, n_steps)))
    if current_duration_s > 0.0:
        extra.append(int(np.clip(round(current_duration_s / dt_s), 0, n_steps)))
    return np.unique(np.concatenate([uniform, np.asarray(extra, dtype=int)]))


def mean_magnetization(m: np.ndarray, mask: np.ndarray) -> tuple[float, float, float]:
    active = m[mask]
    if active.size == 0:
        return 0.0, 0.0, 0.0
    mean = active.mean(axis=0)
    return float(mean[0]), float(mean[1]), float(mean[2])


def integrate_mesh(
    m0: np.ndarray,
    mask: np.ndarray,
    params: MeshParams,
    *,
    n_frames: int = DEFAULT_FRAME_COUNT,
    cancel_check: Callable[[], bool] | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> MeshTrajectory:
    if params.msat <= 0 or params.dt_s <= 0 or params.t_max_s <= 0:
        raise ValueError("msat, dt, and t_max must be positive.")
    ny, nx = mask.shape
    demag = demag_operator(nx, ny, params.dx, params.dy, params.dz, params.msat)
    out_of_plane = abs(params.u_hat[2]) > 0.9
    k_eff, mu0_hk = keff_and_hk(params.msat, params.ku1, out_of_plane=out_of_plane)
    cell_volume = params.dx * params.dy * params.dz
    sigma = thermal_sigma_tesla(
        alpha=params.alpha,
        temperature_k=params.temperature_k,
        msat=params.msat,
        cell_volume_m3=cell_volume,
        dt_s=params.dt_s,
    )
    rng = np.random.default_rng(params.seed if params.seed is not None else 0)
    n_steps = int(round(params.t_max_s / params.dt_s))
    output_steps = select_output_steps(
        n_steps,
        params.dt_s,
        pulse_duration_s=params.pulse_duration_s,
        current_duration_s=params.current_duration_s,
        n_frames=n_frames,
    )
    times, frames, max_drift = integrate_heun(
        m0,
        mask,
        params,
        demag,
        output_steps=output_steps,
        thermal_sigma=sigma,
        rng=rng,
        cancel_check=cancel_check,
        progress=progress,
    )
    stacked = np.stack(frames, axis=0)
    mx: list[float] = []
    my: list[float] = []
    mz: list[float] = []
    e_ex: list[float] = []
    e_anis: list[float] = []
    e_demag: list[float] = []
    e_zeeman: list[float] = []
    e_total: list[float] = []
    max_angle = 0.0
    mean_angle_acc = 0.0
    from app.solvers.python_micromagnetic.integrator import effective_field

    for frame, time_s in zip(frames, times):
        avg = mean_magnetization(frame, mask)
        mx.append(avg[0])
        my.append(avg[1])
        mz.append(avg[2])
        _, b_demag, b_ext = effective_field(frame, mask, time_s, params, demag, np.zeros_like(frame))
        energy = energy_density_components(
            frame,
            mask,
            aex=params.aex,
            ku1=params.ku1,
            u_hat=params.u_hat,
            msat=params.msat,
            dx=params.dx,
            dy=params.dy,
            dz=params.dz,
            b_demag=b_demag,
            b_ext=b_ext,
        )
        e_ex.append(energy["e_ex"])
        e_anis.append(energy["e_anis"])
        e_demag.append(energy["e_demag"])
        e_zeeman.append(energy["e_zeeman"])
        e_total.append(energy["e_total"])
        amax, amean = neighbor_angle_stats(frame, mask)
        max_angle = max(max_angle, amax)
        mean_angle_acc += amean
    mean_angle = mean_angle_acc / max(1, len(frames))
    b_ex_max = (2.0 * params.aex / params.msat) * (4.0 / params.dx**2 + 4.0 / params.dy**2)
    dt_criterion = float(1.760859644e11 * params.dt_s * b_ex_max)
    return MeshTrajectory(
        t=np.asarray(times, dtype=np.float64),
        mx=np.asarray(mx, dtype=np.float64),
        my=np.asarray(my, dtype=np.float64),
        mz=np.asarray(mz, dtype=np.float64),
        frames=stacked.astype(np.float32),
        mask=mask.astype(np.uint8),
        times=np.asarray(times, dtype=np.float64),
        max_norm_drift=max_drift,
        k_eff=k_eff,
        mu0_hk=mu0_hk,
        stochastic=sigma > 0.0,
        thermal_sigma_t=sigma,
        dt_s=params.dt_s,
        n_steps=n_steps,
        dx=params.dx,
        dy=params.dy,
        dz=params.dz,
        lex=exchange_length(params.aex, params.msat),
        dt_criterion=dt_criterion,
        max_neighbor_angle_rad=max_angle,
        mean_neighbor_angle_rad=mean_angle,
        energy={
            "e_ex": e_ex,
            "e_anis": e_anis,
            "e_demag": e_demag,
            "e_zeeman": e_zeeman,
            "e_total": e_total,
        },
        critical_current_a_per_m2=critical_current_density(
            alpha=params.alpha,
            k_eff=k_eff,
            thickness_m=params.dz,
            polarization=params.polarization,
            asymmetry=params.asymmetry,
        ),
        stt_field_t=stt_field_tesla(
            params.current_a_per_m2,
            msat=params.msat,
            thickness_m=params.dz,
            efficiency=stt_efficiency(params.polarization, params.asymmetry, 0.0),
        ),
    )


def prepare_initial(
    mask: np.ndarray,
    vector: Vec,
) -> np.ndarray:
    return normalize_active(uniform_magnetization(mask, vector), mask)


def build_mask(nx: int, ny: int, dx: float, dy: float, shape: str) -> np.ndarray:
    return magnetic_mask(nx, ny, dx, dy, shape=shape)


def timestep_for_mesh(params_like: MeshParams) -> float:
    return recommended_dt_s(
        aex=params_like.aex,
        msat=params_like.msat,
        dx=params_like.dx,
        dy=params_like.dy,
        extra_b_tesla=1.0 + abs(params_like.pulse_t[0]) + abs(params_like.pulse_t[1]) + abs(params_like.pulse_t[2]),
        safety=0.04,
    )


def unit_vector(vector: Vec) -> Vec:
    return normalize(vector)
