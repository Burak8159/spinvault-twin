import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyVisibleDynamicsPreset, createDefaultState } from "../lib/defaults.js";
import { hasBlockingErrors, validateScenario } from "../lib/validation.js";

describe("validateScenario", () => {
  it("accepts the default scenario without blocking errors", () => {
    const state = createDefaultState();
    const issues = validateScenario(state);
    assert.equal(hasBlockingErrors(issues), false);
  });

  it("flags a missing title as an error", () => {
    const state = createDefaultState();
    state.title = "   ";
    const issues = validateScenario(state);
    assert.ok(issues.some((issue) => issue.id === "title-missing" && issue.severity === "error"));
  });

  it("flags non-positive geometry lengths", () => {
    const state = createDefaultState();
    state.geometry.freeLayerThickness.value = 0;
    const issues = validateScenario(state);
    assert.ok(
      issues.some(
        (issue) => issue.field === "geometry.freeLayerThickness" && issue.severity === "error"
      )
    );
  });

  it("warns when magnetization is not normalized", () => {
    const state = createDefaultState();
    state.initialMagnetization.vector = { x: 1, y: 1, z: 0 };
    const issues = validateScenario(state);
    assert.ok(
      issues.some(
        (issue) => issue.id === "initialMagnetization.vector-normalized" && issue.severity === "warning"
      )
    );
    assert.equal(hasBlockingErrors(issues), false);
  });

  it("accepts mesh z equal to free-layer thickness for a single z cell", () => {
    const state = createDefaultState();
    state.geometry.freeLayerThickness.value = 1.2;
    state.solverDrafts.mumax3.meshCellSize.z.value = 1.2;
    state.solverDrafts.mumax3.gridSize.nz = 1;
    assert.equal(hasBlockingErrors(validateScenario(state)), false);
  });

  it("rejects a mesh cell larger than the matching device dimension", () => {
    const state = createDefaultState();
    state.solverDrafts.mumax3.meshCellSize.z.value = 3;
    const issues = validateScenario(state);
    assert.ok(issues.some((issue) => issue.id === "mesh-z-dimension" && issue.severity === "error"));
  });

  it("accepts the visible-dynamics preset without blocking mesh errors", () => {
    const state = applyVisibleDynamicsPreset(createDefaultState());
    assert.equal(hasBlockingErrors(validateScenario(state)), false);
  });
});
