"""Simulation request / result schemas mirrored from the Twin frontend shell."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from .provenance import CamelModel, Provenance

SolverTarget = Literal["demo", "python_llg", "mumax3", "kwant", "surrogate"]
MumaxModelKind = Literal[
    "smoke",
    "reference_pmtj_v01_equilibrium",
    "spinvault_mtj_free_layer_v0",
    "spinvault_mtj_free_layer_v0_visible",
    "spinvault_mtj_free_layer_switching_v1",
]
MumaxStatePreset = Literal[
    "state_0_ap",
    "state_1_p",
    "transition_0_to_1",
    "transition_1_to_0",
]
CellShape = Literal["ellipse", "rectangle", "nanowire", "custom"]
SimulationMode = Literal["static", "time_domain", "sweep"]
DeviceRegion = Literal["free", "barrier", "reference", "none"]
CurrentDirection = Literal["positive_z", "negative_z"]
QuantitySource = Literal["user", "preset", "unvalidated_default", "computed", "unknown"]

LENGTH_UNITS = {"m", "nm", "um"}
TIME_UNITS = {"s", "ns", "ps"}
TEMPERATURE_UNITS = {"K"}
DIMENSIONLESS_UNITS = {"dimensionless"}
MAGNETIZATION_UNITS = {"A/m"}
FIELD_UNITS = {"T"}
EXCHANGE_UNITS = {"J/m"}
ANISOTROPY_UNITS = {"J/m^3"}
CURRENT_DENSITY_UNITS = {"A/m^2"}
ENERGY_UNITS = {"eV"}
KNOWN_UNITS = (
    LENGTH_UNITS
    | TIME_UNITS
    | TEMPERATURE_UNITS
    | DIMENSIONLESS_UNITS
    | MAGNETIZATION_UNITS
    | FIELD_UNITS
    | EXCHANGE_UNITS
    | ANISOTROPY_UNITS
    | CURRENT_DENSITY_UNITS
    | ENERGY_UNITS
)


class Quantity(CamelModel):
    value: float
    unit: str
    source: QuantitySource = "unknown"
    citation: str | None = None

    @field_validator("value")
    @classmethod
    def finite_value(cls, value: float) -> float:
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("Quantity value must be a finite number.")
        return value

    @field_validator("unit")
    @classmethod
    def known_unit(cls, unit: str) -> str:
        if unit not in KNOWN_UNITS:
            raise ValueError(f"Unsupported unit '{unit}'.")
        return unit


class Vector3(CamelModel):
    x: float
    y: float
    z: float


class Vector3Quantity(CamelModel):
    x: Quantity
    y: Quantity
    z: Quantity


class DeviceGeometry(CamelModel):
    free_layer_thickness: Quantity = Field(alias="freeLayerThickness")
    free_layer_length: Quantity = Field(alias="freeLayerLength")
    free_layer_width: Quantity = Field(alias="freeLayerWidth")
    barrier_thickness: Quantity = Field(alias="barrierThickness")
    reference_layer_thickness: Quantity = Field(alias="referenceLayerThickness")
    cell_shape: CellShape = Field(alias="cellShape")


class MaterialSelection(CamelModel):
    free_layer_id: str = Field(alias="freeLayerId")
    reference_layer_id: str = Field(alias="referenceLayerId")
    barrier_id: str = Field(alias="barrierId")


class TorqueConfiguration(CamelModel):
    mechanism: Literal["none", "stt", "sot", "combined"] = "none"
    enabled: bool = False
    current_density: Quantity | None = Field(default=None, alias="currentDensity")
    polarization: Quantity | None = None
    notes: str | None = None


class InitialMagnetization(CamelModel):
    mode: Literal["uniform", "random", "region_based", "import_pending"] = "uniform"
    vector: Vector3 | None = None
    seed: int | None = None
    notes: str | None = None


class MumaxMeshCellSize(CamelModel):
    x: Quantity
    y: Quantity
    z: Quantity


class MumaxGridSize(CamelModel):
    nx: int
    ny: int
    nz: int


class MumaxParameterDraft(CamelModel):
    model_kind: MumaxModelKind = Field(default="smoke", alias="modelKind")
    mesh_cell_size: MumaxMeshCellSize = Field(alias="meshCellSize")
    grid_size: MumaxGridSize | None = Field(default=None, alias="gridSize")
    saturation_magnetization: Quantity | None = Field(
        default=None, alias="saturationMagnetization"
    )
    exchange_stiffness: Quantity | None = Field(default=None, alias="exchangeStiffness")
    damping_alpha: Quantity | None = Field(default=None, alias="dampingAlpha")
    anisotropy_axis: Vector3 | None = Field(default=None, alias="anisotropyAxis")
    anisotropy_constant: Quantity | None = Field(default=None, alias="anisotropyConstant")
    pinned_direction: Vector3 = Field(
        default_factory=lambda: Vector3(x=0, y=0, z=1),
        alias="pinnedDirection",
    )
    state_preset: MumaxStatePreset = Field(default="state_0_ap", alias="statePreset")
    field_pulse_amplitude: Quantity | None = Field(
        default=None, alias="fieldPulseAmplitude"
    )
    field_pulse_duration: Quantity | None = Field(
        default=None, alias="fieldPulseDuration"
    )
    switching_threshold: float = Field(
        default=0.8, alias="switchingThreshold", gt=0, le=1
    )
    external_field: Vector3Quantity | None = Field(default=None, alias="externalField")
    current_density: Quantity | None = Field(default=None, alias="currentDensity")
    simulation_time: Quantity | None = Field(default=None, alias="simulationTime")
    time_step_hint: Quantity | None = Field(default=None, alias="timeStepHint")


class KwantParameterDraft(CamelModel):
    lattice_model: Literal["placeholder_1d", "placeholder_2d", "custom_pending"] = Field(
        alias="latticeModel"
    )
    hopping_energy: Quantity | None = Field(default=None, alias="hoppingEnergy")
    onsite_energy: Quantity | None = Field(default=None, alias="onsiteEnergy")
    spin_orbit_coupling: Quantity | None = Field(default=None, alias="spinOrbitCoupling")
    lead_configuration: Literal["two_terminal", "multi_terminal_pending"] | None = Field(
        default=None, alias="leadConfiguration"
    )
    temperature: Quantity | None = None


class SurrogateRequestMetadata(CamelModel):
    connection_status: Literal["not_connected"] = Field(
        default="not_connected", alias="connectionStatus"
    )
    model_id: str | None = Field(default=None, alias="modelId")
    model_version: str | None = Field(default=None, alias="modelVersion")
    notes: str | None = None


class SolverDrafts(CamelModel):
    mumax3: MumaxParameterDraft
    kwant: KwantParameterDraft
    surrogate: SurrogateRequestMetadata


class SimulationControls(CamelModel):
    mode: SimulationMode
    record_timeline: bool = Field(alias="recordTimeline")
    pause_on_warning: bool = Field(alias="pauseOnWarning")
    duration: Quantity
    temperature: Quantity
    current_direction: CurrentDirection = Field(alias="currentDirection")
    selected_region: DeviceRegion = Field(alias="selectedRegion")
    viewport_zoom: float = Field(alias="viewportZoom")


class SimulationRequest(CamelModel):
    """Accepted simulation submission payload."""

    scenario_id: str = Field(alias="scenarioId", min_length=1)
    title: str = Field(min_length=1)
    requested_solver: SolverTarget = Field(alias="requestedSolver")
    geometry: DeviceGeometry
    materials: MaterialSelection
    controls: SimulationControls
    torque: TorqueConfiguration | None = None
    initial_magnetization: InitialMagnetization | None = Field(
        default=None, alias="initialMagnetization"
    )
    external_field: Vector3Quantity | None = Field(default=None, alias="externalField")
    solver_drafts: SolverDrafts | None = Field(default=None, alias="solverDrafts")
    provenance: Provenance | None = None


class ResultSeriesPoint(CamelModel):
    x: float
    y: float


class ResultSeries(CamelModel):
    id: str
    label: str
    x_label: str = Field(alias="xLabel")
    x_unit: str = Field(alias="xUnit")
    y_label: str = Field(alias="yLabel")
    y_unit: str = Field(alias="yUnit")
    points: list[ResultSeriesPoint]


class ResultMetric(CamelModel):
    id: str
    label: str
    display_value: str = Field(alias="displayValue")
    unit: str
    note: str


class SimulationArtifacts(CamelModel):
    script_preview: str | None = Field(default=None, alias="scriptPreview")
    stdout: str | None = None
    stderr: str | None = None
    manifest: dict | None = None
    frames: list[dict] = Field(default_factory=list)


class SimulationResult(CamelModel):
    source: Literal["demo_fixture", "mumax3", "python_llg_twin"] = "demo_fixture"
    is_physical_simulation: bool = Field(default=False, alias="isPhysicalSimulation")
    summary: str
    series: list[ResultSeries] = Field(default_factory=list)
    metrics: list[ResultMetric] = Field(default_factory=list)
    provenance: Provenance
    artifacts: SimulationArtifacts | None = None
