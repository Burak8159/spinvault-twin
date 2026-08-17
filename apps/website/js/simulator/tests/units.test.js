import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultState, hydrateSavedState } from "../lib/defaults.js";
import { parseNumericInput } from "../lib/units.js";

describe("parseNumericInput", () => {
  it("accepts dot and comma decimal separators", () => {
    assert.equal(parseNumericInput("0.6"), 0.6);
    assert.equal(parseNumericInput("0,6"), 0.6);
    assert.equal(parseNumericInput("0,01"), 0.01);
  });

  it("repairs comma-decimal saved MuMax3 fields during hydration", () => {
    const saved = createDefaultState();
    saved.solverDrafts.mumax3.modelKind = "spinvault_mtj_free_layer_v0";
    saved.solverDrafts.mumax3.meshCellSize.z = /** @type {any} */ ({ value: "0,6", unit: "nm" });
    saved.solverDrafts.mumax3.dampingAlpha = /** @type {any} */ ({ value: "0,01", unit: "dimensionless" });

    const hydrated = hydrateSavedState(saved);

    assert.equal(hydrated.solverDrafts.mumax3.meshCellSize.z.value, 0.6);
    assert.equal(hydrated.solverDrafts.mumax3.dampingAlpha?.value, 0.01);
    assert.deepEqual(hydrated.solverDrafts.mumax3.gridSize, { nx: 8, ny: 4, nz: 1 });
    assert.equal(hydrated.solverDrafts.mumax3.simulationTime?.value, 0.1);
    assert.equal(hydrated.externalField.z.value, 0.01);
  });

  it("repairs blank saved select and title values during hydration", () => {
    const saved = createDefaultState();
    saved.scenarioId = "";
    saved.title = "";
    saved.solverTarget = /** @type {any} */ ("");
    saved.geometry.cellShape = /** @type {any} */ ("");
    saved.controls.mode = /** @type {any} */ ("");
    saved.solverDrafts.mumax3.modelKind = /** @type {any} */ ("");

    const hydrated = hydrateSavedState(saved);

    assert.equal(hydrated.scenarioId, "mtj-pillar-demo");
    assert.equal(hydrated.title, "PMTJ free-layer switching");
    assert.equal(hydrated.solverTarget, "python_llg");
    assert.equal(hydrated.geometry.cellShape, "rectangle");
    assert.equal(hydrated.controls.mode, "time_domain");
    assert.equal(hydrated.solverDrafts.mumax3.modelKind, "spinvault_mtj_free_layer_switching_v1");
  });
});
