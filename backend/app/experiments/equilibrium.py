"""V01: deterministic zero-temperature pMTJ free-layer equilibrium."""

from __future__ import annotations

from dataclasses import dataclass

from app.models.provenance import Provenance
from app.models.simulation import SimulationRequest
from app.physics.reference_pmtj import REFERENCE_PMTJ_PARAMETERS


@dataclass(frozen=True)
class ExperimentDefinition:
    experiment_id: str
    model_kind: str
    solver: str
    required_parameters: tuple[str, ...]
    expected_raw_outputs: tuple[str, ...]
    derived_metrics: tuple[str, ...]
    validation_checks: tuple[str, ...]
    plot_series: tuple[str, ...]
    scientific_status: str


V01_EQUILIBRIUM = ExperimentDefinition(
    experiment_id="V01_equilibrium",
    model_kind="reference_pmtj_v01_equilibrium",
    solver="MuMax3",
    required_parameters=(
        "geometry.freeLayerLength",
        "geometry.freeLayerWidth",
        "geometry.freeLayerThickness",
        "solverDrafts.mumax3.gridSize",
        "solverDrafts.mumax3.meshCellSize",
        "solverDrafts.mumax3.saturationMagnetization",
        "solverDrafts.mumax3.exchangeStiffness",
        "solverDrafts.mumax3.dampingAlpha",
        "solverDrafts.mumax3.anisotropyConstant",
        "solverDrafts.mumax3.anisotropyAxis",
        "initialMagnetization.vector",
        "externalField",
    ),
    expected_raw_outputs=(
        "generated.mx3",
        "stdout.log",
        "stderr.log",
        "outputs/table.txt",
        "outputs/initial*.ovf",
        "outputs/equilibrium*.ovf",
    ),
    derived_metrics=(
        "final mean mx, my, mz from raw table",
        "final spatial mean mx, my, mz from equilibrium OVF",
        "magnetization norm sanity from equilibrium OVF",
    ),
    validation_checks=(
        "MuMax3 executable and version recorded",
        "temperature equals 0 K",
        "geometry fits mesh world",
        "nz*dz represents magnetic thickness",
        "exchange-length mesh precheck",
        "final OVF field parses without invented vectors",
        "raw-table final mean agrees with final OVF spatial mean within declared tolerance",
    ),
    plot_series=("mx(t)", "my(t)", "mz(t)", "energy columns when emitted"),
    scientific_status="UNVALIDATED",
)


def _value(name: str):
    return next(
        parameter.default_value
        for parameter in REFERENCE_PMTJ_PARAMETERS
        if parameter.name == name
    )


def build_reference_v01_request() -> SimulationRequest:
    """Build the canonical unvalidated V01 request from one parameter registry."""
    diameter = float(_value("Free-layer diameter"))
    thickness = float(_value("Free-layer thickness"))
    barrier = float(_value("MgO barrier thickness"))
    reference = float(_value("Reference-layer thickness"))
    dx = float(_value("Mesh cell size x"))
    dy = float(_value("Mesh cell size y"))
    dz = float(_value("Mesh cell size z"))
    ms = float(_value("Saturation magnetization"))
    aex = float(_value("Exchange stiffness"))
    ku = float(_value("Uniaxial anisotropy"))
    alpha = float(_value("Gilbert damping"))
    external = _value("External magnetic field")
    assert isinstance(external, tuple)
    source = "unvalidated_default"

    return SimulationRequest.model_validate(
        {
            "scenarioId": "reference-pmtj-v01",
            "title": "Reference pMTJ V01 equilibrium",
            "requestedSolver": "mumax3",
            "geometry": {
                "freeLayerThickness": {"value": thickness, "unit": "m", "source": source},
                "freeLayerLength": {"value": diameter, "unit": "m", "source": source},
                "freeLayerWidth": {"value": diameter, "unit": "m", "source": source},
                "barrierThickness": {"value": barrier, "unit": "m", "source": source},
                "referenceLayerThickness": {
                    "value": reference,
                    "unit": "m",
                    "source": source,
                },
                "cellShape": "ellipse",
            },
            "materials": {
                "freeLayerId": "cofeb-unvalidated",
                "referenceLayerId": "cofeb-unvalidated",
                "barrierId": "mgo-unvalidated",
            },
            "controls": {
                "mode": "static",
                "recordTimeline": True,
                "pauseOnWarning": True,
                # Common schema field only; relax() is not assigned physical time.
                "duration": {"value": 1.0e-9, "unit": "s", "source": source},
                "temperature": {"value": 0.0, "unit": "K", "source": source},
                "currentDirection": "positive_z",
                "selectedRegion": "free",
                "viewportZoom": 1.0,
            },
            "torque": {
                "mechanism": "none",
                "enabled": False,
                "notes": "V01 equilibrium has no STT/SOT.",
            },
            "initialMagnetization": {
                "mode": "uniform",
                "vector": {"x": 0.1, "y": 0.0, "z": 0.9949874371},
                "notes": "Explicit non-collinear initial state for relaxation.",
            },
            "externalField": {
                axis: {"value": value, "unit": "T", "source": source}
                for axis, value in zip(("x", "y", "z"), external)
            },
            "solverDrafts": {
                "mumax3": {
                    "modelKind": "reference_pmtj_v01_equilibrium",
                    "meshCellSize": {
                        "x": {"value": dx, "unit": "m", "source": source},
                        "y": {"value": dy, "unit": "m", "source": source},
                        "z": {"value": dz, "unit": "m", "source": source},
                    },
                    "gridSize": {
                        "nx": round(diameter / dx),
                        "ny": round(diameter / dy),
                        "nz": round(thickness / dz),
                    },
                    "saturationMagnetization": {
                        "value": ms,
                        "unit": "A/m",
                        "source": source,
                    },
                    "exchangeStiffness": {
                        "value": aex,
                        "unit": "J/m",
                        "source": source,
                    },
                    "dampingAlpha": {
                        "value": alpha,
                        "unit": "dimensionless",
                        "source": source,
                    },
                    "anisotropyAxis": {"x": 0.0, "y": 0.0, "z": 1.0},
                    "anisotropyConstant": {
                        "value": ku,
                        "unit": "J/m^3",
                        "source": source,
                    },
                },
                "kwant": {"latticeModel": "placeholder_1d"},
                "surrogate": {"connectionStatus": "not_connected"},
            },
            "provenance": Provenance(
                created_by="system",
                solver="mumax3",
                notes=[
                    "V01 reference request generated from reference_pmtj.py.",
                    "All numeric defaults are UNVALIDATED_DEFAULT.",
                ],
            ).model_dump(by_alias=True, mode="json"),
        }
    )
