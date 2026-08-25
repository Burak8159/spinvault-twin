"""TranSIESTA adapter boundary. Energy-form voltage stays out of CalculationSpec.

Shared model
------------
``AppliedBias`` is a potential difference ΔV in volts (V).
``CalculationSpec`` MUST NOT contain ``TS.Voltage``.

Adapter physics
---------------
The corresponding electron electrochemical-potential difference is

    ΔE = q_e ΔV

For an electron, the numerical magnitude of ΔE in eV equals the magnitude of
ΔV in V, because q_e = 1 eV/V by definition of the electronvolt. These remain
distinct physical quantities with distinct unit semantics. Never write
``bias_eV = bias_V`` without this conversion.

SIESTA serialization
--------------------
SIESTA/TranSIESTA ``TS.Voltage`` is an energy-valued FDF parameter (eV) and
represents the potential drop between electrodes. TBtrans ``TBT.Voltage`` is
likewise an energy quantity and defaults from ``TS.Voltage``.

That FDF token exists only in engine-facing input generation.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..compat.contracts import AppliedBias

# Elementary charge in eV per volt: 1 eV is the energy of charge e across 1 V.
# This is a physical conversion factor, not a license to equate V with eV.
ELECTRON_CHARGE_EV_PER_V = 1.0


@dataclass(frozen=True)
class Energy:
    """Adapter-local energy quantity. Not a shared CalculationSpec field."""

    value: float
    unit: str = "eV"

    def __post_init__(self) -> None:
        if self.unit != "eV":
            raise ValueError(f"SIESTA adapter Energy must be in eV, got unit={self.unit!r}")


def applied_bias_to_siesta_energy(bias: AppliedBias) -> Energy:
    """Map shared electrical bias (V) to SIESTA energy (eV) via ΔE = q_e ΔV."""
    if bias.unit != "V":
        raise ValueError(f"applied_bias_to_siesta_energy expected unit V, got {bias.unit!r}")
    delta_e = float(bias.value) * ELECTRON_CHARGE_EV_PER_V
    return Energy(value=delta_e, unit="eV")


def ts_voltage_eV(bias: AppliedBias) -> float:
    """Numeric TS.Voltage (eV) for FDF emission. Prefer applied_bias_to_siesta_energy."""
    return applied_bias_to_siesta_energy(bias).value


def ts_voltage_fdf_line(bias: AppliedBias) -> str:
    """Engine-facing FDF only. Do not copy TS.Voltage onto CalculationSpec."""
    energy = applied_bias_to_siesta_energy(bias)
    return (
        f"# shared AppliedBias: DeltaV = {bias.value} {bias.unit}\n"
        f"# adapter: DeltaE = q_e * DeltaV  =>  {energy.value} {energy.unit}\n"
        f"# SIESTA energy-valued field; not a shared-schema quantity\n"
        f"TS.Voltage {energy.value} eV"
    )
