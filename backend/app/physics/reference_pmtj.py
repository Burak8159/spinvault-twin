"""Reference pMTJ parameter metadata for the first MuMax3 validation experiment.

Values in this file are intentionally not presented as calibrated CoFeB/MgO
device constants. Until literature sources are selected and recorded, every
numeric default is UNVALIDATED_DEFAULT.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

ProvenanceStatus = Literal["UNVALIDATED_DEFAULT", "USER", "LITERATURE", "DERIVED"]
SimulationRole = Literal[
    "DIRECT_MUMAX3",
    "DERIVED",
    "RECORDED_NOT_SIMULATED",
    "NOT_IMPLEMENTED",
]


@dataclass(frozen=True)
class ReferenceParameter:
    name: str
    symbol: str
    si_unit: str
    internal_unit: str
    default_value: float | tuple[float, float, float] | None
    physical_meaning: str
    simulation_role: SimulationRole
    provenance_status: ProvenanceStatus = "UNVALIDATED_DEFAULT"
    citation: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


REFERENCE_PMTJ_ID = "reference_pmtj_v01_unvalidated"

REFERENCE_PMTJ_PARAMETERS: tuple[ReferenceParameter, ...] = (
    ReferenceParameter(
        "Free-layer diameter",
        "D",
        "m",
        "m",
        40e-9,
        "Lateral diameter of the circular free magnetic layer.",
        "DIRECT_MUMAX3",
    ),
    ReferenceParameter(
        "Free-layer thickness",
        "t_F",
        "m",
        "m",
        1.2e-9,
        "Thickness of the magnetic free layer represented by the MuMax3 mesh.",
        "DIRECT_MUMAX3",
    ),
    ReferenceParameter(
        "MgO barrier thickness",
        "t_ox",
        "m",
        "m",
        1.0e-9,
        "Geometric barrier thickness recorded for the reference stack; MuMax3 does not solve it.",
        "RECORDED_NOT_SIMULATED",
    ),
    ReferenceParameter(
        "Reference-layer thickness",
        "t_ref",
        "m",
        "m",
        2.0e-9,
        "Geometric fixed-layer thickness recorded for the reference stack; V01 does not mesh it.",
        "RECORDED_NOT_SIMULATED",
    ),
    ReferenceParameter(
        "Saturation magnetization",
        "M_s",
        "A/m",
        "A/m",
        1.0e6,
        "Magnetic moment density assigned to the free layer.",
        "DIRECT_MUMAX3",
    ),
    ReferenceParameter(
        "Exchange stiffness",
        "A_ex",
        "J/m",
        "J/m",
        1.0e-11,
        "Continuum exchange-energy coefficient of the free layer.",
        "DIRECT_MUMAX3",
    ),
    ReferenceParameter(
        "Uniaxial anisotropy",
        "K_u",
        "J/m^3",
        "J/m^3",
        8.0e5,
        "Perpendicular uniaxial anisotropy energy density.",
        "DIRECT_MUMAX3",
    ),
    ReferenceParameter(
        "Gilbert damping",
        "alpha",
        "dimensionless",
        "dimensionless",
        0.01,
        "Phenomenological damping coefficient used during relaxation/dynamics.",
        "DIRECT_MUMAX3",
    ),
    ReferenceParameter(
        "Spin polarization",
        "P",
        "dimensionless",
        "dimensionless",
        None,
        "Torque/transport polarization. V01 equilibrium does not use spin torque.",
        "NOT_IMPLEMENTED",
    ),
    ReferenceParameter(
        "Temperature",
        "T",
        "K",
        "K",
        0.0,
        "V01 is a deterministic zero-temperature reference; no thermal field is enabled.",
        "RECORDED_NOT_SIMULATED",
    ),
    ReferenceParameter(
        "External magnetic field",
        "B_ext",
        "T",
        "T",
        (0.0, 0.0, 0.0),
        "Applied flux-density vector during V01 relaxation.",
        "DIRECT_MUMAX3",
    ),
    ReferenceParameter(
        "Current density",
        "J",
        "A/m^2",
        "A/m^2",
        None,
        "Charge-current density. V01 does not include STT or SOT.",
        "NOT_IMPLEMENTED",
    ),
    ReferenceParameter(
        "Fixed-layer direction",
        "p",
        "dimensionless",
        "dimensionless",
        (0.0, 0.0, 1.0),
        "Reference direction used for later P/AP classification; no fixed-layer dynamics in V01.",
        "RECORDED_NOT_SIMULATED",
    ),
    ReferenceParameter(
        "Simulation duration",
        "t_max",
        "s",
        "s",
        None,
        "V01 uses MuMax3 relaxation convergence rather than a fabricated physical duration.",
        "NOT_IMPLEMENTED",
    ),
    ReferenceParameter(
        "Output timestep",
        "dt_out",
        "s",
        "s",
        None,
        "Not applicable to the initial/final V01 equilibrium snapshots.",
        "NOT_IMPLEMENTED",
    ),
    ReferenceParameter(
        "Mesh cell size x",
        "dx",
        "m",
        "m",
        1.25e-9,
        "Free-layer discretization along x.",
        "DIRECT_MUMAX3",
    ),
    ReferenceParameter(
        "Mesh cell size y",
        "dy",
        "m",
        "m",
        1.25e-9,
        "Free-layer discretization along y.",
        "DIRECT_MUMAX3",
    ),
    ReferenceParameter(
        "Mesh cell size z",
        "dz",
        "m",
        "m",
        0.6e-9,
        "Free-layer discretization through thickness.",
        "DIRECT_MUMAX3",
    ),
)


def reference_parameter_manifest() -> dict:
    return {
        "referenceId": REFERENCE_PMTJ_ID,
        "scientificStatus": "UNVALIDATED",
        "parameters": [parameter.as_dict() for parameter in REFERENCE_PMTJ_PARAMETERS],
        "notes": [
            "All numeric defaults are UNVALIDATED_DEFAULT until citations are recorded.",
            "MuMax3 models only the free magnetic layer in V01.",
            "MgO tunneling, fixed-layer dynamics, STT/SOT, thermal noise, TMR, and retention are absent.",
        ],
    }
