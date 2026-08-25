"""Fixture Team Contract v0 drafts consumed by DEVELOPER_2_GOOD_NEGF_TRANSPORT_ENSEMBLES.

Schema/code ownership remains DEVELOPER_1_VERY_GOOD_PLATFORM_AWS_INTEGRATION.
TransportResult scientific semantics are owned by DEVELOPER_2_GOOD_NEGF_TRANSPORT_ENSEMBLES.
Breaking changes require both. These types are namespaced test/compat objects,
not a competing production schema. Do not treat this as Team Contract v1.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from .quantities import (
    CurrentSpinPolarization,
    InjectedSpinFraction,
    StoredSpinPopulation,
    UnresolvedCouplingError,
)
from .taxonomy import ArtifactRole, ParameterOrigin, ParameterStatus, SourceKind


@dataclass(frozen=True)
class AppliedBias:
    """Electrical potential difference on the common transport API. Unit is always V.

    TranSIESTA serialization uses ΔE = q_e ΔV and writes energy-valued TS.Voltage
    in eV in engine-facing FDF only. CalculationSpec must not store TS.Voltage.
    """

    value: float
    unit: str = "V"

    def __post_init__(self) -> None:
        if self.unit != "V":
            raise ValueError(
                f"AppliedBias.unit must be 'V' on CalculationSpec; got {self.unit!r}. "
                "Convert engine energy units only inside the SIESTA adapter."
            )


ZERO_BIAS = AppliedBias(value=0.0, unit="V")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class StructureRecord:
    structure_id: str
    chemical_formula: str
    atoms: tuple[tuple[str, float, float, float], ...]
    lattice_angstrom: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]
    periodicity: tuple[int, int, int]
    material_identity: str
    structure_hash: str
    construction_metadata: dict[str, Any]
    artifact_role: ArtifactRole = ArtifactRole.TEST_FIXTURE


@dataclass(frozen=True)
class SpinRepresentation:
    representation_id: str
    collinear: bool
    noncollinear: bool
    soc: bool
    quantization_axis: Optional[tuple[float, float, float]]
    magnetization_direction: Optional[tuple[float, float, float]]
    solver_representation: str
    available_projections: tuple[str, ...]
    notes: str = ""


@dataclass(frozen=True)
class EnergyReference:
    reference_id: str
    energy_zero: str
    fermi_level: Optional[str]
    mu_left: Optional[str]
    mu_right: Optional[str]
    bias_convention: str
    unit: str = "eV"


@dataclass(frozen=True)
class TransportGeometryMetadata:
    transport_axis: str
    electrode_principal_layer_atoms: int
    left_electrode_atom_indices: tuple[int, ...]
    right_electrode_atom_indices: tuple[int, ...]
    scattering_atom_indices: tuple[int, ...]
    atom_ordering: str
    periodic_directions: tuple[str, ...]
    boundary_matching: str


@dataclass(frozen=True)
class SolverMethodRecord:
    xc: str
    pseudopotential_ids: tuple[str, ...]
    siesta_basis: Optional[str]
    dftu_formulation: Optional[str]
    soc: bool
    siesta_version: Optional[str]
    tbtrans_version: Optional[str]
    sisl_version: Optional[str]
    notes: str = ""


@dataclass(frozen=True)
class ObservableDefinition:
    """How a solver object was converted into a reported scientific quantity."""

    definition_id: str
    name: str
    quantity_type: str
    formula: str
    domain: str
    sign_convention: str
    units: str
    energy_reference_id: Optional[str]
    spin_representation_id: Optional[str]
    dependencies: tuple[str, ...]
    notes: str = ""


@dataclass(frozen=True)
class ArtifactFile:
    path: str
    kind: str
    sha256: Optional[str] = None
    producing_run_id: Optional[str] = None


@dataclass(frozen=True)
class ArtifactManifest:
    run_id: str
    files: tuple[ArtifactFile, ...]
    artifact_role: ArtifactRole = ArtifactRole.TEST_FIXTURE


@dataclass(frozen=True)
class ConvergenceRecord:
    quantity_tested: str
    parameter_varied: str
    values: tuple[Any, ...]
    observable: str
    tolerance: Optional[str]
    decision: ParameterStatus
    evidence: str = ""


@dataclass(frozen=True)
class CalculationDependency:
    parent_calculation_id: Optional[str]
    initialization_artifact: Optional[str]
    continuation_relation: str
    same_calculation_spec: bool


@dataclass(frozen=True)
class CalculationSpec:
    calculation_id: str
    campaign_id: str
    structure_id: str
    engine: str
    calculation_type: str
    applied_bias: AppliedBias
    physics: dict[str, Any]
    numerical: dict[str, Any]
    resources: dict[str, Any]
    origin: ParameterOrigin
    status: ParameterStatus
    artifact_role: ArtifactRole = ArtifactRole.TEST_FIXTURE


@dataclass(frozen=True)
class RunMetadata:
    run_id: str
    calculation_id: str
    campaign_id: str
    timestamp_utc: datetime
    git_commit: Optional[str]
    git_dirty: Optional[bool]
    engine: str
    engine_version: Optional[str]
    parent_run_id: Optional[str]
    restart_number: int
    exit_status: Optional[str]
    artifact_role: ArtifactRole = ArtifactRole.TEST_FIXTURE


@dataclass(frozen=True)
class RetentionCouplingSpec:
    """Unresolved T(E) → Γ → Q(t) → τ50 mapping. Not an implemented model."""

    spec_id: str
    status: ParameterStatus
    required_bridge: str = "T_sigma(E) -> Gamma_sigma -> Q(t) -> tau50"
    forbidden_shortcut: str = "tau = 1 / (nu0 * T_negf_at_fermi)"
    notes: str = (
        "NEGF transmission is not a retention escape rate. "
        "P_injected is not P_store. This spec is unset until jointly defined."
    )


@dataclass
class TransportResult:
    run_id: str
    energies_eV: tuple[float, ...]
    transmission: tuple[float, ...]
    transmission_matrix: Optional[tuple[tuple[float, ...], ...]]
    spin_representation: SpinRepresentation
    energy_reference: EnergyReference
    geometry: TransportGeometryMetadata
    solver_method: SolverMethodRecord
    provenance_origin: ParameterOrigin
    artifact_role: ArtifactRole
    data_source_kind: Optional[SourceKind] = None
    requested_origin: Optional[str] = None
    current_polarization: Optional[CurrentSpinPolarization] = None
    injected_fraction: Optional[InjectedSpinFraction] = None
    stored_population: Optional[StoredSpinPopulation] = None
    extra: dict[str, Any] = field(default_factory=dict)

    def stored_population_or_raise(self) -> StoredSpinPopulation:
        raise UnresolvedCouplingError(
            "TransportResult cannot emit StoredSpinPopulation. "
            "P_store requires an approved RetentionCouplingSpec."
        )

    def retention_time_from_fermi_transmission(self, nu0_per_s: float) -> float:
        raise UnresolvedCouplingError(
            "Forbidden: tau = 1/(nu0 * T_negf_at_fermi). "
            f"nu0={nu0_per_s} /s was ignored. Use RetentionCouplingSpec."
        )


UNRESOLVED_RETENTION_COUPLING = RetentionCouplingSpec(
    spec_id="retention_coupling_unset_v0",
    status=ParameterStatus.UNSET,
)


def new_run_from_interrupt(parent: RunMetadata, new_run_id: str) -> RunMetadata:
    """Same CalculationSpec, interrupted run → new RunMetadata."""
    return RunMetadata(
        run_id=new_run_id,
        calculation_id=parent.calculation_id,
        campaign_id=parent.campaign_id,
        timestamp_utc=_utc_now(),
        git_commit=parent.git_commit,
        git_dirty=parent.git_dirty,
        engine=parent.engine,
        engine_version=parent.engine_version,
        parent_run_id=parent.run_id,
        restart_number=parent.restart_number + 1,
        exit_status=None,
        artifact_role=parent.artifact_role,
    )


def bias_change_requires_new_spec(previous: CalculationSpec, new_bias: AppliedBias) -> CalculationSpec:
    """A new bias point is a new CalculationSpec, even if initialized from the parent."""
    if new_bias.unit != "V":
        raise ValueError("new bias must be AppliedBias in V")
    return CalculationSpec(
        calculation_id=f"{previous.calculation_id}::bias_{new_bias.value}V",
        campaign_id=previous.campaign_id,
        structure_id=previous.structure_id,
        engine=previous.engine,
        calculation_type=previous.calculation_type,
        applied_bias=new_bias,
        physics=dict(previous.physics),
        numerical=dict(previous.numerical),
        resources=dict(previous.resources),
        origin=previous.origin,
        status=previous.status,
        artifact_role=previous.artifact_role,
    )
