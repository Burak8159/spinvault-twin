"""Typed transport observables. Names are not interchangeable."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class CurrentSpinPolarization:
    """(I_up - I_down) / (I_up + I_down) on a declared two-channel domain."""

    value: Optional[float]
    definition_id: str
    unit: str = "dimensionless"


@dataclass(frozen=True)
class InjectedSpinFraction:
    """Injected population or current fraction. Not stored polarization."""

    value: Optional[float]
    definition_id: str
    unit: str = "dimensionless"


@dataclass(frozen=True)
class NormalizedChannelFractions:
    """The only object on which P_up + P_down == 1 is a required identity."""

    p_up: float
    p_down: float
    definition_id: str
    unit: str = "dimensionless"

    def __post_init__(self) -> None:
        total = self.p_up + self.p_down
        if abs(total - 1.0) > 1e-12:
            raise ValueError(f"normalized channel fractions must sum to 1, got {total}")


@dataclass(frozen=True)
class StoredSpinPopulation:
    """Device stored population. Transport cannot construct this."""

    value: Optional[float]
    definition_id: str
    unit: str = "dimensionless"
    provenance_note: str = (
        "P_store is not a NEGF output. It requires RetentionCouplingSpec."
    )


class UnresolvedCouplingError(ValueError):
    """Raised when transport is asked to emit a retention/storage quantity."""
