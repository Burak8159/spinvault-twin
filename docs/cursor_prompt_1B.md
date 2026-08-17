# Cursor Prompt #1B: Scientific Data Model & Parameter System

You are extending the SpinVault Twin frontend shell with a scientifically careful parameter model. This prompt defines data structures, units, validation boundaries, tooltips, and provenance metadata. It does **not** implement MuMax3, Kwant, real solver execution, or AI inference.

## Objective

Replace generic simulator fields with a structured spintronics parameter system that can later be serialized to backend solver requests. The model must separate:

- Device geometry
- Magnetic material parameters
- Spin-transfer/spin-orbit torque configuration
- Initial magnetization conditions
- External fields
- Solver-specific request metadata
- Result provenance

## Scientific Integrity Rules

- Do not invent material constants as authoritative values.
- If default values are included, mark them as presets requiring review.
- Equations may appear in documentation/tooltips, but do not turn them into fake simulation logic.
- Keep MuMax3 and Kwant parameter sets separate.
- Keep future AI/surrogate metadata separate from direct numerical solver settings.
- Every result-like object must include provenance.

## Core Types

Create or refine shared types in the simulator library.

```ts
type Unit =
  | "m"
  | "nm"
  | "A/m"
  | "T"
  | "J/m"
  | "J/m^3"
  | "A/m^2"
  | "s"
  | "K"
  | "dimensionless";

interface Quantity {
  value: number;
  unit: Unit;
  source?: "user" | "preset" | "computed" | "unknown";
  citation?: string;
}

interface DeviceGeometry {
  freeLayerThickness: Quantity;
  freeLayerLength: Quantity;
  freeLayerWidth: Quantity;
  barrierThickness?: Quantity;
  referenceLayerThickness?: Quantity;
  cellShape: "ellipse" | "rectangle" | "nanowire" | "custom";
}

interface MagneticMaterial {
  id: string;
  label: string;
  saturationMagnetization?: Quantity;
  exchangeStiffness?: Quantity;
  dampingAlpha?: Quantity;
  anisotropyConstant?: Quantity;
  polarization?: Quantity;
  notes?: string;
  presetStatus: "example_only" | "literature_review_needed" | "verified_by_user";
}
```

Adapt this to the existing code style.

## MuMax3-Oriented Parameters

Model frontend fields that can eventually map to MuMax3 scripts, but do not generate executable scripts yet.

```ts
interface MumaxParameterDraft {
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
  externalField?: Vector3Quantity;
  currentDensity?: Quantity;
  simulationTime?: Quantity;
  timeStepHint?: Quantity;
}
```

The UI should describe these as **draft inputs for a future MuMax3 backend**, not as active simulation commands.

## Kwant-Oriented Parameters

Kwant should be represented as a separate future transport module.

```ts
interface KwantParameterDraft {
  latticeModel: "placeholder_1d" | "placeholder_2d" | "custom_pending";
  hoppingEnergy?: Quantity;
  onsiteEnergy?: Quantity;
  spinOrbitCoupling?: Quantity;
  leadConfiguration?: "two_terminal" | "multi_terminal_pending";
  temperature?: Quantity;
}
```

Do not blend Kwant transport fields with MuMax3 micromagnetic fields.

## Initial Conditions

Represent initial magnetization explicitly.

```ts
interface InitialMagnetization {
  mode: "uniform" | "random" | "region_based" | "import_pending";
  vector?: Vector3;
  seed?: number;
  notes?: string;
}
```

## Validation

Expand validation in a transparent way. Use levels:

```ts
type ValidationSeverity = "info" | "warning" | "error";
```

Validation should include:

- Positive dimensions
- Required units
- Mesh cell size smaller than relevant geometry dimensions
- Damping alpha within a basic numeric range if provided
- Vector normalization warnings
- Missing provenance warnings for preset material values

Do not reject scientifically unusual values unless the issue is a basic data integrity problem. Use warnings for review-needed values.

## Tooltips and Help Text

Every scientific field should have short contextual help:

- What the parameter represents
- Expected unit
- Whether it is currently used by the demo shell
- Whether it is intended for MuMax3, Kwant, or both

Example:

```text
Exchange stiffness: Micromagnetic material parameter intended for MuMax3 request generation. This frontend does not solve the Landau-Lifshitz-Gilbert equation.
```

## Provenance

Add provenance metadata to presets and results.

```ts
interface Provenance {
  createdAt: string;
  createdBy: "user" | "system" | "demo_fixture";
  solver: "none" | "demo" | "mumax3" | "kwant" | "surrogate";
  solverVersion?: string;
  inputHash?: string;
  notes?: string[];
}
```

## UI Updates

Add sections or tabs for:

- Geometry
- Materials
- Excitation/current
- Initial conditions
- Solver draft
- Provenance

Keep the layout compact. Do not bury essential fields in long explanatory cards.

## Documentation Comments

Add brief code comments only where they prevent scientific misuse, for example:

```ts
// This is a request-shaping type only. It is not proof that MuMax3 execution is available.
```

## Implementation Checklist

- [ ] Add typed Quantity and Unit model.
- [ ] Add geometry, material, initial condition, MuMax draft, and Kwant draft types.
- [ ] Add scientific field metadata and tooltips.
- [ ] Add provenance to presets and mock results.
- [ ] Extend validation without pretending to enforce full physics.
- [ ] Update UI sections to expose the new parameter structure.
- [ ] Keep solver-specific parameters separated.
- [ ] Run lint, typecheck, and build.

## Acceptance Criteria

- Parameters are typed, unit-aware, and solver-aware.
- The UI makes clear which fields are active demo inputs and which are future solver inputs.
- MuMax3 and Kwant concepts are not mixed into one ambiguous form.
- Presets and outputs carry provenance.
- No fake scientific validity is introduced.

