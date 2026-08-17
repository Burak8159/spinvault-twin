"""SI unit conversion for MuMax3 script generation.

Only explicitly mapped units are accepted. Unknown units raise ValueError.
"""

from __future__ import annotations

from app.models.simulation import Quantity

# category -> unit -> SI factor (multiply value by factor to get SI)
_LENGTH_TO_M = {"m": 1.0, "um": 1e-6, "nm": 1e-9}
_TIME_TO_S = {"s": 1.0, "ns": 1e-9, "ps": 1e-12}
_FIELD_TO_T = {"T": 1.0}
_MSAT_TO_A_PER_M = {"A/m": 1.0}
_AEX_TO_J_PER_M = {"J/m": 1.0}
_ANISOTROPY_TO_J_PER_M3 = {"J/m^3": 1.0}
_ALPHA = {"dimensionless": 1.0}
_J_TO_A_PER_M2 = {"A/m^2": 1.0}


class UnsupportedUnitError(ValueError):
    pass


def to_si(quantity: Quantity, *, kind: str) -> float:
    """
    Convert a Quantity to SI for MuMax3.

    kind:
      - length -> meters
      - time -> seconds
      - field -> tesla
      - magnetization -> A/m
      - exchange -> J/m
      - anisotropy -> J/m^3
      - damping -> dimensionless
      - current_density -> A/m^2
    """
    tables = {
        "length": _LENGTH_TO_M,
        "time": _TIME_TO_S,
        "field": _FIELD_TO_T,
        "magnetization": _MSAT_TO_A_PER_M,
        "exchange": _AEX_TO_J_PER_M,
        "anisotropy": _ANISOTROPY_TO_J_PER_M3,
        "damping": _ALPHA,
        "current_density": _J_TO_A_PER_M2,
    }
    table = tables.get(kind)
    if table is None:
        raise UnsupportedUnitError(f"Unknown quantity kind '{kind}'.")
    factor = table.get(quantity.unit)
    if factor is None:
        raise UnsupportedUnitError(
            f"Unsupported unit '{quantity.unit}' for {kind}. "
            f"Allowed: {', '.join(sorted(table))}."
        )
    if quantity.value != quantity.value or quantity.value in (float("inf"), float("-inf")):
        raise UnsupportedUnitError(f"Non-finite value for {kind}.")
    return float(quantity.value) * factor
