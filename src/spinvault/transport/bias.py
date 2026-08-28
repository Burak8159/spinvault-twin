"""Shared bias model and SIESTA adapter boundary."""

from __future__ import annotations

from dataclasses import dataclass

from spinvault.core.contracts import AppliedBias

ELECTRON_CHARGE_EV_PER_V = 1.0


@dataclass(frozen=True)
class Energy:
    value: float
    unit: str = "eV"

    def __post_init__(self) -> None:
        if self.unit != "eV":
            raise ValueError(f"SIESTA adapter Energy must be in eV, got unit={self.unit!r}")


def applied_bias_to_siesta_energy(bias: AppliedBias) -> Energy:
    if bias.unit != "V":
        raise ValueError(f"applied_bias_to_siesta_energy expected unit V, got {bias.unit!r}")
    return Energy(value=float(bias.value) * ELECTRON_CHARGE_EV_PER_V, unit="eV")


def ts_voltage_eV(bias: AppliedBias) -> float:
    return applied_bias_to_siesta_energy(bias).value


def ts_voltage_fdf_line(bias: AppliedBias) -> str:
    energy = applied_bias_to_siesta_energy(bias)
    return (
        f"# shared AppliedBias: DeltaV = {bias.value} {bias.unit}\n"
        f"# adapter: DeltaE = q_e * DeltaV  =>  {energy.value} {energy.unit}\n"
        f"# SIESTA energy-valued field; not a shared-schema quantity\n"
        f"TS.Voltage {energy.value} eV"
    )
