"""Projected stochastic Heun integrator for the mesh LLGS solver."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np

from app.solvers.python_llg.engine import Vec
from app.solvers.python_micromagnetic.demag_newell import DemagOperator
from app.solvers.python_micromagnetic.fields import (
    anisotropy_field_tesla,
    demag_field_tesla,
    draw_thermal_field,
    exchange_field_tesla,
    llgs_rhs,
    stt_amplitudes,
    zeeman_field_tesla,
)
from app.solvers.python_micromagnetic.geometry import max_norm_drift, normalize_active


class IntegrationCancelled(RuntimeError):
    """Raised when the worker cancel flag is set mid-run."""


@dataclass(frozen=True)
class MeshParams:
    msat: float
    alpha: float
    aex: float
    ku1: float
    u_hat: Vec
    dx: float
    dy: float
    dz: float
    bias_t: Vec
    pulse_t: Vec
    pulse_duration_s: float
    t_max_s: float
    dt_s: float
    p_hat: Vec
    current_a_per_m2: float
    current_duration_s: float
    polarization: float
    asymmetry: float
    field_like_ratio: float
    temperature_k: float
    seed: int | None = None


def effective_field(
    m: np.ndarray,
    mask: np.ndarray,
    time_s: float,
    params: MeshParams,
    demag: DemagOperator,
    noise: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (B_eff, B_demag, B_ext) without STT; STT is applied in the RHS."""
    b_ex = exchange_field_tesla(m, mask, aex=params.aex, msat=params.msat, dx=params.dx, dy=params.dy)
    b_anis = anisotropy_field_tesla(m, mask, ku1=params.ku1, msat=params.msat, u_hat=params.u_hat)
    b_demag = demag_field_tesla(m, mask, demag)
    b_ext = zeeman_field_tesla(
        mask,
        bias_t=params.bias_t,
        pulse_t=params.pulse_t,
        pulse_duration_s=params.pulse_duration_s,
        time_s=time_s,
    )
    b_eff = b_ex + b_anis + b_demag + b_ext + noise
    b_eff[~mask] = 0.0
    return b_eff, b_demag, b_ext


def rhs(
    m: np.ndarray,
    mask: np.ndarray,
    time_s: float,
    params: MeshParams,
    demag: DemagOperator,
    noise: np.ndarray,
) -> np.ndarray:
    b_eff, _, _ = effective_field(m, mask, time_s, params, demag, noise)
    a_j, b_j = stt_amplitudes(
        m,
        mask,
        time_s=time_s,
        current_a_per_m2=params.current_a_per_m2,
        current_duration_s=params.current_duration_s,
        polarization=params.polarization,
        asymmetry=params.asymmetry,
        field_like_ratio=params.field_like_ratio,
        msat=params.msat,
        thickness_m=params.dz,
        p_hat=params.p_hat,
    )
    return llgs_rhs(m, mask, b_eff, alpha=params.alpha, a_j=a_j, b_j=b_j, p_hat=params.p_hat)


def heun_step(
    m: np.ndarray,
    mask: np.ndarray,
    time_s: float,
    params: MeshParams,
    demag: DemagOperator,
    noise: np.ndarray,
) -> tuple[np.ndarray, float]:
    """One projected Heun step. The same noise is used in predictor and corrector."""
    dt = params.dt_s
    f1 = rhs(m, mask, time_s, params, demag, noise)
    predictor = normalize_active(m + dt * f1, mask)
    f2 = rhs(predictor, mask, time_s + dt, params, demag, noise)
    increment = 0.5 * dt * (f1 + f2)
    raw = m + increment
    drift = max_norm_drift(raw, mask)
    return normalize_active(raw, mask), drift


def integrate_heun(
    m0: np.ndarray,
    mask: np.ndarray,
    params: MeshParams,
    demag: DemagOperator,
    *,
    output_steps: np.ndarray,
    thermal_sigma: float,
    rng: np.random.Generator,
    cancel_check: Callable[[], bool] | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> tuple[list[float], list[np.ndarray], float]:
    """Advance `n_steps` and return sampled times, copies of m, and max |m|-1 drift."""
    n_steps = int(np.round(params.t_max_s / params.dt_s))
    wanted = set(int(step) for step in output_steps.tolist())
    wanted.add(0)
    wanted.add(n_steps)
    m = normalize_active(m0, mask)
    times: list[float] = []
    frames: list[np.ndarray] = []
    max_drift = 0.0
    if 0 in wanted:
        times.append(0.0)
        frames.append(m.copy())

    for step in range(n_steps):
        if cancel_check is not None and step % 256 == 0 and cancel_check():
            raise IntegrationCancelled("python_micromagnetic cancelled")
        if progress is not None and step % 2048 == 0:
            progress(step, n_steps)
        t = step * params.dt_s
        noise = draw_thermal_field(mask, thermal_sigma, rng)
        m, drift = heun_step(m, mask, t, params, demag, noise)
        if drift > max_drift:
            max_drift = drift
        next_step = step + 1
        if next_step in wanted:
            times.append(next_step * params.dt_s)
            frames.append(m.copy())

    if progress is not None:
        progress(n_steps, n_steps)
    return times, frames, max_drift
