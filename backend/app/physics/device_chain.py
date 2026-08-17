"""NumPy port of the analytical pMTJ device chain: retention and barrier leakage.

This is a line-for-line port of ``apps/website/js/simulator/lib/devicePhysics.js``
and the barrier solution in ``apps/website/js/simulator/lib/tunnelingModel.js``,
so the notebook figures and the web dashboard cannot drift apart. The port is
pinned to ``backend/tests/data/device_chain_golden.json``, which is generated
from the JavaScript by ``scripts/export_device_chain_golden.mjs``.

Models, with their assumptions:

1. Retention: Neel-Arrhenius / Neel-Brown macrospin.
     K_eff = K_u1 - mu_0 M_s^2 / 2   (thin-film demag correction, perpendicular)
     E_b = K_eff V,  Delta = E_b / (k_B T),  tau = tau_0 exp(Delta)
     P_flip(t) = 1 - exp(-t / tau)
2. Leakage: Tsu-Esaki supply function over the transmission T(E) of the exact
   1D effective-mass barrier (rectangular at zero bias, trapezoidal under bias).
     J = (q m* k_B T / 2 pi^2 hbar^3) * INT T(E) N(E) dE
3. Angular magnetoresistance: Julliere two-current model.
     G(theta) = G_avg (1 + P1 P2 cos theta),  TMR = 2 P1 P2 / (1 - P1 P2)

These are ANALYTICAL MODELS. They are single-domain and single-band, transport
is zero-temperature apart from the supply function, and barrier height, the
tunneling effective mass, and the Fermi level are placeholders rather than
reviewed values. Nothing here is fitted to a measured device. The magnetization
dynamics are integrated separately by the python_micromagnetic mesh solver.
"""

from __future__ import annotations

from typing import Dict, Iterable, Optional, Sequence, Union

import numpy as np

HBAR = 1.054_571_817e-34
"""Reduced Planck constant [J s]."""

ELECTRON_MASS = 9.109_383_701_5e-31
"""Electron mass [kg]."""

ELECTRON_CHARGE = 1.602_176_634e-19
"""Elementary charge [C]."""

EV_TO_J = ELECTRON_CHARGE

BOLTZMANN = 1.380_649e-23
"""Boltzmann constant [J/K]."""

MU_0 = 4.0 * np.pi * 1e-7
"""Vacuum permeability [H/m]."""

ATTEMPT_TIME_SECONDS = 1e-9
"""Neel-Brown attempt time [s]. 1 ns is the conventional choice."""

SECONDS_PER_YEAR = 365.25 * 24 * 3600

TEN_YEAR_SECONDS = 10 * SECONDS_PER_YEAR
"""Storage-class retention target, reported only as a comparison."""

DEFAULT_FERMI_EV = 0.8
"""Placeholder lead Fermi level on the shared absolute energy axis [eV]."""

BARRIER_SLICES = 192
"""Slice count of the trapezoidal transfer-matrix walk. Matches the JS model."""

HONESTY = (
    "Analytical device chain: Neel-Arrhenius retention, Tsu-Esaki tunnel current, "
    "and Julliere magnetoresistance. Single-domain and single-band assumptions. "
    "Barrier height, effective mass, and Fermi level are placeholders. Not calibrated "
    "to a measured device."
)

ArrayLike = Union[float, Sequence[float], np.ndarray]


def ev_to_joules(ev: ArrayLike) -> np.ndarray:
    return np.asarray(ev, dtype=float) * EV_TO_J


def _clamp(value: float, low: float, high: float) -> float:
    if not np.isfinite(value):
        return low
    return float(min(high, max(low, value)))


def _finite(value: Optional[float], fallback: float) -> float:
    if value is None:
        return float(fallback)
    numeric = float(value)
    return numeric if np.isfinite(numeric) else float(fallback)


# --------------------------------------------------------------------------- #
# Geometry, anisotropy, and retention
# --------------------------------------------------------------------------- #


def free_layer_volume_m3(
    length_nm: float,
    width_nm: float,
    thickness_nm: float,
    shape: str = "ellipse",
) -> float:
    """Free-layer volume from the drawn footprint."""
    length = max(0.0, _finite(length_nm, 0.0)) * 1e-9
    width = max(0.0, _finite(width_nm, 0.0)) * 1e-9
    thickness = max(0.0, _finite(thickness_nm, 0.0)) * 1e-9
    area = length * width if shape == "rectangle" else (np.pi / 4.0) * length * width
    return float(area * thickness)


def effective_anisotropy(
    anisotropy_j_per_m3: float,
    saturation_magnetization_a_per_m: float,
    easy_axis: str = "perpendicular",
) -> Dict[str, Union[float, bool, str]]:
    """K_eff = K_u1 - mu_0 M_s^2 / 2 for a perpendicular easy axis."""
    ku1 = _finite(anisotropy_j_per_m3, 0.0)
    ms = max(0.0, _finite(saturation_magnetization_a_per_m, 0.0))
    shape_term = 0.0 if easy_axis == "in_plane" else (MU_0 * ms * ms) / 2.0
    k_eff = ku1 - shape_term
    return {
        "anisotropy_j_per_m3": ku1,
        "shape_term_j_per_m3": float(shape_term),
        "effective_j_per_m3": float(max(0.0, k_eff)),
        "loses_perpendicular_easy_axis": bool(k_eff <= 0.0),
        "formula": "K_eff = K_u1 - mu_0 M_s^2 / 2 (thin-film demagnetizing correction)",
    }


def thermal_stability(
    anisotropy_j_per_m3: ArrayLike,
    volume_m3: ArrayLike,
    temperature_k: ArrayLike,
) -> Dict[str, np.ndarray]:
    """Energy barrier and thermal stability factor Delta = K_eff V / (k_B T)."""
    k_eff = np.maximum(0.0, np.asarray(anisotropy_j_per_m3, dtype=float))
    volume = np.maximum(0.0, np.asarray(volume_m3, dtype=float))
    temperature = np.maximum(0.0, np.asarray(temperature_k, dtype=float))
    energy_barrier_j = k_eff * volume
    thermal_energy_j = BOLTZMANN * temperature
    with np.errstate(divide="ignore", invalid="ignore"):
        delta = np.where(thermal_energy_j > 0.0, energy_barrier_j / thermal_energy_j, np.inf)
    return {
        "energy_barrier_j": energy_barrier_j,
        "energy_barrier_ev": energy_barrier_j / ELECTRON_CHARGE,
        "thermal_energy_j": thermal_energy_j,
        "delta": delta,
        "formula": "E_b = K_eff V; Delta = E_b / (k_B T)",
    }


def retention_from_delta(
    delta: ArrayLike,
    attempt_time_seconds: float = ATTEMPT_TIME_SECONDS,
    elapsed_seconds: float = TEN_YEAR_SECONDS,
) -> Dict[str, np.ndarray]:
    """Neel-Brown dwell time and bit-flip probability.

    exp() overflows near Delta ~ 710, so the logarithm of tau is held and
    converted once. Delta = inf returns an infinite tau and zero flip
    probability rather than a NaN.
    """
    delta_arr = np.asarray(delta, dtype=float)
    attempt = max(1e-15, _finite(attempt_time_seconds, ATTEMPT_TIME_SECONDS))
    elapsed = max(0.0, _finite(elapsed_seconds, TEN_YEAR_SECONDS))
    log_elapsed = float(np.log(max(elapsed, 1e-300)))

    log_tau = np.log(attempt) + delta_arr
    tau_seconds = np.where(log_tau > 709.0, np.inf, np.exp(np.minimum(log_tau, 709.0)))
    ratio = np.exp(np.minimum(log_elapsed - log_tau, 709.0))
    flip = np.where(log_tau > log_elapsed + 40.0, 0.0, 1.0 - np.exp(-ratio))
    flip = np.clip(np.nan_to_num(flip, nan=0.0), 0.0, 1.0)

    infinite = ~np.isfinite(delta_arr)
    tau_seconds = np.where(infinite, np.inf, tau_seconds)
    flip = np.where(infinite, 0.0, flip)
    meets = np.where(infinite, True, log_tau >= np.log(TEN_YEAR_SECONDS))

    return {
        "delta": delta_arr,
        "tau_seconds": tau_seconds,
        "tau_years": tau_seconds / SECONDS_PER_YEAR,
        "elapsed_seconds": np.asarray(elapsed, dtype=float),
        "flip_probability": flip,
        "meets_ten_year_retention": meets,
        "formula": "tau = tau_0 exp(Delta); P_flip = 1 - exp(-t/tau)",
    }


def delta_for_retention(target_seconds: float, attempt_time_seconds: float = ATTEMPT_TIME_SECONDS) -> float:
    """Invert tau = tau_0 exp(Delta) for the Delta that just meets a target."""
    attempt = max(1e-15, _finite(attempt_time_seconds, ATTEMPT_TIME_SECONDS))
    return float(np.log(max(target_seconds, 1e-300)) - np.log(attempt))


# --------------------------------------------------------------------------- #
# 1D barrier transmission
# --------------------------------------------------------------------------- #


def normalize_tunneling_params(
    barrier_thickness_nm: Optional[float] = None,
    barrier_height_ev: Optional[float] = None,
    electron_energy_ev: Optional[float] = None,
    effective_mass_ratio: Optional[float] = None,
    bias_volts: Optional[float] = None,
    temperature_k: Optional[float] = None,
) -> Dict[str, float]:
    """Clamp barrier inputs to the same bounds the JavaScript model enforces."""
    return {
        "barrier_thickness_nm": _clamp(_finite(barrier_thickness_nm, 1.0), 0.2, 5.0),
        "barrier_height_ev": _clamp(_finite(barrier_height_ev, 1.2), 0.1, 8.0),
        "electron_energy_ev": _clamp(_finite(electron_energy_ev, 0.25), 0.01, 10.0),
        "effective_mass_ratio": _clamp(_finite(effective_mass_ratio, 0.4), 0.05, 2.0),
        "bias_volts": _clamp(_finite(bias_volts, 0.0), -1.5, 1.5),
        "temperature_k": _clamp(_finite(temperature_k, 300.0), 0.0, 800.0),
    }


def potential_ev_at(x_nm: float, thickness_nm: float, barrier_height_ev: float, bias_volts: float) -> float:
    """Uniform field in the insulator: electrodes at 0 and -V_bias, offset V0."""
    if x_nm < 0.0:
        return 0.0
    if x_nm > thickness_nm:
        return -bias_volts
    return barrier_height_ev - bias_volts * (x_nm / max(thickness_nm, 1e-15))


def _k_squared(energy_ev: float, potential_ev: float, mass: float) -> float:
    return (2.0 * mass * (energy_ev - potential_ev) * EV_TO_J) / (HBAR * HBAR)


def _transfer_left(psi: complex, dpsi: complex, k2: float, width: float):
    """Inverse slice map for psi'' = -k^2 psi: values at x+delta -> values at x."""
    if width == 0.0:
        return psi, dpsi
    if k2 > 1e-24:
        k = np.sqrt(k2)
        c = np.cos(k * width)
        s = np.sin(k * width)
        return c * psi - (s / k) * dpsi, (k * s) * psi + c * dpsi
    if k2 < -1e-24:
        kappa = np.sqrt(-k2)
        ch = np.cosh(kappa * width)
        sh = np.sinh(kappa * width)
        return ch * psi - (sh / kappa) * dpsi, (-kappa * sh) * psi + ch * dpsi
    return psi - width * dpsi, dpsi


def _solve_trapezoidal_barrier(params: Dict[str, float]) -> Dict[str, Union[float, str]]:
    """Stationary scattering on the biased barrier, unit incident amplitude."""
    mass = params["effective_mass_ratio"] * ELECTRON_MASS
    energy_ev = params["electron_energy_ev"]
    thickness_nm = params["barrier_thickness_nm"]
    bias = params["bias_volts"]
    d = thickness_nm * 1e-9

    k_left = np.sqrt(max(0.0, 2.0 * mass * energy_ev * EV_TO_J)) / HBAR
    right_kinetic_ev = energy_ev + bias
    k_right2 = (2.0 * mass * right_kinetic_ev * EV_TO_J) / (HBAR * HBAR)
    k_right = np.sqrt(k_right2) if k_right2 > 0 else 0.0
    kappa_right = np.sqrt(-k_right2) if k_right2 < 0 else 0.0

    psi: complex = 1.0 + 0.0j
    dpsi: complex = complex(-kappa_right, 0.0) if kappa_right > 0 else complex(0.0, k_right)

    slice_width = d / BARRIER_SLICES
    for index in range(BARRIER_SLICES - 1, -1, -1):
        x_mid_nm = ((index + 0.5) / BARRIER_SLICES) * thickness_nm
        k2 = _k_squared(energy_ev, potential_ev_at(x_mid_nm, thickness_nm, params["barrier_height_ev"], bias), mass)
        psi, dpsi = _transfer_left(psi, dpsi, k2, slice_width)

    ik_left = complex(0.0, k_left)
    incident = 0.5 * (psi + dpsi / ik_left)
    reflected = 0.5 * (psi - dpsi / ik_left)
    if abs(incident) ** 2 < 1e-30:
        raise ValueError("Vanishing incident amplitude in trapezoidal barrier.")
    scale = 1.0 / incident
    reflection_amplitude = reflected * scale
    transmission_amplitude = scale

    reflection = float(abs(reflection_amplitude) ** 2)
    transmission = float((k_right / k_left) * abs(transmission_amplitude) ** 2) if k_right > 0 else 0.0
    q_mid = _k_squared(
        energy_ev,
        potential_ev_at(thickness_nm / 2.0, thickness_nm, params["barrier_height_ev"], bias),
        mass,
    )
    kappa = 0.0 if q_mid >= 0 else float(np.sqrt(-q_mid))
    return {
        "transmission": transmission,
        "reflection": reflection,
        "kappa": kappa,
        "regime": "over_barrier" if q_mid >= 0 else "tunneling",
        "probability_conservation": reflection + transmission,
    }


def _solve_rectangular_barrier(params: Dict[str, float]) -> Dict[str, Union[float, str]]:
    """Exact four-amplitude matching solution at zero bias."""
    mass = params["effective_mass_ratio"] * ELECTRON_MASS
    energy_ev = params["electron_energy_ev"]
    bias = params["bias_volts"]
    barrier_ev = params["barrier_height_ev"] - 0.5 * bias
    right_potential_ev = -bias
    right_kinetic_ev = energy_ev - right_potential_ev
    d = params["barrier_thickness_nm"] * 1e-9

    k_left = np.sqrt(2.0 * mass * energy_ev * EV_TO_J) / HBAR
    k_right = np.sqrt(2.0 * mass * right_kinetic_ev * EV_TO_J) / HBAR if right_kinetic_ev > 0 else 0.0
    barrier_delta_ev = energy_ev - barrier_ev

    if barrier_delta_ev >= 0:
        q = complex(np.sqrt(2.0 * mass * barrier_delta_ev * EV_TO_J) / HBAR, 0.0)
    else:
        q = complex(0.0, np.sqrt(2.0 * mass * (-barrier_delta_ev) * EV_TO_J) / HBAR)

    # E == V with no lead step: the q -> 0 limit is analytic.
    if abs(barrier_delta_ev) < 1e-12 and abs(bias) < 1e-12:
        half_kd = (k_left * d) / 2.0
        denominator = complex(1.0, -half_kd)
        transmission_amplitude = 1.0 / denominator
        reflection_amplitude = complex(0.0, half_kd) / denominator
        transmission = float(abs(transmission_amplitude) ** 2)
        reflection = float(abs(reflection_amplitude) ** 2)
        return {
            "transmission": transmission,
            "reflection": reflection,
            "kappa": 0.0,
            "regime": "over_barrier",
            "probability_conservation": reflection + transmission,
        }

    if abs(q) ** 2 < 1e-24:
        q = complex(max(k_left * 1e-8, 1e-4), 0.0)

    ik_left = complex(0.0, k_left)
    ik_right = complex(0.0, k_right)
    iq = 1j * q
    e_forward = np.exp(iq * d)
    e_backward = np.exp(-1j * q * d)

    matrix = np.array(
        [
            [1.0 + 0j, -1.0 + 0j, -1.0 + 0j, 0.0 + 0j],
            [-ik_left, -iq, iq, 0.0 + 0j],
            [0.0 + 0j, e_forward, e_backward, -1.0 + 0j],
            [0.0 + 0j, iq * e_forward, -iq * e_backward, -ik_right],
        ],
        dtype=complex,
    )
    rhs = np.array([-1.0 + 0j, -ik_left, 0.0 + 0j, 0.0 + 0j], dtype=complex)
    reflection_amplitude, _forward, _backward, transmission_amplitude = np.linalg.solve(matrix, rhs)

    reflection = float(abs(reflection_amplitude) ** 2)
    transmission = float((k_right / k_left) * abs(transmission_amplitude) ** 2) if k_right > 0 else 0.0
    return {
        "transmission": transmission,
        "reflection": reflection,
        "kappa": float(abs(q.imag)),
        "regime": "tunneling" if q.imag else "over_barrier",
        "probability_conservation": reflection + transmission,
    }


def transmission(
    barrier_thickness_nm: Optional[float] = None,
    barrier_height_ev: Optional[float] = None,
    electron_energy_ev: Optional[float] = None,
    effective_mass_ratio: Optional[float] = None,
    bias_volts: Optional[float] = None,
    temperature_k: Optional[float] = None,
) -> Dict[str, Union[float, str]]:
    """T(E) for the exact 1D effective-mass barrier.

    Zero bias uses the closed rectangular matching system; finite bias uses the
    trapezoidal transfer-matrix limit of the same Hamiltonian.
    """
    params = normalize_tunneling_params(
        barrier_thickness_nm=barrier_thickness_nm,
        barrier_height_ev=barrier_height_ev,
        electron_energy_ev=electron_energy_ev,
        effective_mass_ratio=effective_mass_ratio,
        bias_volts=bias_volts,
        temperature_k=temperature_k,
    )
    solved = (
        _solve_trapezoidal_barrier(params)
        if abs(params["bias_volts"]) > 1e-12
        else _solve_rectangular_barrier(params)
    )
    solved["params"] = params
    return solved


# --------------------------------------------------------------------------- #
# Tsu-Esaki leakage
# --------------------------------------------------------------------------- #


def supply_function(
    energy_ev: ArrayLike,
    fermi_ev: float,
    bias_volts: float,
    temperature_k: float,
) -> np.ndarray:
    """Tsu-Esaki supply function ln(1+e^((E_F-E)/kT)) - ln(1+e^((E_F-E-qV)/kT))."""
    kt = BOLTZMANN * max(1e-6, float(temperature_k))
    delta_j = ev_to_joules(np.asarray(fermi_ev, dtype=float) - np.asarray(energy_ev, dtype=float))
    left = delta_j / kt
    right = (delta_j - ELECTRON_CHARGE * float(bias_volts)) / kt

    def log1p_exp(x: np.ndarray) -> np.ndarray:
        # Overflow guard identical to the JavaScript: linear above 30.
        return np.where(x > 30.0, x, np.log1p(np.exp(np.minimum(x, 30.0))))

    return log1p_exp(left) - log1p_exp(right)


def tunnel_current_density(
    barrier_thickness_nm: float,
    barrier_height_ev: float,
    effective_mass_ratio: float = 0.4,
    bias_volts: float = 0.0,
    temperature_k: float = 300.0,
    fermi_ev: float = DEFAULT_FERMI_EV,
    energy_samples: int = 33,
) -> Dict[str, object]:
    """Leakage current density through the same 1D barrier that sets psi(x).

    J = (q m* k_B T / 2 pi^2 hbar^3) * INT T(E) N(E) dE

    Energies share one absolute axis: zero is the left lead band bottom,
    ``barrier_height_ev`` is the barrier top, and ``fermi_ev`` is the lead Fermi
    level. Tunneling requires the barrier top above the Fermi level; otherwise
    the reported regime says ``over_barrier`` instead of implying tunneling.
    """
    fermi = max(0.05, _finite(fermi_ev, DEFAULT_FERMI_EV))
    temperature = max(1e-6, _finite(temperature_k, 300.0))
    bias = _finite(bias_volts, 0.0)
    samples = int(max(9, round(_finite(energy_samples, 33))))
    kt_ev = (BOLTZMANN * temperature) / ELECTRON_CHARGE
    barrier_top_ev = max(0.01, _finite(barrier_height_ev, 1.2))
    e_max_ev = fermi + abs(bias) + 20.0 * kt_ev
    e_min_ev = 1e-4
    step = (e_max_ev - e_min_ev) / (samples - 1)
    mass = max(0.01, _finite(effective_mass_ratio, 0.4)) * ELECTRON_MASS
    prefactor = (ELECTRON_CHARGE * mass * BOLTZMANN * temperature) / (
        2.0 * np.pi * np.pi * HBAR * HBAR * HBAR
    )

    energies = e_min_ev + step * np.arange(samples, dtype=float)
    transmissions = np.array(
        [
            transmission(
                barrier_thickness_nm=barrier_thickness_nm,
                barrier_height_ev=barrier_top_ev,
                electron_energy_ev=float(energy),
                effective_mass_ratio=effective_mass_ratio,
                bias_volts=bias,
                temperature_k=temperature,
            )["transmission"]
            for energy in energies
        ],
        dtype=float,
    )
    supply = supply_function(energies, fermi, bias, temperature)

    weights = np.ones(samples, dtype=float)
    weights[0] = 0.5
    weights[-1] = 0.5
    integral = float(np.sum(weights * transmissions * supply) * (step * EV_TO_J))
    current_density = prefactor * integral

    return {
        "current_density_a_per_m2": float(current_density),
        "energies_ev": energies,
        "transmission": transmissions,
        "supply": supply,
        "fermi_ev": fermi,
        "barrier_top_ev": barrier_top_ev,
        "barrier_above_fermi_ev": barrier_top_ev - fermi,
        "regime": "tunneling" if barrier_top_ev > fermi else "over_barrier",
        "formula": (
            "J = (q m* k_B T / 2 pi^2 hbar^3) * INT T(E) "
            "[ln(1+e^((E_F-E)/kT)) - ln(1+e^((E_F-E-qV)/kT))] dE"
        ),
        "placeholders": [
            "fermi_ev is a placeholder lead Fermi level, not a reviewed band-structure value.",
            "Single parabolic band with one transverse-mode supply function.",
        ],
    }


def leakage_sweep(values: Iterable[float], **fixed) -> np.ndarray:
    """Current density over one swept keyword, holding the rest fixed.

    Example: ``leakage_sweep(thicknesses, sweep="barrier_thickness_nm", bias_volts=0.1)``
    """
    sweep_key = fixed.pop("sweep")
    return np.array(
        [tunnel_current_density(**{**fixed, sweep_key: float(value)})["current_density_a_per_m2"] for value in values],
        dtype=float,
    )


# --------------------------------------------------------------------------- #
# Julliere transport
# --------------------------------------------------------------------------- #


def julliere_transport(
    conductance_avg_s: float,
    polarization_free: float = 0.4,
    polarization_ref: Optional[float] = None,
    cos_theta: ArrayLike = 1.0,
) -> Dict[str, object]:
    """G(theta) = G_avg (1 + P1 P2 cos theta); TMR = 2 P1 P2 / (1 - P1 P2)."""
    p1 = min(0.999, max(0.0, _finite(polarization_free, 0.4)))
    p2 = min(0.999, max(0.0, _finite(polarization_ref, p1)))
    cos_arr = np.clip(np.asarray(cos_theta, dtype=float), -1.0, 1.0)
    g_avg = max(0.0, _finite(conductance_avg_s, 0.0))
    product = p1 * p2

    conductance = g_avg * (1.0 + product * cos_arr)
    conductance_p = g_avg * (1.0 + product)
    conductance_ap = g_avg * (1.0 - product)

    def to_resistance(g):
        g_arr = np.asarray(g, dtype=float)
        with np.errstate(divide="ignore", invalid="ignore"):
            return np.where(g_arr > 0.0, 1.0 / np.where(g_arr > 0.0, g_arr, 1.0), np.inf)

    return {
        "polarization_free": p1,
        "polarization_ref": p2,
        "cos_theta": cos_arr,
        "conductance_s": conductance,
        "resistance_ohm": to_resistance(conductance),
        "resistance_parallel_ohm": float(to_resistance(conductance_p)),
        "resistance_antiparallel_ohm": float(to_resistance(conductance_ap)),
        "tmr_ratio": float((2.0 * product) / (1.0 - product)) if product < 1.0 else np.inf,
        "formula": "G(theta) = G_avg (1 + P1 P2 cos theta); TMR = 2 P1 P2 / (1 - P1 P2)",
    }
