"""Effective fields for the nz=1 finite-difference LLGS solver."""

from __future__ import annotations

import numpy as np

from app.solvers.python_llg.engine import GAMMA, MU0, Vec, stt_field_tesla
from app.solvers.python_micromagnetic.demag_newell import DemagOperator
from app.solvers.python_micromagnetic.geometry import max_norm_drift

K_B = 1.380649e-23


def exchange_length(aex: float, msat: float) -> float:
    if msat <= 0.0:
        return float("inf")
    return float(np.sqrt(2.0 * aex / (MU0 * msat * msat)))


def exchange_field_bound_tesla(aex: float, msat: float, dx: float, dy: float) -> float:
    """Worst-case |B_ex| from the 2-D free-boundary Laplacian."""
    if msat <= 0.0 or dx <= 0.0 or dy <= 0.0:
        return 0.0
    return (2.0 * aex / msat) * (4.0 / dx**2 + 4.0 / dy**2)


def recommended_dt_s(
    *,
    aex: float,
    msat: float,
    dx: float,
    dy: float,
    extra_b_tesla: float = 1.0,
    safety: float = 0.04,
) -> float:
    """Choose Δt so γ Δt B_bound stays under `safety` (typically 0.03–0.05)."""
    b_bound = exchange_field_bound_tesla(aex, msat, dx, dy) + max(0.0, extra_b_tesla)
    if b_bound <= 0.0:
        return 1e-13
    return safety / (GAMMA * b_bound)


def exchange_field_tesla(
    m: np.ndarray,
    mask: np.ndarray,
    *,
    aex: float,
    msat: float,
    dx: float,
    dy: float,
) -> np.ndarray:
    """Mask-aware 5-point Laplacian with Neumann (missing-neighbor) boundaries.

    B_ex = (2A / Ms) ∇²m. A missing or vacuum neighbor contributes 0, which is
    equivalent to ∂n m = 0 on the free-layer edge. The mesh is not periodic.
    """
    if aex == 0.0 or msat <= 0.0:
        return np.zeros_like(m)
    ny, nx, _ = m.shape
    padded_m = np.zeros((ny + 2, nx + 2, 3), dtype=np.float64)
    padded_mask = np.zeros((ny + 2, nx + 2), dtype=bool)
    padded_m[1:-1, 1:-1] = np.where(mask[:, :, None], m, 0.0)
    padded_mask[1:-1, 1:-1] = mask
    center = padded_m[1:-1, 1:-1]
    mag = padded_mask[1:-1, 1:-1].astype(np.float64)
    lap = np.zeros_like(center)
    for shift_y, shift_x, inv_d2 in (
        (0, 1, 1.0 / dx**2),
        (0, -1, 1.0 / dx**2),
        (1, 0, 1.0 / dy**2),
        (-1, 0, 1.0 / dy**2),
    ):
        neighbor_mask = padded_mask[1 + shift_y : 1 + shift_y + ny, 1 + shift_x : 1 + shift_x + nx]
        neighbor_m = padded_m[1 + shift_y : 1 + shift_y + ny, 1 + shift_x : 1 + shift_x + nx]
        weight = mag * neighbor_mask.astype(np.float64)
        lap += (neighbor_m - center) * weight[:, :, None] * inv_d2
    field = (2.0 * aex / msat) * lap
    field[~mask] = 0.0
    return field


def anisotropy_field_tesla(m: np.ndarray, mask: np.ndarray, *, ku1: float, msat: float, u_hat: Vec) -> np.ndarray:
    if ku1 == 0.0 or msat <= 0.0:
        return np.zeros_like(m)
    u = np.array(u_hat, dtype=np.float64)
    m_dot_u = m @ u
    field = (2.0 * ku1 / msat) * m_dot_u[:, :, None] * u
    field[~mask] = 0.0
    return field


def zeeman_field_tesla(
    mask: np.ndarray,
    *,
    bias_t: Vec,
    pulse_t: Vec,
    pulse_duration_s: float,
    time_s: float,
) -> np.ndarray:
    pulse_on = time_s < pulse_duration_s
    b = np.array(bias_t, dtype=np.float64)
    if pulse_on:
        b = b + np.array(pulse_t, dtype=np.float64)
    field = np.zeros(mask.shape + (3,), dtype=np.float64)
    field[mask] = b
    return field


def demag_field_tesla(m: np.ndarray, mask: np.ndarray, operator: DemagOperator) -> np.ndarray:
    return operator.field_tesla(m, mask)


def thermal_sigma_tesla(
    *,
    alpha: float,
    temperature_k: float,
    msat: float,
    cell_volume_m3: float,
    dt_s: float,
) -> float:
    if temperature_k <= 0.0 or cell_volume_m3 <= 0.0 or msat <= 0.0 or dt_s <= 0.0 or alpha < 0.0:
        return 0.0
    return float(np.sqrt(2.0 * alpha * K_B * temperature_k / (msat * GAMMA * cell_volume_m3 * dt_s)))


def draw_thermal_field(
    mask: np.ndarray,
    sigma: float,
    rng: np.random.Generator,
) -> np.ndarray:
    if sigma <= 0.0:
        return np.zeros(mask.shape + (3,), dtype=np.float64)
    noise = rng.normal(loc=0.0, scale=sigma, size=mask.shape + (3,))
    noise[~mask] = 0.0
    return noise


def stt_amplitudes(
    m: np.ndarray,
    mask: np.ndarray,
    *,
    time_s: float,
    current_a_per_m2: float,
    current_duration_s: float,
    polarization: float,
    asymmetry: float,
    field_like_ratio: float,
    msat: float,
    thickness_m: float,
    p_hat: Vec,
) -> tuple[np.ndarray, np.ndarray]:
    ny, nx = mask.shape
    zeros = np.zeros((ny, nx), dtype=np.float64)
    if current_a_per_m2 == 0.0 or time_s >= current_duration_s or msat <= 0.0 or thickness_m <= 0.0:
        return zeros, zeros
    p = np.array(p_hat, dtype=np.float64)
    cos_theta = m @ p
    lam2 = asymmetry * asymmetry
    denom = (lam2 + 1.0) + (lam2 - 1.0) * cos_theta
    eps = np.where(denom > 0.0, polarization * lam2 / denom, 0.0)
    a_j = (1.054571817e-34 * eps * current_a_per_m2) / (2.0 * 1.602176634e-19 * msat * thickness_m)
    a_j = np.where(mask, a_j, 0.0)
    return a_j, field_like_ratio * a_j


def llgs_rhs(
    m: np.ndarray,
    mask: np.ndarray,
    b_eff: np.ndarray,
    *,
    alpha: float,
    a_j: np.ndarray,
    b_j: np.ndarray,
    p_hat: Vec,
) -> np.ndarray:
    """Gilbert LLGS in tesla. Positive a_J drives m toward p."""
    gp = GAMMA / (1.0 + alpha * alpha)
    p = np.array(p_hat, dtype=np.float64)
    b = np.array(b_eff, dtype=np.float64, copy=True)
    if np.any(b_j):
        b += b_j[:, :, None] * p
    mxb = np.cross(m, b)
    rhs = (-gp) * mxb - (gp * alpha) * np.cross(m, mxb)
    if np.any(a_j):
        mxp = np.cross(m, p)
        rhs += (-gp * a_j[:, :, None]) * np.cross(m, mxp)
        rhs += (gp * alpha * a_j[:, :, None]) * mxp
    rhs[~mask] = 0.0
    return rhs


def neighbor_angle_stats(m: np.ndarray, mask: np.ndarray) -> tuple[float, float]:
    """Return (max, mean) angle in radians between in-plane magnetic neighbors."""
    mag = mask
    angles: list[float] = []

    def _angles(a: np.ndarray, b: np.ndarray, w: np.ndarray) -> None:
        dots = np.clip(np.sum(a * b, axis=2), -1.0, 1.0)
        values = np.arccos(dots)[w]
        angles.extend(values.tolist())

    right = mag[:, :-1] & mag[:, 1:]
    _angles(m[:, :-1], m[:, 1:], right)
    up = mag[:-1, :] & mag[1:, :]
    _angles(m[:-1, :], m[1:, :], up)
    if not angles:
        return 0.0, 0.0
    arr = np.asarray(angles, dtype=np.float64)
    return float(np.max(arr)), float(np.mean(arr))


def energy_density_components(
    m: np.ndarray,
    mask: np.ndarray,
    *,
    aex: float,
    ku1: float,
    u_hat: Vec,
    msat: float,
    dx: float,
    dy: float,
    dz: float,
    b_demag: np.ndarray,
    b_ext: np.ndarray,
) -> dict[str, float]:
    """Extensive energies in joules for the magnetic cells."""
    volume = dx * dy * dz
    n_active = int(np.count_nonzero(mask))
    if n_active == 0:
        return {
            "e_ex": 0.0,
            "e_anis": 0.0,
            "e_demag": 0.0,
            "e_zeeman": 0.0,
            "e_total": 0.0,
            "active_cells": 0,
        }
    # Exchange: A Σ_neighbors |m_i - m_j|² V / (2 Δ²)
    e_ex = 0.0
    mag = mask
    right = mag[:, :-1] & mag[:, 1:]
    diff = m[:, 1:] - m[:, :-1]
    e_ex += float(np.sum(np.sum(diff * diff, axis=2)[right])) * (aex * volume / (2.0 * dx * dx))
    up = mag[:-1, :] & mag[1:, :]
    diff = m[1:, :] - m[:-1, :]
    e_ex += float(np.sum(np.sum(diff * diff, axis=2)[up])) * (aex * volume / (2.0 * dy * dy))

    u = np.array(u_hat, dtype=np.float64)
    m_dot_u = np.sum(m * u, axis=2)
    e_anis = float(-ku1 * volume * np.sum(m_dot_u[mask] ** 2))
    e_demag = float(-0.5 * msat * volume * np.sum((m * b_demag)[mask]))
    e_zeeman = float(-msat * volume * np.sum((m * b_ext)[mask]))
    return {
        "e_ex": e_ex,
        "e_anis": e_anis,
        "e_demag": e_demag,
        "e_zeeman": e_zeeman,
        "e_total": e_ex + e_anis + e_demag + e_zeeman,
        "active_cells": n_active,
        "max_norm_drift": max_norm_drift(m, mask),
    }
