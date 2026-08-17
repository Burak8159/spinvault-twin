from __future__ import annotations

import math
from dataclasses import dataclass


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def sigmoid(value: float) -> float:
    return 1 / (1 + math.exp(-value))


def wave_number(energy_ev: float) -> float:
    return 5.123 * math.sqrt(max(energy_ev, 0.001))


def safe_sinh(value: float) -> float:
    if value > 80:
        return math.inf
    return math.sinh(value)


def finite_barrier_transmission(energy_ev: float, barrier_ev: float, width_nm: float) -> float:
    energy = max(energy_ev, 0.001)
    barrier = max(barrier_ev, 0.001)
    if abs(energy - barrier) < 0.002:
        return 1 / (1 + (wave_number(barrier) * width_nm) ** 2 / 4)
    if energy < barrier:
        kappa = wave_number(barrier - energy)
        sinh_term = safe_sinh(kappa * width_nm)
        if not math.isfinite(sinh_term):
            return 0
        return 1 / (1 + ((barrier * barrier) * sinh_term * sinh_term) / (4 * energy * (barrier - energy)))
    k2 = wave_number(energy - barrier)
    sin_term = math.sin(k2 * width_nm)
    return 1 / (1 + ((barrier * barrier) * sin_term * sin_term) / (4 * energy * (energy - barrier)))


@dataclass(frozen=True)
class Metrics:
    tunnel_probability: float
    retention_margin: float
    leakage_pressure: float
    attack_exposure: float
    tmr_ratio: float
    thermal_stability_delta: float
    design_window: str
    notes: list[str]


def predict_metrics(
    *,
    mode: str,
    bit_state: int,
    barrier_height_ev: float,
    electron_energy_ev: float,
    barrier_nm: float,
    spin_polarization: float,
    temperature_k: float,
    disturbance: float,
) -> Metrics:
    thermal_ev = 8.617e-5 * temperature_k
    effective_barrier_ev = max(0.01, barrier_height_ev - electron_energy_ev)
    raw_transmission = finite_barrier_transmission(electron_energy_ev, barrier_height_ev, barrier_nm)
    tunnel_probability = clamp(raw_transmission, 1e-99, 1)
    thermal_assist = math.exp(-effective_barrier_ev / max(thermal_ev, 0.001))
    tmr_ratio = (2 * spin_polarization * spin_polarization) / max(0.02, 1 - spin_polarization * spin_polarization)
    magnetic_control = clamp(0.18 + spin_polarization * 0.62 + math.log10(1 + tmr_ratio) * 0.16, 0, 0.95)
    thermal_pressure = clamp((temperature_k - 240) / 180, 0, 1)
    delta = effective_barrier_ev / max(thermal_ev, 0.001)
    log_leak_suppression = clamp(-math.log10(tunnel_probability) / 45, 0, 1)
    thermal_retention = clamp(delta / 80, 0, 1)
    nand_program_window = clamp(
        (barrier_height_ev / 5) * 0.34
        + (barrier_nm / 5) * 0.24
        + (1 - electron_energy_ev / max(barrier_height_ev, 0.1)) * 0.2,
        0,
        1,
    )
    nand_retention = clamp(
        0.08 + log_leak_suppression * 0.42 + nand_program_window * 0.28 - thermal_pressure * 0.22 - disturbance * 0.28,
        0.02,
        0.98,
    )
    nand_leakage = clamp((1 - log_leak_suppression) * 0.62 + thermal_pressure * 0.22 + disturbance * 0.34, 0.02, 0.99)
    spin_leakage = clamp(
        (1 - log_leak_suppression) * 0.5
        + thermal_assist * 0.16
        + thermal_pressure * 0.2
        + disturbance * 0.34
        - magnetic_control * 0.18,
        0.01,
        0.98,
    )
    spin_margin = clamp(
        0.1 + thermal_retention * 0.34 + magnetic_control * 0.34 + log_leak_suppression * 0.26 - thermal_pressure * 0.18 - disturbance * 0.22,
        0.02,
        0.99,
    )

    if mode == "nand":
        retention_margin = nand_retention if bit_state else clamp(1 - nand_retention * 0.86, 0.04, 0.46)
        leakage_pressure = nand_leakage
        design_window = (
            "Strong NAND window"
            if retention_margin > 0.7 and leakage_pressure < 0.34
            else "Usable NAND range"
            if retention_margin > 0.5 and leakage_pressure < 0.55
            else "NAND stress region"
        )
        notes = ["charge-trap retention proxy", "WKB-like oxide leakage", "not a TCAD model"]
    else:
        conductance_factor = 1 if bit_state else 1 / max(1.01, 1 + tmr_ratio)
        tunnel_probability *= conductance_factor
        retention_margin = spin_margin
        leakage_pressure = spin_leakage
        design_window = (
            "Strong SpinVault window"
            if retention_margin > 0.72 and leakage_pressure < 0.28 and tmr_ratio > 1
            else "Prototype range"
            if retention_margin > 0.52 and leakage_pressure < 0.46
            else "Needs tuning"
        )
        notes = ["finite-barrier transmission", "Julliere TMR readout", "LLGS solver needed for full switching"]

    attack_exposure = clamp(sigmoid((leakage_pressure - retention_margin + disturbance * 0.45) * 3.2), 0.02, 0.98)
    return Metrics(
        tunnel_probability=tunnel_probability,
        retention_margin=retention_margin,
        leakage_pressure=leakage_pressure,
        attack_exposure=attack_exposure,
        tmr_ratio=tmr_ratio,
        thermal_stability_delta=delta,
        design_window=design_window,
        notes=notes,
    )
