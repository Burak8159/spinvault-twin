/**
 * UI-level scenario validation only.
 * Do not encode material feasibility, mesh physics, or solver limits here.
 */

import { SOLVER_TARGETS, getMaterialPreset } from "./defaults.js";
import { isUnitForCategory } from "./units.js";

const LENGTH_FIELDS = [
  ["geometry.freeLayerThickness", "Free layer thickness"],
  ["geometry.freeLayerLength", "Free layer length"],
  ["geometry.freeLayerWidth", "Free layer width"],
  ["geometry.barrierThickness", "Barrier thickness"],
  ["geometry.referenceLayerThickness", "Reference layer thickness"]
];

/**
 * @param {import("./types").SimulatorState} state
 * @param {string} path
 * @returns {unknown}
 */
function readPath(state, path) {
  return path.split(".").reduce((cursor, key) => {
    if (cursor && typeof cursor === "object" && key in cursor) {
      return /** @type {Record<string, unknown>} */ (cursor)[key];
    }
    return undefined;
  }, /** @type {unknown} */ (state));
}

/**
 * @param {unknown} value
 * @returns {value is import("./types").Quantity}
 */
function isQuantity(value) {
  return Boolean(value) && typeof value === "object" && value !== null && "value" in value && "unit" in value;
}

/**
 * Conversion is used only for cross-unit size validation, not simulation.
 * @param {import("./types").Quantity} quantity
 */
function lengthInMeters(quantity) {
  const factors = { m: 1, um: 1e-6, nm: 1e-9 };
  return quantity.value * (factors[/** @type {"m" | "um" | "nm"} */ (quantity.unit)] ?? NaN);
}

/**
 * @param {import("./types").ValidationIssue[]} issues
 * @param {import("./types").Quantity | undefined} quantity
 * @param {import("./types").UnitCategory} category
 * @param {string} field
 * @param {string} label
 */
function validateOptionalQuantity(issues, quantity, category, field, label) {
  if (!quantity) return;
  if (!Number.isFinite(quantity.value)) {
    issues.push({ id: `${field}-number`, severity: "error", field, message: `${label} must be a finite number.` });
  }
  if (!isUnitForCategory(String(quantity.unit), category)) {
    issues.push({ id: `${field}-unit`, severity: "error", field, message: `${label} requires unit ${category}.` });
  }
}

/**
 * UI-level validation only in this phase.
 * @param {import("./types").SimulatorState} state
 * @returns {import("./types").ValidationIssue[]}
 */
export function validateScenario(state) {
  /** @type {import("./types").ValidationIssue[]} */
  const issues = [];

  if (!state.title || !state.title.trim()) {
    issues.push({
      id: "title-missing",
      severity: "error",
      field: "title",
      message: "Scenario title is required."
    });
  }

  for (const [field, label] of LENGTH_FIELDS) {
    const quantity = readPath(state, field);
    if (!isQuantity(quantity)) {
      issues.push({
        id: `${field}-missing`,
        severity: "error",
        field,
        message: `${label} is missing.`
      });
      continue;
    }
    if (!Number.isFinite(quantity.value) || quantity.value <= 0) {
      issues.push({
        id: `${field}-nonpositive`,
        severity: "error",
        field,
        message: `${label} must be a positive number.`
      });
    }
    if (!isUnitForCategory(String(quantity.unit), "length")) {
      issues.push({
        id: `${field}-unit`,
        severity: "error",
        field,
        message: `${label} has an invalid length unit.`
      });
    }
  }

  const duration = state.controls?.duration;
  if (!isQuantity(duration) || !isUnitForCategory(String(duration.unit), "time")) {
    issues.push({
      id: "controls.duration-unit",
      severity: "error",
      field: "controls.duration",
      message: "Duration has an invalid time unit."
    });
  } else if (!Number.isFinite(duration.value) || duration.value <= 0) {
    issues.push({
      id: "controls.duration-nonpositive",
      severity: "error",
      field: "controls.duration",
      message: "Duration must be a positive number."
    });
  }

  const temperature = state.controls?.temperature;
  if (!isQuantity(temperature) || !isUnitForCategory(String(temperature.unit), "temperature")) {
    issues.push({
      id: "controls.temperature-unit",
      severity: "error",
      field: "controls.temperature",
      message: "Temperature has an invalid unit."
    });
  } else if (!Number.isFinite(temperature.value) || temperature.value < 0) {
    issues.push({
      id: "controls.temperature-nonpositive",
      severity: "error",
      field: "controls.temperature",
      message: "Temperature must be zero or positive."
    });
  }

  const solverTarget = state.solverTarget;
  if (!Object.hasOwn(SOLVER_TARGETS, solverTarget)) {
    issues.push({
      id: "solver-unknown",
      severity: "error",
      field: "solverTarget",
      message: "Solver target is not recognized."
    });
  } else if (solverTarget === "python_llg") {
    issues.push({
      id: "solver-python-llg",
      severity: "warning",
      field: "solverTarget",
      message:
        "CPU Python macrospin LLG. One free-layer moment, thin-film demag. Not MuMax3, not a mesh, not calibrated. No TMR/resistance."
    });
    const kind = state.solverDrafts?.mumax3?.modelKind || "smoke";
    if (kind === "spinvault_mtj_free_layer_switching_v1") {
      issues.push({
        id: "python-llg-switching-v1",
        severity: "warning",
        field: "solverDrafts.mumax3.modelKind",
        message:
          "switching_v1 parameters feed the Python LLG twin. Placeholders. No MgO, tunneling, TMR, resistance, retention, or current torque."
      });
    }
  } else if (solverTarget === "mumax3") {
    issues.push({
      id: "solver-mumax3-api",
      severity: "warning",
      field: "solverTarget",
      message:
        "MuMax3 submits to the backend worker queue. Runs only when MUMAX3_BINARY is configured; otherwise status is not_configured."
    });
    const kind = state.solverDrafts?.mumax3?.modelKind || "smoke";
    if (kind === "reference_pmtj_v01_equilibrium") {
      issues.push({
        id: "mumax-reference-v01",
        severity: "warning",
        field: "solverDrafts.mumax3.modelKind",
        message:
          "V01 is a zero-temperature MuMax3 free-layer relaxation. MgO transport, reference-layer dynamics, torque, retention, and leakage are NOT IMPLEMENTED."
      });
      if (Number(state.controls.temperature.value) !== 0) {
        issues.push({
          id: "mumax-reference-v01-temperature",
          severity: "error",
          field: "controls.temperature",
          message:
            "V01 requires 0 K because no MuMax3 thermal field is configured. Set temperature to 0 or choose another model."
        });
      }
    }
    if (
      kind === "spinvault_mtj_free_layer_v0" ||
      kind === "spinvault_mtj_free_layer_v0_visible"
    ) {
      issues.push({
        id: "mumax-model-v0",
        severity: "warning",
        field: "solverDrafts.mumax3.modelKind",
        message:
          `${kind} models only the free layer with request-provided geometry, mesh, Msat/Aex/alpha, m0, and Bext. Raw MuMax3 output only. Not calibrated or experimentally validated. No TMR/resistance/switching-performance claims.`
      });
    }
    if (kind === "spinvault_mtj_free_layer_switching_v1") {
      issues.push({
        id: "mumax-model-switching-v1",
        severity: "warning",
        field: "solverDrafts.mumax3.modelKind",
        message:
          "switching_v1 models one free layer with uniaxial anisotropy and a field pulse. Parameters marked preset are placeholders. No MgO, tunneling, TMR, resistance, retention, or current torque is simulated."
      });
    }
  } else if (solverTarget === "kwant") {
    issues.push({
      id: "solver-kwant-pending",
      severity: "warning",
      field: "solverTarget",
      message: "Kwant integration pending. Backend will return not_configured."
    });
  } else if (solverTarget === "surrogate") {
    issues.push({
      id: "solver-surrogate-pending",
      severity: "warning",
      field: "solverTarget",
      message: "Surrogate model not connected. Backend will return not_configured."
    });
  }

  const materials = state.materials;
  if (!materials?.freeLayerId || !materials?.referenceLayerId || !materials?.barrierId) {
    issues.push({
      id: "materials-empty",
      severity: "error",
      field: "materials",
      message: "Free, reference, and barrier materials must all be selected."
    });
  }

  for (const [role, id] of [
    ["free layer", materials?.freeLayerId],
    ["reference layer", materials?.referenceLayerId],
    ["barrier", materials?.barrierId]
  ]) {
    if (!id) continue;
    const preset = getMaterialPreset(id);
    if (!preset?.provenance?.notes?.length) {
      issues.push({
        id: `materials-${role}-provenance`,
        severity: "warning",
        field: "materials",
        message: `${role} preset is missing provenance notes.`
      });
    } else if (preset.presetStatus !== "verified_by_user") {
      issues.push({
        id: `materials-${role}-review`,
        severity: "warning",
        field: "materials",
        message: `${preset.label} requires literature review or user verification.`
      });
    }
  }

  const mumax = state.solverDrafts?.mumax3;
  if (mumax?.meshCellSize) {
    const axes = /** @type {const} */ (["x", "y", "z"]);
    for (const axis of axes) {
      const quantity = mumax.meshCellSize[axis];
      validateOptionalQuantity(issues, quantity, "length", `solverDrafts.mumax3.meshCellSize.${axis}`, `Mesh cell ${axis}`);
      if (quantity.value <= 0) {
        issues.push({
          id: `mesh-${axis}-positive`,
          severity: "error",
          field: `solverDrafts.mumax3.meshCellSize.${axis}`,
          message: `Mesh cell ${axis} must be positive.`
        });
      }
    }
    /** @type {Array<["x" | "y" | "z", import("./types").Quantity]>} */
    const comparisons = [
      ["x", state.geometry.freeLayerLength],
      ["y", state.geometry.freeLayerWidth],
      ["z", state.geometry.freeLayerThickness]
    ];
    for (const [axis, dimension] of comparisons) {
      const mesh = mumax.meshCellSize[axis];
      if (
        isUnitForCategory(String(mesh.unit), "length") &&
        isUnitForCategory(String(dimension.unit), "length") &&
        lengthInMeters(mesh) > lengthInMeters(dimension)
      ) {
        issues.push({
          id: `mesh-${axis}-dimension`,
          severity: "error",
          field: `solverDrafts.mumax3.meshCellSize.${axis}`,
          message: `Mesh cell ${axis} must be smaller than the corresponding device dimension.`
        });
      }
    }
    if (mumax.gridSize && mumax.modelKind?.startsWith("spinvault_mtj_free_layer")) {
      const dimensions = {
        x: lengthInMeters(state.geometry.freeLayerLength),
        y: lengthInMeters(state.geometry.freeLayerWidth),
        z: lengthInMeters(state.geometry.freeLayerThickness)
      };
      for (const axis of axes) {
        const cell = lengthInMeters(mumax.meshCellSize[axis]);
        const cells = mumax.gridSize[/** @type {"nx" | "ny" | "nz"} */ (`n${axis}`)];
        const world = cells * cell;
        const tolerance = Math.max(0.05 * dimensions[axis], 0.5 * cell);
        const mismatch = axis === "z"
          ? Math.abs(world - dimensions[axis]) > tolerance
          : dimensions[axis] > world + 0.5 * cell;
        if (mismatch) {
          issues.push({
            id: `mumax-world-${axis}-mismatch`,
            severity: "error",
            field: axis === "z" ? "geometry.freeLayerThickness" : "geometry",
            message: axis === "z"
              ? "MuMax3 nz×dz must represent the requested free-layer thickness within half a z cell."
              : `MuMax3 n${axis}×d${axis} is smaller than the requested free-layer ${axis === "x" ? "length" : "width"}.`
          });
        }
      }
    }
  }

  validateOptionalQuantity(issues, mumax?.saturationMagnetization, "magnetization", "solverDrafts.mumax3.saturationMagnetization", "Saturation magnetization");
  validateOptionalQuantity(issues, mumax?.exchangeStiffness, "exchange", "solverDrafts.mumax3.exchangeStiffness", "Exchange stiffness");
  validateOptionalQuantity(issues, mumax?.dampingAlpha, "dimensionless", "solverDrafts.mumax3.dampingAlpha", "Damping alpha");
  validateOptionalQuantity(issues, mumax?.anisotropyConstant, "anisotropy", "solverDrafts.mumax3.anisotropyConstant", "Anisotropy constant");
  validateOptionalQuantity(issues, mumax?.fieldPulseAmplitude, "field", "solverDrafts.mumax3.fieldPulseAmplitude", "Field pulse amplitude");
  validateOptionalQuantity(issues, mumax?.fieldPulseDuration, "time", "solverDrafts.mumax3.fieldPulseDuration", "Field pulse duration");
  validateOptionalQuantity(issues, mumax?.currentDensity, "currentDensity", "solverDrafts.mumax3.currentDensity", "Current density");

  if (mumax?.dampingAlpha && (mumax.dampingAlpha.value <= 0 || mumax.dampingAlpha.value > 1)) {
    issues.push({
      id: "mumax-damping-range",
      severity: "warning",
      field: "solverDrafts.mumax3.dampingAlpha",
      message: "Damping alpha is outside the basic (0, 1] input range; review rather than treating this as a feasibility verdict."
    });
  }

  /** @type {Array<[string, import("./types").Vector3 | undefined, string]>} */
  const directionVectors = [
    ["Initial magnetization", state.initialMagnetization?.vector, "initialMagnetization.vector"],
    ["Anisotropy axis", mumax?.anisotropyAxis, "solverDrafts.mumax3.anisotropyAxis"],
    ["Pinned direction", mumax?.pinnedDirection, "solverDrafts.mumax3.pinnedDirection"]
  ];
  for (const [label, vector, field] of directionVectors) {
    if (!vector) continue;
    const norm = Math.hypot(vector.x, vector.y, vector.z);
    if (!Number.isFinite(norm)) {
      issues.push({ id: `${field}-finite`, severity: "error", field, message: `${label} components must be finite.` });
    } else if (Math.abs(norm - 1) > 0.01) {
      issues.push({
        id: `${field}-normalized`,
        severity: "warning",
        field,
        message: `${label} is not normalized (norm ${norm.toFixed(3)}).`
      });
    }
  }

  for (const axis of /** @type {const} */ (["x", "y", "z"])) {
    validateOptionalQuantity(issues, state.externalField?.[axis], "field", `externalField.${axis}`, `External field ${axis}`);
  }

  if (state.torque?.enabled) {
    validateOptionalQuantity(issues, state.torque.currentDensity, "currentDensity", "torque.currentDensity", "Torque current density");
    validateOptionalQuantity(issues, state.torque.polarization, "dimensionless", "torque.polarization", "Torque polarization");
  }

  return issues;
}

/**
 * @param {import("./types").ValidationIssue[]} issues
 */
export function hasBlockingErrors(issues) {
  return issues.some((issue) => issue.severity === "error");
}
