/**
 * Serialize Twin UI state into the FastAPI SimulationRequest shape (camelCase).
 * Does not drop known fields; reports warnings when values cannot be serialized cleanly.
 */

/**
 * @param {import("../simulator/lib/types").Quantity | undefined | null} quantity
 * @param {string} field
 * @param {string[]} warnings
 * @returns {import("../simulator/lib/types").Quantity | undefined}
 */
function serializeQuantity(quantity, field, warnings) {
  if (quantity == null) return undefined;
  if (typeof quantity !== "object" || typeof quantity.value !== "number" || typeof quantity.unit !== "string") {
    warnings.push(`${field} could not be serialized (expected { value, unit }).`);
    return undefined;
  }
  if (!Number.isFinite(quantity.value)) {
    warnings.push(`${field} has a non-finite value and was omitted.`);
    return undefined;
  }
  return {
    value: quantity.value,
    unit: quantity.unit,
    source: quantity.source ?? "unknown",
    ...(quantity.citation ? { citation: quantity.citation } : {})
  };
}

/**
 * @param {import("../simulator/lib/types").SimulatorState} scenario
 * @param {import("../simulator/lib/types").SolverTarget} requestedSolver
 * @returns {{
 *   payload: import("../simulator/lib/types").BackendSimulationRequest,
 *   warnings: string[]
 * }}
 */
export function serializeSimulationRequest(scenario, requestedSolver) {
  /** @type {string[]} */
  const warnings = [];

  if (!scenario?.scenarioId) warnings.push("scenarioId is missing.");
  if (!scenario?.title?.trim()) warnings.push("title is empty.");

  const geometry = scenario.geometry;
  const materials = scenario.materials;
  const controls = scenario.controls;

  /** @type {import("../simulator/lib/types").BackendSimulationRequest} */
  const payload = {
    scenarioId: scenario.scenarioId,
    title: scenario.title,
    requestedSolver,
    geometry: {
      freeLayerThickness: /** @type {import("../simulator/lib/types").Quantity} */ (
        serializeQuantity(geometry.freeLayerThickness, "geometry.freeLayerThickness", warnings)
      ),
      freeLayerLength: /** @type {import("../simulator/lib/types").Quantity} */ (
        serializeQuantity(geometry.freeLayerLength, "geometry.freeLayerLength", warnings)
      ),
      freeLayerWidth: /** @type {import("../simulator/lib/types").Quantity} */ (
        serializeQuantity(geometry.freeLayerWidth, "geometry.freeLayerWidth", warnings)
      ),
      barrierThickness: /** @type {import("../simulator/lib/types").Quantity} */ (
        serializeQuantity(geometry.barrierThickness, "geometry.barrierThickness", warnings)
      ),
      referenceLayerThickness: /** @type {import("../simulator/lib/types").Quantity} */ (
        serializeQuantity(geometry.referenceLayerThickness, "geometry.referenceLayerThickness", warnings)
      ),
      cellShape: geometry.cellShape
    },
    materials: {
      freeLayerId: materials.freeLayerId,
      referenceLayerId: materials.referenceLayerId,
      barrierId: materials.barrierId
    },
    controls: {
      mode: controls.mode,
      recordTimeline: controls.recordTimeline,
      pauseOnWarning: controls.pauseOnWarning,
      duration: /** @type {import("../simulator/lib/types").Quantity} */ (
        serializeQuantity(controls.duration, "controls.duration", warnings)
      ),
      temperature: /** @type {import("../simulator/lib/types").Quantity} */ (
        serializeQuantity(controls.temperature, "controls.temperature", warnings)
      ),
      currentDirection: controls.currentDirection,
      selectedRegion: controls.selectedRegion,
      viewportZoom: controls.viewportZoom
    }
  };

  if (scenario.torque) {
    payload.torque = {
      mechanism: scenario.torque.mechanism,
      enabled: scenario.torque.enabled,
      ...(scenario.torque.currentDensity
        ? {
            currentDensity: serializeQuantity(
              scenario.torque.currentDensity,
              "torque.currentDensity",
              warnings
            )
          }
        : {}),
      ...(scenario.torque.polarization
        ? {
            polarization: serializeQuantity(scenario.torque.polarization, "torque.polarization", warnings)
          }
        : {}),
      ...(scenario.torque.notes ? { notes: scenario.torque.notes } : {})
    };
  }

  if (scenario.initialMagnetization) {
    payload.initialMagnetization = {
      mode: scenario.initialMagnetization.mode,
      ...(scenario.initialMagnetization.vector
        ? { vector: { ...scenario.initialMagnetization.vector } }
        : {}),
      ...(scenario.initialMagnetization.seed != null
        ? { seed: scenario.initialMagnetization.seed }
        : {}),
      ...(scenario.initialMagnetization.notes ? { notes: scenario.initialMagnetization.notes } : {})
    };
  }

  if (scenario.externalField) {
    payload.externalField = {
      x: /** @type {import("../simulator/lib/types").Quantity} */ (
        serializeQuantity(scenario.externalField.x, "externalField.x", warnings)
      ),
      y: /** @type {import("../simulator/lib/types").Quantity} */ (
        serializeQuantity(scenario.externalField.y, "externalField.y", warnings)
      ),
      z: /** @type {import("../simulator/lib/types").Quantity} */ (
        serializeQuantity(scenario.externalField.z, "externalField.z", warnings)
      )
    };
  }

  if (scenario.solverDrafts) {
    const mumax = scenario.solverDrafts.mumax3;
    const kwant = scenario.solverDrafts.kwant;
    const surrogate = scenario.solverDrafts.surrogate;
    const mumaxModelKind = mumax.modelKind || "smoke";
    const includeSwitchingV1Fields = mumaxModelKind === "spinvault_mtj_free_layer_switching_v1";
    const includeAnisotropyFields =
      includeSwitchingV1Fields || mumaxModelKind === "reference_pmtj_v01_equilibrium";
    // currentDensity / timeStepHint remain UI pending metadata and are never submitted:
    // STT/SOT and fixed dt are not mapped into generated .mx3 scripts.
    payload.solverDrafts = {
      mumax3: {
        meshCellSize: {
          x: /** @type {import("../simulator/lib/types").Quantity} */ (
            serializeQuantity(mumax.meshCellSize.x, "solverDrafts.mumax3.meshCellSize.x", warnings)
          ),
          y: /** @type {import("../simulator/lib/types").Quantity} */ (
            serializeQuantity(mumax.meshCellSize.y, "solverDrafts.mumax3.meshCellSize.y", warnings)
          ),
          z: /** @type {import("../simulator/lib/types").Quantity} */ (
            serializeQuantity(mumax.meshCellSize.z, "solverDrafts.mumax3.meshCellSize.z", warnings)
          )
        },
        ...(mumax.gridSize ? { gridSize: { ...mumax.gridSize } } : {}),
        modelKind: mumaxModelKind,
        ...(mumax.saturationMagnetization
          ? {
              saturationMagnetization: serializeQuantity(
                mumax.saturationMagnetization,
                "solverDrafts.mumax3.saturationMagnetization",
                warnings
              )
            }
          : {}),
        ...(mumax.exchangeStiffness
          ? {
              exchangeStiffness: serializeQuantity(
                mumax.exchangeStiffness,
                "solverDrafts.mumax3.exchangeStiffness",
                warnings
              )
            }
          : {}),
        ...(mumax.dampingAlpha
          ? {
              dampingAlpha: serializeQuantity(
                mumax.dampingAlpha,
                "solverDrafts.mumax3.dampingAlpha",
                warnings
              )
            }
          : {}),
        ...(includeAnisotropyFields && mumax.anisotropyAxis ? { anisotropyAxis: { ...mumax.anisotropyAxis } } : {}),
        ...(includeAnisotropyFields && mumax.anisotropyConstant
          ? {
              anisotropyConstant: serializeQuantity(
                mumax.anisotropyConstant,
                "solverDrafts.mumax3.anisotropyConstant",
                warnings
              )
            }
          : {}),
        ...(includeSwitchingV1Fields && mumax.pinnedDirection ? { pinnedDirection: { ...mumax.pinnedDirection } } : {}),
        ...(includeSwitchingV1Fields && mumax.statePreset ? { statePreset: mumax.statePreset } : {}),
        ...(includeSwitchingV1Fields && mumax.fieldPulseAmplitude
          ? {
              fieldPulseAmplitude: serializeQuantity(
                mumax.fieldPulseAmplitude,
                "solverDrafts.mumax3.fieldPulseAmplitude",
                warnings
              )
            }
          : {}),
        ...(includeSwitchingV1Fields && mumax.fieldPulseDuration
          ? {
              fieldPulseDuration: serializeQuantity(
                mumax.fieldPulseDuration,
                "solverDrafts.mumax3.fieldPulseDuration",
                warnings
              )
            }
          : {}),
        ...(includeSwitchingV1Fields && mumax.switchingThreshold != null
          ? { switchingThreshold: mumax.switchingThreshold }
          : {}),
        ...(mumax.simulationTime
          ? {
              simulationTime: serializeQuantity(
                mumax.simulationTime,
                "solverDrafts.mumax3.simulationTime",
                warnings
              )
            }
          : {})
      },
      kwant: {
        latticeModel: kwant.latticeModel,
        ...(kwant.hoppingEnergy
          ? {
              hoppingEnergy: serializeQuantity(
                kwant.hoppingEnergy,
                "solverDrafts.kwant.hoppingEnergy",
                warnings
              )
            }
          : {}),
        ...(kwant.onsiteEnergy
          ? {
              onsiteEnergy: serializeQuantity(
                kwant.onsiteEnergy,
                "solverDrafts.kwant.onsiteEnergy",
                warnings
              )
            }
          : {}),
        ...(kwant.spinOrbitCoupling
          ? {
              spinOrbitCoupling: serializeQuantity(
                kwant.spinOrbitCoupling,
                "solverDrafts.kwant.spinOrbitCoupling",
                warnings
              )
            }
          : {}),
        ...(kwant.leadConfiguration ? { leadConfiguration: kwant.leadConfiguration } : {}),
        ...(kwant.temperature
          ? {
              temperature: serializeQuantity(
                kwant.temperature,
                "solverDrafts.kwant.temperature",
                warnings
              )
            }
          : {})
      },
      surrogate: {
        connectionStatus: "not_connected",
        ...(surrogate.modelId ? { modelId: surrogate.modelId } : {}),
        ...(surrogate.modelVersion ? { modelVersion: surrogate.modelVersion } : {}),
        ...(surrogate.notes ? { notes: surrogate.notes } : {})
      }
    };
  }

  if (scenario.provenance) {
    payload.provenance = {
      createdAt: scenario.provenance.createdAt,
      createdBy: scenario.provenance.createdBy,
      solver: scenario.provenance.solver,
      ...(scenario.provenance.solverVersion
        ? { solverVersion: scenario.provenance.solverVersion }
        : {}),
      ...(scenario.provenance.inputHash ? { inputHash: scenario.provenance.inputHash } : {}),
      notes: [...(scenario.provenance.notes ?? []), "Serialized from SpinVault Twin browser workspace."]
    };
  }

  return { payload, warnings };
}
