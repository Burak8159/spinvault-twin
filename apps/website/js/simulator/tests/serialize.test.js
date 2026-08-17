import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeSimulationRequest } from "../../api/serialize.js";
import {
  applySwitchingV1Preset,
  applyVisibleDynamicsPreset,
  createDefaultState,
  createReferenceV01Scenario
} from "../lib/defaults.js";

describe("serializeSimulationRequest", () => {
  it("keeps required backend fields from the default scenario", () => {
    const state = createDefaultState();
    const { payload, warnings } = serializeSimulationRequest(state, "mumax3");
    assert.equal(payload.scenarioId, state.scenarioId);
    assert.equal(payload.title, state.title);
    assert.equal(payload.requestedSolver, "mumax3");
    assert.equal(payload.geometry.cellShape, state.geometry.cellShape);
    assert.equal(payload.materials.freeLayerId, state.materials.freeLayerId);
    assert.equal(payload.controls.mode, state.controls.mode);
    assert.equal(payload.solverDrafts?.mumax3.modelKind, "spinvault_mtj_free_layer_switching_v1");
    assert.ok(payload.solverDrafts?.mumax3.meshCellSize.x);
    assert.ok(payload.solverDrafts?.kwant.latticeModel);
    assert.equal(payload.solverDrafts?.surrogate.connectionStatus, "not_connected");
    assert.equal(warnings.length, 0);
  });

  it("serializes SpinVault MTJ free-layer v0 modelKind for MuMax3 remote runs", () => {
    const state = createDefaultState();
    state.solverDrafts.mumax3.modelKind = "spinvault_mtj_free_layer_v0";
    const { payload, warnings } = serializeSimulationRequest(state, "mumax3");
    assert.equal(payload.requestedSolver, "mumax3");
    assert.equal(payload.solverDrafts?.mumax3.modelKind, "spinvault_mtj_free_layer_v0");
    assert.equal(warnings.length, 0);
  });

  it("preserves switching_v1 modelKind from the default scenario", () => {
    const state = createDefaultState();
    const { payload } = serializeSimulationRequest(state, "mumax3");
    assert.equal(payload.solverDrafts?.mumax3.modelKind, "spinvault_mtj_free_layer_switching_v1");
  });

  it("serializes the visible v0 preset with tilted m0 and transverse field", () => {
    const state = applyVisibleDynamicsPreset(createDefaultState());
    const { payload, warnings } = serializeSimulationRequest(state, "mumax3");
    const mumax = payload.solverDrafts?.mumax3;
    assert.equal(
      mumax?.modelKind,
      "spinvault_mtj_free_layer_v0_visible"
    );
    assert.deepEqual(payload.initialMagnetization?.vector, { x: 0.1, y: 0, z: 0.995 });
    assert.equal(payload.externalField?.x.value, 0.01);
    assert.equal(payload.externalField?.z.value, 0.01);
    assert.equal(mumax?.simulationTime?.value, 1);
    assert.equal(mumax?.simulationTime?.unit, "ns");
    assert.deepEqual(mumax?.gridSize, { nx: 64, ny: 32, nz: 2 });
    assert.ok(
      mumax.gridSize.nx *
        mumax.gridSize.ny *
        mumax.gridSize.nz >
        1000
    );
    assert.equal("anisotropyConstant" in mumax, false);
    assert.equal("anisotropyAxis" in mumax, false);
    assert.equal("pinnedDirection" in mumax, false);
    assert.equal("statePreset" in mumax, false);
    assert.equal("fieldPulseAmplitude" in mumax, false);
    assert.equal("fieldPulseDuration" in mumax, false);
    assert.equal("switchingThreshold" in mumax, false);
    assert.deepEqual(Object.keys(mumax).sort(), [
      "dampingAlpha",
      "exchangeStiffness",
      "gridSize",
      "meshCellSize",
      "modelKind",
      "saturationMagnetization",
      "simulationTime"
    ]);
    assert.equal(warnings.length, 0);
  });

  it("serializes the switching v1 anisotropy, pinned direction, and pulse", () => {
    const state = applySwitchingV1Preset(createDefaultState());
    state.solverDrafts.mumax3.statePreset = "transition_1_to_0";
    const { payload, warnings } = serializeSimulationRequest(state, "mumax3");
    const mumax = payload.solverDrafts?.mumax3;
    assert.equal(mumax?.modelKind, "spinvault_mtj_free_layer_switching_v1");
    assert.equal(mumax?.statePreset, "transition_1_to_0");
    assert.deepEqual(mumax?.pinnedDirection, { x: 0, y: 0, z: 1 });
    assert.equal(mumax?.anisotropyConstant?.value, 800000);
    assert.equal(mumax?.anisotropyConstant?.unit, "J/m^3");
    assert.equal(mumax?.fieldPulseAmplitude?.value, 0.6);
    assert.equal(mumax?.fieldPulseDuration?.value, 0.5);
    assert.equal(mumax?.switchingThreshold, 0.8);
    assert.equal("currentDensity" in mumax, false);
    assert.equal("timeStepHint" in mumax, false);
    assert.equal(warnings.length, 0);
  });

  it("omits unsupported STT currentDensity even when present in UI drafts", () => {
    const state = applySwitchingV1Preset(createDefaultState());
    state.solverDrafts.mumax3.currentDensity = {
      value: 1e11,
      unit: "A/m^2",
      source: "preset"
    };
    state.torque.enabled = true;
    const { payload, warnings } = serializeSimulationRequest(state, "mumax3");
    assert.equal("currentDensity" in (payload.solverDrafts?.mumax3 ?? {}), false);
    assert.equal("timeStepHint" in (payload.solverDrafts?.mumax3 ?? {}), false);
    assert.equal(warnings.length, 0);
  });

  it("warns when a quantity cannot be serialized", () => {
    const state = createDefaultState();
    state.geometry.freeLayerThickness = /** @type {any} */ ({ unit: "nm" });
    const { warnings } = serializeSimulationRequest(state, "demo");
    assert.ok(warnings.some((warning) => warning.includes("geometry.freeLayerThickness")));
  });

  it("serializes V01 anisotropy without adding switching pulse fields", () => {
    const state = { ...createReferenceV01Scenario(), validation: [] };
    const { payload } = serializeSimulationRequest(state, "mumax3");
    const mumax = payload.solverDrafts?.mumax3;
    assert.equal(mumax?.modelKind, "reference_pmtj_v01_equilibrium");
    assert.equal(mumax?.anisotropyConstant?.value, 800000);
    assert.deepEqual(mumax?.anisotropyAxis, { x: 0, y: 0, z: 1 });
    assert.equal("statePreset" in (mumax ?? {}), false);
    assert.equal("fieldPulseAmplitude" in (mumax ?? {}), false);
    assert.equal(payload.controls.temperature.value, 0);
  });
});
