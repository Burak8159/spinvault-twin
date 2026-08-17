/**
 * Shared SpinVault Twin frontend types.
 * Prompt #1B should extend these in place.
 *
 * None of these types imply that MuMax3, Kwant, or a surrogate model is connected.
 */

export type SolverTarget = "demo" | "python_llg" | "mumax3" | "kwant" | "surrogate";

export type SimulationStatus =
  | "idle"
  | "validating"
  | "queued"
  | "preparing"
  | "checking_environment"
  | "generating_solver_input"
  | "running_solver"
  | "parsing_outputs"
  | "running"
  | "complete"
  | "failed"
  | "cancelled"
  | "not_configured";

export type JobStatus =
  | "queued"
  | "validating"
  | "preparing"
  | "checking_environment"
  | "generating_solver_input"
  | "running_solver"
  | "parsing_outputs"
  | "running"
  | "complete"
  | "failed"
  | "cancelled"
  | "not_configured";

export type AccelerationLabel =
  | "not_configured"
  | "host_gpu_available"
  | "gpu_detected"
  | "cuda"
  | "rtx"
  | "unknown";

export interface GpuInfo {
  gpuAvailable: boolean;
  acceleration: AccelerationLabel;
  details: string;
  devices?: string[];
  driverVersion?: string | null;
  cudaVersion?: string | null;
}

export type ValidationSeverity = "info" | "warning" | "error";

export type CellShape = "ellipse" | "rectangle" | "nanowire" | "custom";

export type SimulationMode = "static" | "time_domain" | "sweep";

export type DeviceRegion = "free" | "barrier" | "reference" | "none";

export type CurrentDirection = "positive_z" | "negative_z";

export type LengthUnit = "m" | "nm" | "um";
export type TimeUnit = "s" | "ns" | "ps";
export type TemperatureUnit = "K";
export type DimensionlessUnit = "dimensionless";
export type MagneticUnit = "A/m" | "T" | "J/m" | "J/m^3" | "A/m^2";
export type EnergyUnit = "eV";

export type Unit =
  | LengthUnit
  | TimeUnit
  | TemperatureUnit
  | DimensionlessUnit
  | MagneticUnit
  | EnergyUnit;

export type UnitCategory =
  | "length"
  | "time"
  | "temperature"
  | "dimensionless"
  | "magnetization"
  | "field"
  | "exchange"
  | "anisotropy"
  | "currentDensity"
  | "energy";

export interface Quantity {
  value: number;
  unit: Unit;
  source?: "user" | "preset" | "unvalidated_default" | "computed" | "unknown";
  citation?: string;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Vector3Quantity {
  x: Quantity;
  y: Quantity;
  z: Quantity;
}

export interface DeviceGeometry {
  freeLayerThickness: Quantity;
  freeLayerLength: Quantity;
  freeLayerWidth: Quantity;
  barrierThickness: Quantity;
  referenceLayerThickness: Quantity;
  cellShape: CellShape;
}

export interface MaterialSelection {
  freeLayerId: string;
  referenceLayerId: string;
  barrierId: string;
}

export interface MagneticMaterial {
  id: string;
  label: string;
  saturationMagnetization?: Quantity;
  exchangeStiffness?: Quantity;
  dampingAlpha?: Quantity;
  anisotropyConstant?: Quantity;
  polarization?: Quantity;
  notes?: string;
  presetStatus: "example_only" | "literature_review_needed" | "verified_by_user";
  provenance: Provenance;
}

export interface BarrierMaterial {
  id: string;
  label: string;
  notes?: string;
  presetStatus: "example_only" | "literature_review_needed" | "verified_by_user";
  provenance: Provenance;
}

export type MaterialPreset =
  | (MagneticMaterial & { layerRole: "magnetic" })
  | (BarrierMaterial & { layerRole: "barrier" });

export interface TorqueConfiguration {
  mechanism: "none" | "stt" | "sot" | "combined";
  enabled: boolean;
  currentDensity?: Quantity;
  polarization?: Quantity;
  notes?: string;
}

export interface InitialMagnetization {
  mode: "uniform" | "random" | "region_based" | "import_pending";
  vector?: Vector3;
  seed?: number;
  notes?: string;
}

// Request-shaping types only. They do not prove that MuMax3 execution is available.
export type MumaxModelKind =
  | "smoke"
  | "reference_pmtj_v01_equilibrium"
  | "spinvault_mtj_free_layer_v0"
  | "spinvault_mtj_free_layer_v0_visible"
  | "spinvault_mtj_free_layer_switching_v1";
export type MumaxStatePreset =
  | "state_0_ap"
  | "state_1_p"
  | "transition_0_to_1"
  | "transition_1_to_0";

export interface MumaxParameterDraft {
  modelKind?: MumaxModelKind;
  meshCellSize: {
    x: Quantity;
    y: Quantity;
    z: Quantity;
  };
  gridSize?: {
    nx: number;
    ny: number;
    nz: number;
  };
  saturationMagnetization?: Quantity;
  exchangeStiffness?: Quantity;
  dampingAlpha?: Quantity;
  anisotropyAxis?: Vector3;
  anisotropyConstant?: Quantity;
  pinnedDirection?: Vector3;
  statePreset?: MumaxStatePreset;
  fieldPulseAmplitude?: Quantity;
  fieldPulseDuration?: Quantity;
  switchingThreshold?: number;
  externalField?: Vector3Quantity;
  currentDensity?: Quantity;
  simulationTime?: Quantity;
  timeStepHint?: Quantity;
}

// Transport-request draft only. Kwant is not connected.
export interface KwantParameterDraft {
  latticeModel: "placeholder_1d" | "placeholder_2d" | "custom_pending";
  hoppingEnergy?: Quantity;
  onsiteEnergy?: Quantity;
  spinOrbitCoupling?: Quantity;
  leadConfiguration?: "two_terminal" | "multi_terminal_pending";
  temperature?: Quantity;
}

export interface SurrogateRequestMetadata {
  connectionStatus: "not_connected";
  modelId?: string;
  modelVersion?: string;
  notes?: string;
}

export interface SolverDrafts {
  mumax3: MumaxParameterDraft;
  kwant: KwantParameterDraft;
  surrogate: SurrogateRequestMetadata;
}

export interface SimulationControls {
  mode: SimulationMode;
  recordTimeline: boolean;
  pauseOnWarning: boolean;
  duration: Quantity;
  temperature: Quantity;
  currentDirection: CurrentDirection;
  selectedRegion: DeviceRegion;
  viewportZoom: number;
}

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  field: string;
  message: string;
}

export interface SimulatorState {
  scenarioId: string;
  title: string;
  solverTarget: SolverTarget;
  geometry: DeviceGeometry;
  materials: MaterialSelection;
  torque: TorqueConfiguration;
  initialMagnetization: InitialMagnetization;
  externalField: Vector3Quantity;
  solverDrafts: SolverDrafts;
  controls: SimulationControls;
  provenance: Provenance;
  validation: ValidationIssue[];
}

export interface ScenarioPreset {
  id: string;
  label: string;
  description: string;
  state: Omit<SimulatorState, "validation">;
  provenance: Provenance;
}

export interface Provenance {
  createdAt: string;
  createdBy: "user" | "system" | "demo_fixture";
  solver: "none" | "demo" | "python_llg" | "mumax3" | "kwant" | "surrogate";
  solverVersion?: string;
  inputHash?: string;
  notes?: string[];
}

export interface ResultSeriesPoint {
  x: number;
  y: number;
}

export interface ResultSeries {
  id: string;
  label: string;
  xLabel: string;
  xUnit: Unit;
  yLabel: string;
  yUnit: Unit;
  points: ResultSeriesPoint[];
}

export interface SimulationResult {
  source: "demo_fixture" | string;
  isPhysicalSimulation: boolean;
  executionGpu?: GpuInfo | null;
  summary: string;
  series: ResultSeries[];
  metrics: Array<{
    id: string;
    label: string;
    displayValue: string;
    unit: Unit | string;
    note: string;
  }>;
  provenance: Provenance;
  artifacts?: SimulationArtifacts;
}

export interface SimulationArtifacts {
  scriptPreview?: string;
  stdout?: string;
  stderr?: string;
  manifest?: unknown;
  frames?: Array<{
    id: string;
    path: string;
    label: string;
    index: number;
    bytes: number;
    format: "ovf" | string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface OvfFrameVector {
  index: number;
  x: number;
  y: number;
  z: number;
  mx: number;
  my: number;
  mz: number;
  magnitude: number;
  xMeters?: number;
  yMeters?: number;
  zMeters?: number;
  sourceCount?: number;
}

export interface OvfFrameData {
  id?: string;
  path: string;
  label: string;
  index: number;
  bytes: number;
  format: "ovf" | string;
  metadata: Record<string, unknown>;
  vectors: OvfFrameVector[];
  warnings: string[];
}

export interface OvfFrameResponse {
  jobId: string;
  frame: OvfFrameData;
  note: string;
}

export interface ArtifactItem {
  id: string;
  kind: "script" | "log" | "manifest" | "json" | "frame";
  label: string;
  content: string;
  downloadName?: string;
}

export interface ArtifactView {
  available: boolean;
  message: string;
  guidance?: string;
  items: ArtifactItem[];
}

/** Backend POST /api/simulations body (camelCase). */
export interface BackendSimulationRequest {
  scenarioId: string;
  title: string;
  requestedSolver: SolverTarget;
  geometry: DeviceGeometry;
  materials: MaterialSelection;
  controls: SimulationControls;
  torque?: TorqueConfiguration;
  initialMagnetization?: InitialMagnetization;
  externalField?: Vector3Quantity;
  solverDrafts?: SolverDrafts;
  provenance?: Provenance;
}

export interface JobIssue {
  code: string;
  message: string;
  field?: string | null;
}

export interface JobRecord {
  jobId: string;
  scenarioId: string;
  title: string;
  requestedSolver: SolverTarget;
  status: JobStatus;
  progressPhase?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  workerId?: string | null;
  gpu?: GpuInfo | null;
  errors: JobIssue[];
  warnings: JobIssue[];
  provenance: Provenance;
  request?: BackendSimulationRequest | null;
  result?: SimulationResult | null;
}

export interface JobResultResponse {
  jobId: string;
  status: JobStatus;
  result?: SimulationResult | null;
  errors: JobIssue[];
  provenance: Provenance;
}

export interface SimulationRequest {
  scenario: SimulatorState;
  requestedSolver: SolverTarget;
}

export interface SimulationError {
  code:
    | "solver_not_connected"
    | "solver_not_configured"
    | "validation_failed"
    | "cancelled"
    | "demo_job_failed"
    | "backend_unreachable"
    | "job_not_found"
    | "result_not_ready"
    | "timeout"
    | "parse_failure"
    | "cancel_failure";
  message: string;
}

export interface SimulationResponse {
  jobId: string;
  status: SimulationStatus | JobStatus;
  result?: SimulationResult;
  error?: SimulationError;
  provenance: Provenance;
  job?: JobRecord;
  warnings?: JobIssue[];
}

export interface LogEntry {
  id: string;
  at: string;
  level: "info" | "warning" | "error";
  message: string;
}

export interface TimelineEvent {
  id: string;
  status: SimulationStatus;
  at: string;
  label: string;
  connected: boolean;
}

export interface WorkspaceSnapshot {
  state: SimulatorState;
  status: SimulationStatus;
  result: SimulationResult | null;
  error: SimulationError | null;
  logs: LogEntry[];
  timeline: TimelineEvent[];
  jobId: string | null;
  paused: boolean;
  lastJob?: JobRecord | null;
}
