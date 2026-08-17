"""CPU macrospin Landau-Lifshitz-Gilbert-Slonczewski for one pMTJ free layer.

This is not MuMax3. Thin-film demag is the first-order out-of-plane
approximation H_d = -Ms mz z-hat, not a magnetostatic solve. The spin
torque is the macrospin Slonczewski form with a Lambda asymmetry factor,
not a transport calculation.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, replace
from math import pi, sqrt

MU0 = 4.0 * pi * 1e-7
# Cross product with B in tesla.
GAMMA = 1.760859644e11
CANT = 0.15
HBAR = 1.054571817e-34
E_CHARGE = 1.602176634e-19
K_B = 1.380649e-23


Vec = tuple[float, float, float]


def _add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _scale(a: Vec, s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Vec, b: Vec) -> Vec:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _norm(a: Vec) -> float:
    return sqrt(_dot(a, a))


def normalize(a: Vec) -> Vec:
    n = _norm(a)
    if n <= 0.0:
        raise ValueError("Cannot normalize a zero vector.")
    return _scale(a, 1.0 / n)


def shape_anisotropy_density(msat: float) -> float:
    return 0.5 * MU0 * msat * msat


def keff_and_hk(msat: float, ku1: float, *, out_of_plane: bool) -> tuple[float, float]:
    shape = shape_anisotropy_density(msat) if out_of_plane else 0.0
    k_eff = ku1 - shape
    mu0_hk = 2.0 * k_eff / msat if msat > 0 else float("nan")
    return k_eff, mu0_hk


def stt_efficiency(polarization: float, asymmetry: float, cos_theta: float) -> float:
    """Slonczewski angular efficiency eps(theta) = P L^2 / [(L^2+1) + (L^2-1) cos(theta)].

    Lambda = 1 is the symmetric limit eps = P/2. Lambda > 1 makes the torque
    stronger near the parallel state, which is the usual MgO-barrier case.
    """
    lam2 = asymmetry * asymmetry
    denom = (lam2 + 1.0) + (lam2 - 1.0) * cos_theta
    if denom <= 0.0:
        return 0.0
    return polarization * lam2 / denom


def stt_field_tesla(
    current_a_per_m2: float,
    *,
    msat: float,
    thickness_m: float,
    efficiency: float,
) -> float:
    """Damping-like Slonczewski torque expressed as an equivalent field a_J in tesla.

    a_J = hbar * eps * J / (2 e Ms t_free). Positive current drives m toward the
    polarizer (parallel); negative current drives it away (antiparallel).
    """
    if msat <= 0.0 or thickness_m <= 0.0:
        return 0.0
    return HBAR * efficiency * current_a_per_m2 / (2.0 * E_CHARGE * msat * thickness_m)


def critical_current_density(
    *,
    alpha: float,
    k_eff: float,
    thickness_m: float,
    polarization: float,
    asymmetry: float,
) -> float:
    """Zero-temperature macrospin switching threshold Jc0 = 4 e alpha K_eff t / (hbar eps0).

    eps0 is the efficiency at cos(theta) = 0, which equals P/2 in the symmetric
    limit and reproduces the textbook Jc0 = 4 e alpha E_b / (hbar eps0 A).
    """
    eps0 = stt_efficiency(polarization, asymmetry, 0.0)
    if eps0 <= 0.0 or thickness_m <= 0.0:
        return float("inf")
    return 4.0 * E_CHARGE * alpha * k_eff * thickness_m / (HBAR * eps0)


def thermal_field_sigma_tesla(
    *,
    alpha: float,
    temperature_k: float,
    msat: float,
    volume_m3: float,
    dt_s: float,
) -> float:
    """Brown fluctuation amplitude sigma = sqrt(2 alpha kB T / (Ms gamma V dt)) in tesla.

    Same expression MuMax3 uses for its thermal field, written for B rather
    than H. One independent draw per Cartesian component per step.
    """
    if temperature_k <= 0.0 or volume_m3 <= 0.0 or msat <= 0.0 or dt_s <= 0.0:
        return 0.0
    return sqrt(2.0 * alpha * K_B * temperature_k / (msat * GAMMA * volume_m3 * dt_s))


def transition_initial(pinned: Vec, source_sign: float) -> Vec:
    """Nearly collinear P/AP with a small in-plane cant so torque is nonzero."""
    px, py, pz = normalize(pinned)
    trial = (1.0, 0.0, 0.0) if abs(px) < 0.9 else (0.0, 1.0, 0.0)
    dot = trial[0] * px + trial[1] * py + trial[2] * pz
    tx, ty, tz = trial[0] - dot * px, trial[1] - dot * py, trial[2] - dot * pz
    t = normalize((tx, ty, tz))
    base = sqrt(1.0 - CANT * CANT)
    return (
        source_sign * base * px + CANT * t[0],
        source_sign * base * py + CANT * t[1],
        source_sign * base * pz + CANT * t[2],
    )


@dataclass(frozen=True)
class MacrospinParams:
    msat: float
    alpha: float
    ku1: float
    u_hat: Vec
    include_demag: bool
    bias_t: Vec
    pulse_t: Vec
    pulse_duration_s: float
    t_max_s: float
    dt_s: float = 5e-13
    # Slonczewski spin-transfer torque. Zero current reduces exactly to LLG.
    p_hat: Vec = (0.0, 0.0, 1.0)
    current_a_per_m2: float = 0.0
    current_duration_s: float = 0.0
    polarization: float = 0.0
    asymmetry: float = 1.0
    field_like_ratio: float = 0.0
    free_thickness_m: float = 0.0
    # Brown thermal field. Zero temperature reduces exactly to deterministic LLG.
    temperature_k: float = 0.0
    volume_m3: float = 0.0
    seed: int | None = None


@dataclass
class Trajectory:
    t: list[float]
    mx: list[float]
    my: list[float]
    mz: list[float]
    max_norm_drift: float
    k_eff: float
    mu0_hk: float
    stochastic: bool = False
    thermal_sigma_t: float = 0.0
    stt_field_t: float = 0.0
    critical_current_a_per_m2: float = float("inf")


def _heff_tesla(m: Vec, t: float, params: MacrospinParams) -> Vec:
    pulse_on = t < params.pulse_duration_s
    b_ext = _add(params.bias_t, params.pulse_t) if pulse_on else params.bias_t
    h_ext = _scale(b_ext, 1.0 / MU0)
    u = params.u_hat
    h_anis = _scale(u, (2.0 * params.ku1 / (MU0 * params.msat)) * _dot(m, u))
    h_demag = (0.0, 0.0, -params.msat * m[2]) if params.include_demag else (0.0, 0.0, 0.0)
    h = _add(_add(h_ext, h_anis), h_demag)
    return _scale(h, MU0)


def _stt_amplitudes(m: Vec, t: float, params: MacrospinParams) -> tuple[float, float]:
    """Damping-like a_J and field-like b_J in tesla for the current state and time."""
    if params.current_a_per_m2 == 0.0 or t >= params.current_duration_s:
        return 0.0, 0.0
    eps = stt_efficiency(params.polarization, params.asymmetry, _dot(m, params.p_hat))
    a_j = stt_field_tesla(
        params.current_a_per_m2,
        msat=params.msat,
        thickness_m=params.free_thickness_m,
        efficiency=eps,
    )
    return a_j, params.field_like_ratio * a_j


def _rhs(m: Vec, t: float, params: MacrospinParams, noise: Vec = (0.0, 0.0, 0.0)) -> Vec:
    b = _add(_heff_tesla(m, t, params), noise)
    a_j, b_j = _stt_amplitudes(m, t, params)
    if b_j != 0.0:
        # Field-like torque enters as an extra effective field along p.
        b = _add(b, _scale(params.p_hat, b_j))
    gp = GAMMA / (1.0 + params.alpha * params.alpha)
    mxb = _cross(m, b)
    out = _add(_scale(mxb, -gp), _scale(_cross(m, mxb), -gp * params.alpha))
    if a_j != 0.0:
        # Landau-Lifshitz form of the Slonczewski torque: the m x p term is the
        # 1/(1+alpha^2) cross-coupling produced by converting from Gilbert form.
        mxp = _cross(m, params.p_hat)
        out = _add(out, _scale(_cross(m, mxp), -gp * a_j))
        out = _add(out, _scale(mxp, gp * params.alpha * a_j))
    return out


def integrate(m0: Vec, params: MacrospinParams, *, max_samples: int = 400) -> Trajectory:
    if params.msat <= 0 or params.dt_s <= 0 or params.t_max_s <= 0:
        raise ValueError("msat, dt, and t_max must be positive.")
    u = normalize(params.u_hat)
    p = normalize(params.p_hat) if _norm(params.p_hat) > 0 else (0.0, 0.0, 1.0)
    params = replace(params, u_hat=u, p_hat=p)
    out_of_plane = abs(u[2]) > 0.9
    k_eff, mu0_hk = keff_and_hk(params.msat, params.ku1, out_of_plane=out_of_plane)

    dt = params.dt_s
    sigma = thermal_field_sigma_tesla(
        alpha=params.alpha,
        temperature_k=params.temperature_k,
        msat=params.msat,
        volume_m3=params.volume_m3,
        dt_s=dt,
    )
    stochastic = sigma > 0.0
    rng = random.Random(params.seed if params.seed is not None else 0)

    n_steps = int(params.t_max_s / dt)
    stride = max(1, n_steps // max_samples)
    m = normalize(m0)
    t = 0.0
    times = [0.0]
    xs = [m[0]]
    ys = [m[1]]
    zs = [m[2]]
    max_drift = 0.0

    for step in range(n_steps):
        if stochastic:
            # Stochastic Heun (Stratonovich). RK4 is not a valid SDE integrator:
            # the same noise draw must be reused by predictor and corrector.
            noise = (
                sigma * rng.gauss(0.0, 1.0),
                sigma * rng.gauss(0.0, 1.0),
                sigma * rng.gauss(0.0, 1.0),
            )
            f1 = _rhs(m, t, params, noise)
            predictor = normalize(_add(m, _scale(f1, dt)))
            f2 = _rhs(predictor, t + dt, params, noise)
            increment = _scale(_add(f1, f2), 0.5 * dt)
        else:
            k1 = _rhs(m, t, params)
            k2 = _rhs(_add(m, _scale(k1, 0.5 * dt)), t + 0.5 * dt, params)
            k3 = _rhs(_add(m, _scale(k2, 0.5 * dt)), t + 0.5 * dt, params)
            k4 = _rhs(_add(m, _scale(k3, dt)), t + dt, params)
            increment = _scale(
                _add(_add(k1, _scale(k2, 2.0)), _add(_scale(k3, 2.0), k4)),
                dt / 6.0,
            )
        raw = _add(m, increment)
        drift = abs(_norm(raw) - 1.0)
        if drift > max_drift:
            max_drift = drift
        m = normalize(raw)
        t = (step + 1) * dt
        if (step + 1) % stride == 0 or step + 1 == n_steps:
            times.append(t)
            xs.append(m[0])
            ys.append(m[1])
            zs.append(m[2])

    return Trajectory(
        t=times,
        mx=xs,
        my=ys,
        mz=zs,
        max_norm_drift=max_drift,
        k_eff=k_eff,
        mu0_hk=mu0_hk,
        stochastic=stochastic,
        thermal_sigma_t=sigma,
        stt_field_t=stt_field_tesla(
            params.current_a_per_m2,
            msat=params.msat,
            thickness_m=params.free_thickness_m,
            efficiency=stt_efficiency(params.polarization, params.asymmetry, 0.0),
        ),
        critical_current_a_per_m2=critical_current_density(
            alpha=params.alpha,
            k_eff=k_eff,
            thickness_m=params.free_thickness_m,
            polarization=params.polarization,
            asymmetry=params.asymmetry,
        ),
    )
