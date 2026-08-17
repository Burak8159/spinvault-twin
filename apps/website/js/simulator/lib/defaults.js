/**
 * Demo presets for the SpinVault Twin UI shell.
 * Values are example_only placeholders for layout and workflow testing.
 * They are not literature-verified material cards and are not used as physics inputs.
 */

/**
 * @param {import("./types").Quantity} quantity
 * @returns {import("./types").Quantity}
 */
function qty(quantity) {
  return {
    value: quantity.value,
    unit: quantity.unit,
    source: quantity.source ?? "preset",
    ...(quantity.citation ? { citation: quantity.citation } : {})
  };
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function normalizedNumber(value) {
  const numeric = typeof value === "string" ? Number(value.trim().replace(",", ".")) : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/**
 * @param {import("./types").Quantity} fallback
 * @param {unknown} candidate
 * @returns {import("./types").Quantity}
 */
function hydrateQuantity(fallback, candidate) {
  if (candidate == null || typeof candidate !== "object") return fallback;
  const value = normalizedNumber(/** @type {{ value?: unknown }} */ (candidate).value);
  const unit = /** @type {{ unit?: unknown }} */ (candidate).unit;
  return {
    ...fallback,
    ...candidate,
    value: value ?? fallback.value,
    unit: typeof unit === "string" ? /** @type {import("./types").Unit} */ (unit) : fallback.unit
  };
}

/**
 * @param {number} fallback
 * @param {unknown} candidate
 * @returns {number}
 */
function hydrateNumber(fallback, candidate) {
  return normalizedNumber(candidate) ?? fallback;
}

/**
 * @template {string} T
 * @param {T} fallback
 * @param {unknown} candidate
 * @param {readonly T[] | T[]} allowed
 * @returns {T}
 */
function hydrateEnum(fallback, candidate, allowed) {
  return typeof candidate === "string" && allowed.includes(/** @type {T} */ (candidate))
    ? /** @type {T} */ (candidate)
    : fallback;
}

/**
 * @param {string} fallback
 * @param {unknown} candidate
 * @returns {string}
 */
function hydrateText(fallback, candidate) {
  return typeof candidate === "string" && candidate.trim() ? candidate : fallback;
}

/**
 * Preset provenance intentionally records that values still require review.
 * @param {string} note
 * @returns {import("./types").Provenance}
 */
function presetProvenance(note) {
  return {
    createdAt: "2026-08-14T00:00:00.000Z",
    createdBy: "system",
    solver: "none",
    notes: [note, "Example values require literature review or user verification before solver request generation."]
  };
}

/** @type {import("./types").MaterialPreset[]} */
export const MATERIAL_PRESETS = [
  {
    id: "cofeb-example",
    label: "CoFeB (example)",
    layerRole: "magnetic",
    presetStatus: "literature_review_needed",
    saturationMagnetization: qty({ value: 1000000, unit: "A/m" }),
    exchangeStiffness: qty({ value: 1e-11, unit: "J/m" }),
    dampingAlpha: qty({ value: 0.01, unit: "dimensionless" }),
    anisotropyConstant: qty({ value: 500000, unit: "J/m^3" }),
    polarization: qty({ value: 0.6, unit: "dimensionless" }),
    notes: "Illustrative request-shaping values only; not authoritative constants.",
    provenance: presetProvenance("CoFeB example preset; no citation attached.")
  },
  {
    id: "nife-example",
    label: "NiFe (example)",
    layerRole: "magnetic",
    presetStatus: "literature_review_needed",
    saturationMagnetization: qty({ value: 800000, unit: "A/m" }),
    exchangeStiffness: qty({ value: 1.3e-11, unit: "J/m" }),
    dampingAlpha: qty({ value: 0.008, unit: "dimensionless" }),
    anisotropyConstant: qty({ value: 0, unit: "J/m^3" }),
    polarization: qty({ value: 0.4, unit: "dimensionless" }),
    notes: "Illustrative request-shaping values only; not authoritative constants.",
    provenance: presetProvenance("NiFe example preset; no citation attached.")
  },
  {
    id: "mgo-example",
    label: "MgO (example)",
    layerRole: "barrier",
    presetStatus: "example_only",
    notes: "Example barrier label only. No transport parameters are asserted.",
    provenance: presetProvenance("MgO label preset; no material constants included.")
  },
  {
    id: "al2o3-example",
    label: "Al2O3 (example)",
    layerRole: "barrier",
    presetStatus: "example_only",
    notes: "Example barrier label only. No transport parameters are asserted.",
    provenance: presetProvenance("Al2O3 label preset; no material constants included.")
  }
];

export const MUMAX_MODEL_KINDS = {
  reference_pmtj_v01_equilibrium: {
    label: "Reference pMTJ V01 · zero-temperature equilibrium",
    note: "MuMax3 free-layer relax() with initial/final OVF fields. All defaults are UNVALIDATED_DEFAULT; no transport, torque, thermal field, retention, or leakage."
  },
  smoke: {
    label: "MuMax3 smoke / basic",
    note: "Minimal numerical mesh run for connectivity checks. Not a SpinVault device model."
  },
  spinvault_mtj_free_layer_v0: {
    label: "SpinVault MTJ free-layer v0 · stable/basic",
    note: "First Twin free-layer model. Not calibrated or experimentally validated. No TMR/resistance inference."
  },
  spinvault_mtj_free_layer_v0_visible: {
    label: "SpinVault MTJ free-layer v0 · visible dynamics",
    note: "Tilted m0 + transverse/z field preset for visible raw MuMax3 playback. Not calibrated. Not experimentally validated. No TMR/resistance/switching-performance inference."
  },
  spinvault_mtj_free_layer_switching_v1: {
    label: "SpinVault MTJ free-layer switching v1 · field pulse",
    note: "One free layer with uniaxial anisotropy and an explicit field pulse. MuMax3 magnetization dynamics only; no MgO, TMR, resistance, or tunneling."
  }
};

/**
 * Apply the conservative visible-dynamics request preset while retaining geometry,
 * mesh, and material parameters chosen by the user.
 * @param {import("./types").SimulatorState} state
 * @returns {import("./types").SimulatorState}
 */
export function applyVisibleDynamicsPreset(state) {
  return {
    ...state,
    solverTarget: "python_llg",
    controls: {
      ...state.controls,
      mode: "time_domain",
      duration: qty({ value: 1, unit: "ns", source: "preset" })
    },
    initialMagnetization: {
      ...state.initialMagnetization,
      mode: "uniform",
      vector: { x: 0.1, y: 0, z: 0.995 },
      notes: "Visible raw MuMax3 playback preset; not calibrated."
    },
    externalField: {
      x: qty({ value: 0.01, unit: "T", source: "preset" }),
      y: qty({ value: 0, unit: "T", source: "preset" }),
      z: qty({ value: 0.01, unit: "T", source: "preset" })
    },
    solverDrafts: {
      ...state.solverDrafts,
      mumax3: {
        ...state.solverDrafts.mumax3,
        modelKind: "spinvault_mtj_free_layer_v0_visible",
        // 2,048 raw cells per OVF frame. Users may override this draft before submission.
        gridSize: { nx: 64, ny: 32, nz: 2 },
        meshCellSize: {
          ...state.solverDrafts.mumax3.meshCellSize,
          z: qty({ value: 0.6, unit: "nm", source: "preset" })
        },
        simulationTime: qty({ value: 1, unit: "ns", source: "preset" })
      }
    }
  };
}

/**
 * Apply an explicit AP→P field-pulse switching request. Values marked preset
 * are placeholders for review, not calibrated device parameters.
 * @param {import("./types").SimulatorState} state
 * @returns {import("./types").SimulatorState}
 */
export function applySwitchingV1Preset(state) {
  return {
    ...state,
    solverTarget: "python_llg",
    controls: {
      ...state.controls,
      mode: "time_domain",
      duration: qty({ value: 2, unit: "ns", source: "preset" })
    },
    torque: {
      ...state.torque,
      mechanism: "none",
      enabled: false,
      notes: "switching_v1 uses an explicit field pulse; no current torque is mapped."
    },
    externalField: {
      x: qty({ value: 0, unit: "T", source: "preset" }),
      y: qty({ value: 0, unit: "T", source: "preset" }),
      z: qty({ value: 0, unit: "T", source: "preset" })
    },
    solverDrafts: {
      ...state.solverDrafts,
      mumax3: {
        ...state.solverDrafts.mumax3,
        modelKind: "spinvault_mtj_free_layer_switching_v1",
        gridSize: { nx: 64, ny: 32, nz: 2 },
        meshCellSize: {
          x: qty({ value: 1.25, unit: "nm", source: "preset" }),
          y: qty({ value: 1.25, unit: "nm", source: "preset" }),
          z: qty({ value: 0.6, unit: "nm", source: "preset" })
        },
        anisotropyAxis: { x: 0, y: 0, z: 1 },
        anisotropyConstant: qty({ value: 800000, unit: "J/m^3", source: "preset" }),
        pinnedDirection: { x: 0, y: 0, z: 1 },
        statePreset: "transition_0_to_1",
        // Ku1=8e5 J/m^3 with Msat=1e6 A/m gives mu0*H_k = 2*(Ku1 - mu0*Msat^2/2)/Msat
        // = 0.343 T for this out-of-plane easy axis, so the pulse is set above it.
        fieldPulseAmplitude: qty({ value: 0.6, unit: "T", source: "preset" }),
        fieldPulseDuration: qty({ value: 0.5, unit: "ns", source: "preset" }),
        switchingThreshold: 0.8,
        simulationTime: qty({ value: 2, unit: "ns", source: "preset" })
      }
    }
  };
}

/** @type {Record<import("./types").SolverTarget, { label: string, connected: boolean, note: string, apiRoutable: boolean }>} */
export const SOLVER_TARGETS = {
  python_llg: {
    label: "Python LLG",
    connected: true,
    apiRoutable: true,
    note: "CPU macrospin Landau–Lifshitz–Gilbert on this machine. Not MuMax3. Not a mesh. Not calibrated."
  },
  demo: {
    label: "Demo",
    connected: true,
    apiRoutable: true,
    note: "Local fixture runner by default. Optional backend demo endpoint. Not a physical solver."
  },
  mumax3: {
    label: "MuMax3",
    connected: false,
    apiRoutable: true,
    note: "Retired in this Twin. Use Python LLG."
  },
  kwant: {
    label: "Kwant",
    connected: false,
    apiRoutable: true,
    note: "Kwant integration pending. API accepts the request and returns not_configured."
  },
  surrogate: {
    label: "Surrogate",
    connected: false,
    apiRoutable: true,
    note: "Surrogate model not connected. API returns not_configured; no inference."
  }
};

/**
 * @returns {Omit<import("./types").SimulatorState, "validation">}
 */
export function createDefaultScenario() {
  return {
    scenarioId: "mtj-pillar-demo",
    title: "PMTJ free-layer switching",
    solverTarget: "python_llg",
    geometry: {
      freeLayerThickness: qty({ value: 1.2, unit: "nm" }),
      freeLayerLength: qty({ value: 80, unit: "nm" }),
      freeLayerWidth: qty({ value: 40, unit: "nm" }),
      barrierThickness: qty({ value: 1.0, unit: "nm" }),
      referenceLayerThickness: qty({ value: 2.4, unit: "nm" }),
      cellShape: "rectangle"
    },
    materials: {
      freeLayerId: "cofeb-example",
      referenceLayerId: "cofeb-example",
      barrierId: "mgo-example"
    },
    controls: {
      mode: "time_domain",
      recordTimeline: true,
      pauseOnWarning: false,
      duration: qty({ value: 2, unit: "ns" }),
      temperature: qty({ value: 300, unit: "K" }),
      currentDirection: "positive_z",
      selectedRegion: "free",
      viewportZoom: 1
    },
    torque: {
      mechanism: "stt",
      enabled: true,
      currentDensity: qty({ value: 2e11, unit: "A/m^2" }),
      polarization: qty({ value: 0.6, unit: "dimensionless" }),
      notes: "Slonczewski STT is integrated in the Python LLGS twin. MuMax3 still ignores this field."
    },
    initialMagnetization: {
      mode: "uniform",
      vector: { x: 0, y: 0, z: 1 },
      notes: "Initial condition draft for future micromagnetic requests."
    },
    externalField: {
      x: qty({ value: 0, unit: "T" }),
      y: qty({ value: 0, unit: "T" }),
      z: qty({ value: 0, unit: "T" })
    },
    solverDrafts: {
      mumax3: {
        modelKind: "spinvault_mtj_free_layer_switching_v1",
        meshCellSize: {
          x: qty({ value: 1.25, unit: "nm" }),
          y: qty({ value: 1.25, unit: "nm" }),
          z: qty({ value: 0.6, unit: "nm" })
        },
        gridSize: { nx: 64, ny: 32, nz: 2 },
        saturationMagnetization: qty({ value: 1000000, unit: "A/m" }),
        exchangeStiffness: qty({ value: 1e-11, unit: "J/m" }),
        dampingAlpha: qty({ value: 0.01, unit: "dimensionless" }),
        anisotropyAxis: { x: 0, y: 0, z: 1 },
        anisotropyConstant: qty({ value: 800000, unit: "J/m^3", source: "preset" }),
        pinnedDirection: { x: 0, y: 0, z: 1 },
        statePreset: "transition_0_to_1",
        // Above the 0.343 T coherent-rotation switching field implied by Ku1 and Msat.
        fieldPulseAmplitude: qty({ value: 0.6, unit: "T", source: "preset" }),
        fieldPulseDuration: qty({ value: 0.5, unit: "ns", source: "preset" }),
        switchingThreshold: 0.8,
        currentDensity: qty({ value: 1e10, unit: "A/m^2" }),
        simulationTime: qty({ value: 2, unit: "ns" }),
        timeStepHint: qty({ value: 1, unit: "ps" })
      },
      kwant: {
        latticeModel: "placeholder_1d",
        hoppingEnergy: qty({ value: 1, unit: "eV" }),
        onsiteEnergy: qty({ value: 0, unit: "eV" }),
        spinOrbitCoupling: qty({ value: 0, unit: "eV" }),
        leadConfiguration: "two_terminal",
        temperature: qty({ value: 300, unit: "K" })
      },
      surrogate: {
        connectionStatus: "not_connected",
        notes: "Metadata only; no model is selected or invoked."
      }
    },
    provenance: presetProvenance("Default scenario preset for UI and serialization review.")
  };
}

/**
 * @returns {import("./types").SimulatorState}
 */
export function createDefaultState() {
  const scenario = createDefaultScenario();
  return { ...scenario, validation: [] };
}

/**
 * Conventional pMTJ free-layer reference for the first real MuMax3 checkpoint.
 * Every numeric value remains UNVALIDATED_DEFAULT until a citation is recorded.
 * @returns {Omit<import("./types").SimulatorState, "validation">}
 */
export function createReferenceV01Scenario() {
  const state = createDefaultScenario();
  return {
    ...state,
    scenarioId: "reference-pmtj-v01",
    title: "Reference pMTJ V01 equilibrium",
    solverTarget: "mumax3",
    geometry: {
      ...state.geometry,
      freeLayerLength: qty({ value: 40, unit: "nm", source: "preset" }),
      freeLayerWidth: qty({ value: 40, unit: "nm", source: "preset" }),
      freeLayerThickness: qty({ value: 1.2, unit: "nm", source: "preset" }),
      cellShape: "ellipse"
    },
    controls: {
      ...state.controls,
      mode: "static",
      temperature: qty({ value: 0, unit: "K", source: "preset" }),
      // Required by the common request schema but not used as physical time by relax().
      duration: qty({ value: 1, unit: "ns", source: "preset" })
    },
    torque: {
      ...state.torque,
      mechanism: "none",
      enabled: false,
      notes: "V01 equilibrium has no current torque."
    },
    initialMagnetization: {
      mode: "uniform",
      vector: { x: 0.1, y: 0, z: 0.9949874371 },
      notes: "Explicit non-collinear initial condition for deterministic relaxation."
    },
    externalField: {
      x: qty({ value: 0, unit: "T", source: "preset" }),
      y: qty({ value: 0, unit: "T", source: "preset" }),
      z: qty({ value: 0, unit: "T", source: "preset" })
    },
    solverDrafts: {
      ...state.solverDrafts,
      mumax3: {
        ...state.solverDrafts.mumax3,
        modelKind: "reference_pmtj_v01_equilibrium",
        gridSize: { nx: 32, ny: 32, nz: 2 },
        meshCellSize: {
          x: qty({ value: 1.25, unit: "nm", source: "preset" }),
          y: qty({ value: 1.25, unit: "nm", source: "preset" }),
          z: qty({ value: 0.6, unit: "nm", source: "preset" })
        },
        saturationMagnetization: qty({ value: 1e6, unit: "A/m", source: "preset" }),
        exchangeStiffness: qty({ value: 1e-11, unit: "J/m", source: "preset" }),
        dampingAlpha: qty({ value: 0.01, unit: "dimensionless", source: "preset" }),
        anisotropyAxis: { x: 0, y: 0, z: 1 },
        anisotropyConstant: qty({ value: 8e5, unit: "J/m^3", source: "preset" }),
        simulationTime: qty({ value: 1, unit: "ns", source: "preset" })
      }
    },
    provenance: presetProvenance(
      "Reference pMTJ V01 parameter set. All numeric values are UNVALIDATED_DEFAULT and require citations."
    )
  };
}

/** @type {import("./types").ScenarioPreset[]} */
export const SCENARIO_PRESETS = [
  {
    id: "reference-pmtj-v01",
    label: "Reference pMTJ V01 equilibrium",
    description: "Zero-temperature MuMax3 free-layer relaxation. UNVALIDATED_DEFAULT parameters.",
    state: createReferenceV01Scenario(),
    provenance: presetProvenance(
      "Reference pMTJ V01 preset; all numeric values are UNVALIDATED_DEFAULT."
    )
  },
  {
    id: "mtj-pillar-demo",
    label: "MTJ pillar review",
    description: "Elliptical stack sketch for the demo workspace.",
    state: createDefaultScenario(),
    provenance: presetProvenance("MTJ pillar UI preset.")
  },
  {
    id: "nanotrack-demo",
    label: "Nanotrack sketch",
    description: "Elongated track sketch for viewport layout tests.",
    state: {
      scenarioId: "nanotrack-demo",
      title: "Nanotrack sketch",
      solverTarget: "demo",
      geometry: {
        freeLayerThickness: qty({ value: 1.0, unit: "nm" }),
        freeLayerLength: qty({ value: 240, unit: "nm" }),
        freeLayerWidth: qty({ value: 32, unit: "nm" }),
        barrierThickness: qty({ value: 0.8, unit: "nm" }),
        referenceLayerThickness: qty({ value: 1.8, unit: "nm" }),
        cellShape: "nanowire"
      },
      materials: {
        freeLayerId: "nife-example",
        referenceLayerId: "cofeb-example",
        barrierId: "al2o3-example"
      },
      controls: {
        mode: "sweep",
        recordTimeline: true,
        pauseOnWarning: true,
        duration: qty({ value: 12, unit: "ns" }),
        temperature: qty({ value: 320, unit: "K" }),
        currentDirection: "negative_z",
        selectedRegion: "barrier",
        viewportZoom: 1
      },
      torque: {
        mechanism: "sot",
        enabled: true,
        currentDensity: qty({ value: 5e10, unit: "A/m^2" }),
        polarization: qty({ value: 0.4, unit: "dimensionless" }),
        notes: "Illustrative draft only; not used by the demo."
      },
      initialMagnetization: {
        mode: "uniform",
        vector: { x: 1, y: 0, z: 0 },
        notes: "Draft initial state."
      },
      externalField: {
        x: qty({ value: 0, unit: "T" }),
        y: qty({ value: 0, unit: "T" }),
        z: qty({ value: 0, unit: "T" })
      },
      solverDrafts: {
        mumax3: {
          meshCellSize: {
            x: qty({ value: 4, unit: "nm" }),
            y: qty({ value: 4, unit: "nm" }),
            z: qty({ value: 0.5, unit: "nm" })
          },
          gridSize: { nx: 60, ny: 8, nz: 2 },
          dampingAlpha: qty({ value: 0.02, unit: "dimensionless" }),
          anisotropyAxis: { x: 1, y: 0, z: 0 },
          simulationTime: qty({ value: 12, unit: "ns" })
        },
        kwant: {
          latticeModel: "placeholder_1d",
          hoppingEnergy: qty({ value: 1, unit: "eV" }),
          onsiteEnergy: qty({ value: 0, unit: "eV" }),
          spinOrbitCoupling: qty({ value: 0, unit: "eV" }),
          leadConfiguration: "two_terminal",
          temperature: qty({ value: 320, unit: "K" })
        },
        surrogate: {
          connectionStatus: "not_connected",
          notes: "Metadata only; no model is selected or invoked."
        }
      },
      provenance: presetProvenance("Nanotrack UI preset for request-shape review.")
    },
    provenance: presetProvenance("Nanotrack UI preset.")
  }
];

/**
 * @param {string} id
 */
export function getMaterialPreset(id) {
  return MATERIAL_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * @param {string} id
 */
export function getScenarioPreset(id) {
  return SCENARIO_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * @param {import("./types").ScenarioPreset} preset
 * @returns {import("./types").SimulatorState}
 */
export function stateFromPreset(preset) {
  return {
    ...structuredClone(preset.state),
    scenarioId: preset.id,
    title: preset.state.title,
    validation: []
  };
}

/**
 * Adds fields introduced by later prompts when restoring an older local snapshot.
 * @param {Partial<import("./types").SimulatorState>} saved
 * @returns {import("./types").SimulatorState}
 */
export function hydrateSavedState(saved) {
  const base = createDefaultState();
  const hydrated = {
    ...base,
    ...saved,
    geometry: { ...base.geometry, ...saved.geometry },
    materials: { ...base.materials, ...saved.materials },
    controls: { ...base.controls, ...saved.controls },
    torque: { ...base.torque, ...saved.torque },
    initialMagnetization: { ...base.initialMagnetization, ...saved.initialMagnetization },
    externalField: { ...base.externalField, ...saved.externalField },
    solverDrafts: {
      mumax3: {
        ...base.solverDrafts.mumax3,
        ...saved.solverDrafts?.mumax3,
        meshCellSize: {
          ...base.solverDrafts.mumax3.meshCellSize,
          ...saved.solverDrafts?.mumax3?.meshCellSize
        }
      },
      kwant: { ...base.solverDrafts.kwant, ...saved.solverDrafts?.kwant },
      surrogate: { ...base.solverDrafts.surrogate, ...saved.solverDrafts?.surrogate }
    },
    provenance: { ...base.provenance, ...saved.provenance },
    validation: []
  };
  hydrated.scenarioId = hydrateText(base.scenarioId, saved.scenarioId);
  hydrated.title = hydrateText(base.title, saved.title);
  hydrated.solverTarget = hydrateEnum(base.solverTarget, saved.solverTarget, /** @type {import("./types").SolverTarget[]} */ (Object.keys(SOLVER_TARGETS)));
  if (hydrated.solverTarget === "mumax3") hydrated.solverTarget = "python_llg";
  hydrated.geometry.cellShape = hydrateEnum(base.geometry.cellShape, saved.geometry?.cellShape, [
    "ellipse",
    "rectangle",
    "nanowire",
    "custom"
  ]);
  hydrated.materials.freeLayerId = hydrateText(base.materials.freeLayerId, saved.materials?.freeLayerId);
  hydrated.materials.referenceLayerId = hydrateText(base.materials.referenceLayerId, saved.materials?.referenceLayerId);
  hydrated.materials.barrierId = hydrateText(base.materials.barrierId, saved.materials?.barrierId);
  hydrated.controls.mode = hydrateEnum(base.controls.mode, saved.controls?.mode, ["static", "time_domain", "sweep"]);
  hydrated.controls.currentDirection = hydrateEnum(base.controls.currentDirection, saved.controls?.currentDirection, ["positive_z", "negative_z"]);
  hydrated.controls.selectedRegion = hydrateEnum(base.controls.selectedRegion, saved.controls?.selectedRegion, [
    "free",
    "reference",
    "barrier",
    "none"
  ]);
  hydrated.torque.mechanism = hydrateEnum(base.torque.mechanism, saved.torque?.mechanism, ["none", "stt", "sot", "combined"]);
  hydrated.initialMagnetization.mode = hydrateEnum(base.initialMagnetization.mode, saved.initialMagnetization?.mode, [
    "uniform",
    "random",
    "region_based",
    "import_pending"
  ]);
  hydrated.solverDrafts.mumax3.modelKind = hydrateEnum(
    base.solverDrafts.mumax3.modelKind ?? "smoke",
    saved.solverDrafts?.mumax3?.modelKind,
    /** @type {import("./types").MumaxModelKind[]} */ (Object.keys(MUMAX_MODEL_KINDS))
  );
  hydrated.geometry.freeLayerThickness = hydrateQuantity(base.geometry.freeLayerThickness, saved.geometry?.freeLayerThickness);
  hydrated.geometry.freeLayerLength = hydrateQuantity(base.geometry.freeLayerLength, saved.geometry?.freeLayerLength);
  hydrated.geometry.freeLayerWidth = hydrateQuantity(base.geometry.freeLayerWidth, saved.geometry?.freeLayerWidth);
  hydrated.geometry.barrierThickness = hydrateQuantity(base.geometry.barrierThickness, saved.geometry?.barrierThickness);
  hydrated.geometry.referenceLayerThickness = hydrateQuantity(base.geometry.referenceLayerThickness, saved.geometry?.referenceLayerThickness);
  hydrated.controls.duration = hydrateQuantity(base.controls.duration, saved.controls?.duration);
  hydrated.controls.temperature = hydrateQuantity(base.controls.temperature, saved.controls?.temperature);
  hydrated.externalField.x = hydrateQuantity(base.externalField.x, saved.externalField?.x);
  hydrated.externalField.y = hydrateQuantity(base.externalField.y, saved.externalField?.y);
  hydrated.externalField.z = hydrateQuantity(base.externalField.z, saved.externalField?.z);
  if (hydrated.torque.currentDensity && base.torque.currentDensity) {
    hydrated.torque.currentDensity = hydrateQuantity(base.torque.currentDensity, saved.torque?.currentDensity);
  }
  if (hydrated.torque.polarization && base.torque.polarization) {
    hydrated.torque.polarization = hydrateQuantity(base.torque.polarization, saved.torque?.polarization);
  }
  if (hydrated.initialMagnetization.vector) {
    hydrated.initialMagnetization.vector = {
      x: hydrateNumber(base.initialMagnetization.vector?.x ?? 0, saved.initialMagnetization?.vector?.x),
      y: hydrateNumber(base.initialMagnetization.vector?.y ?? 0, saved.initialMagnetization?.vector?.y),
      z: hydrateNumber(base.initialMagnetization.vector?.z ?? 1, saved.initialMagnetization?.vector?.z)
    };
  }
  hydrated.solverDrafts.mumax3.meshCellSize.x = hydrateQuantity(
    base.solverDrafts.mumax3.meshCellSize.x,
    saved.solverDrafts?.mumax3?.meshCellSize?.x
  );
  hydrated.solverDrafts.mumax3.meshCellSize.y = hydrateQuantity(
    base.solverDrafts.mumax3.meshCellSize.y,
    saved.solverDrafts?.mumax3?.meshCellSize?.y
  );
  hydrated.solverDrafts.mumax3.meshCellSize.z = hydrateQuantity(
    base.solverDrafts.mumax3.meshCellSize.z,
    saved.solverDrafts?.mumax3?.meshCellSize?.z
  );
  if (hydrated.solverDrafts.mumax3.saturationMagnetization && base.solverDrafts.mumax3.saturationMagnetization) {
    hydrated.solverDrafts.mumax3.saturationMagnetization = hydrateQuantity(
      base.solverDrafts.mumax3.saturationMagnetization,
      saved.solverDrafts?.mumax3?.saturationMagnetization
    );
  }
  if (hydrated.solverDrafts.mumax3.exchangeStiffness && base.solverDrafts.mumax3.exchangeStiffness) {
    hydrated.solverDrafts.mumax3.exchangeStiffness = hydrateQuantity(
      base.solverDrafts.mumax3.exchangeStiffness,
      saved.solverDrafts?.mumax3?.exchangeStiffness
    );
  }
  if (hydrated.solverDrafts.mumax3.dampingAlpha && base.solverDrafts.mumax3.dampingAlpha) {
    hydrated.solverDrafts.mumax3.dampingAlpha = hydrateQuantity(
      base.solverDrafts.mumax3.dampingAlpha,
      saved.solverDrafts?.mumax3?.dampingAlpha
    );
  }
  if (hydrated.solverDrafts.mumax3.anisotropyConstant && base.solverDrafts.mumax3.anisotropyConstant) {
    hydrated.solverDrafts.mumax3.anisotropyConstant = hydrateQuantity(
      base.solverDrafts.mumax3.anisotropyConstant,
      saved.solverDrafts?.mumax3?.anisotropyConstant
    );
  }
  if (hydrated.solverDrafts.mumax3.fieldPulseAmplitude && base.solverDrafts.mumax3.fieldPulseAmplitude) {
    hydrated.solverDrafts.mumax3.fieldPulseAmplitude = hydrateQuantity(
      base.solverDrafts.mumax3.fieldPulseAmplitude,
      saved.solverDrafts?.mumax3?.fieldPulseAmplitude
    );
  }
  if (hydrated.solverDrafts.mumax3.fieldPulseDuration && base.solverDrafts.mumax3.fieldPulseDuration) {
    hydrated.solverDrafts.mumax3.fieldPulseDuration = hydrateQuantity(
      base.solverDrafts.mumax3.fieldPulseDuration,
      saved.solverDrafts?.mumax3?.fieldPulseDuration
    );
  }
  if (hydrated.solverDrafts.mumax3.currentDensity && base.solverDrafts.mumax3.currentDensity) {
    hydrated.solverDrafts.mumax3.currentDensity = hydrateQuantity(
      base.solverDrafts.mumax3.currentDensity,
      saved.solverDrafts?.mumax3?.currentDensity
    );
  }
  if (hydrated.solverDrafts.mumax3.simulationTime && base.solverDrafts.mumax3.simulationTime) {
    hydrated.solverDrafts.mumax3.simulationTime = hydrateQuantity(
      base.solverDrafts.mumax3.simulationTime,
      saved.solverDrafts?.mumax3?.simulationTime
    );
  }
  if (hydrated.solverDrafts.mumax3.timeStepHint && base.solverDrafts.mumax3.timeStepHint) {
    hydrated.solverDrafts.mumax3.timeStepHint = hydrateQuantity(
      base.solverDrafts.mumax3.timeStepHint,
      saved.solverDrafts?.mumax3?.timeStepHint
    );
  }
  if (hydrated.solverDrafts.mumax3.anisotropyAxis) {
    hydrated.solverDrafts.mumax3.anisotropyAxis = {
      x: hydrateNumber(base.solverDrafts.mumax3.anisotropyAxis?.x ?? 0, saved.solverDrafts?.mumax3?.anisotropyAxis?.x),
      y: hydrateNumber(base.solverDrafts.mumax3.anisotropyAxis?.y ?? 0, saved.solverDrafts?.mumax3?.anisotropyAxis?.y),
      z: hydrateNumber(base.solverDrafts.mumax3.anisotropyAxis?.z ?? 1, saved.solverDrafts?.mumax3?.anisotropyAxis?.z)
    };
  }
  if (hydrated.solverDrafts.mumax3.pinnedDirection) {
    hydrated.solverDrafts.mumax3.pinnedDirection = {
      x: hydrateNumber(base.solverDrafts.mumax3.pinnedDirection?.x ?? 0, saved.solverDrafts?.mumax3?.pinnedDirection?.x),
      y: hydrateNumber(base.solverDrafts.mumax3.pinnedDirection?.y ?? 0, saved.solverDrafts?.mumax3?.pinnedDirection?.y),
      z: hydrateNumber(base.solverDrafts.mumax3.pinnedDirection?.z ?? 1, saved.solverDrafts?.mumax3?.pinnedDirection?.z)
    };
  }
  hydrated.solverDrafts.mumax3.statePreset =
    /** @type {import("./types").MumaxStatePreset} */ (hydrateEnum(
      base.solverDrafts.mumax3.statePreset ?? "state_0_ap",
      saved.solverDrafts?.mumax3?.statePreset,
      ["state_0_ap", "state_1_p", "transition_0_to_1", "transition_1_to_0"]
    ));
  hydrated.solverDrafts.mumax3.switchingThreshold = hydrateNumber(
    base.solverDrafts.mumax3.switchingThreshold ?? 0.8,
    saved.solverDrafts?.mumax3?.switchingThreshold
  );
  if (hydrated.solverDrafts.mumax3.modelKind === "spinvault_mtj_free_layer_v0") {
    hydrated.controls.duration = qty({ value: 0.1, unit: "ns", source: "user" });
    hydrated.externalField.z = qty({ value: 0.01, unit: "T", source: "user" });
    hydrated.solverDrafts.mumax3.gridSize = { nx: 8, ny: 4, nz: 1 };
    hydrated.solverDrafts.mumax3.simulationTime = qty({ value: 0.1, unit: "ns", source: "user" });
  }
  if (hydrated.solverDrafts.mumax3.modelKind === "spinvault_mtj_free_layer_v0_visible") {
    return applyVisibleDynamicsPreset(hydrated);
  }
  return hydrated;
}
