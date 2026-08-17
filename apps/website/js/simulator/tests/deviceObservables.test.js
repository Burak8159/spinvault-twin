import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeSimulationRequest } from "../../api/serialize.js";
import { classifyDeviceObservables } from "../lib/deviceObservables.js";
import { createDefaultState } from "../lib/defaults.js";

describe("device observables provenance", () => {
  it("keeps solver-only quantities honest and marks the analytical chain MODEL", () => {
    const rows = classifyDeviceObservables({
      source: "mumax3",
      isPhysicalSimulation: Boolean(1),
      summary: "fixture",
      series: [
        {
          id: "mz",
          label: "mz",
          xLabel: "t",
          xUnit: "s",
          yLabel: "mz",
          yUnit: "1",
          points: [{ x: 0, y: 1 }]
        }
      ],
      metrics: [],
      provenance: { createdAt: "", createdBy: "test", solver: "mumax3", notes: [] },
      artifacts: { frames: [{ path: "outputs/m000000.ovf", label: "m000000.ovf", index: 0, bytes: 8, format: "ovf" }] }
    });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    assert.equal(byId["m-field"].klass, "SIMULATED");
    assert.equal(byId["mean-m"].klass, "SIMULATED");
    // Analytical models, never upgraded to SIMULATED by a MuMax3 run.
    assert.equal(byId.resistance.klass, "MODEL");
    assert.equal(byId.retention.klass, "MODEL");
    assert.match(byId.resistance.value, /Julliere/);
    assert.match(byId.retention.value, /Neel-Arrhenius/);
    assert.match(byId.retention.note, /1 ns/);
    assert.doesNotMatch(byId.retention.note, /measured|validated|calibrated/i);
    // Still no transport solver and no parsed energy columns.
    assert.equal(byId.transmission.klass, "UNAVAILABLE");
    assert.equal(byId.energy.klass, "UNAVAILABLE");
  });

    it("tags python_llg_twin mean-m as SIMULATED without claiming OVF", () => {
    const rows = classifyDeviceObservables({
      source: "python_llg_twin",
      isPhysicalSimulation: Boolean(1),
      summary: "cpu llg",
      series: [
        {
          id: "mz",
          label: "mz",
          xLabel: "t",
          xUnit: "s",
          yLabel: "mz",
          yUnit: "1",
          points: [{ x: 0, y: 1 }]
        }
      ],
      metrics: [],
      provenance: { createdAt: "", createdBy: "test", solver: "python_llg", notes: [] }
    });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    assert.equal(byId["m-field"].klass, "UNAVAILABLE");
    assert.equal(byId["mean-m"].klass, "SIMULATED");
    assert.equal(byId.resistance.klass, "MODEL");
  });

  it("never tags frontend-only or demo quantities as SIMULATED", () => {
    const rows = classifyDeviceObservables({
      source: "demo_fixture",
      isPhysicalSimulation: false,
      summary: "demo",
      series: [
        {
          id: "mz",
          label: "mz",
          xLabel: "t",
          xUnit: "s",
          yLabel: "mz",
          yUnit: "1",
          points: [{ x: 0, y: 1 }]
        }
      ],
      metrics: [],
      provenance: { createdAt: "", createdBy: "test", solver: "demo", notes: [] }
    });
    assert.ok(rows.every((row) => row.klass !== "SIMULATED"));
    assert.equal(rows.find((row) => row.id === "mean-m")?.klass, "DERIVED");
  });

  it("serializes a physical-parameter change into a new MuMax3 request without treating display mode as physics", () => {
    const base = createDefaultState();
    const { payload: before } = serializeSimulationRequest(base, "mumax3");
    base.solverDrafts.mumax3.dampingAlpha = { value: 0.03, unit: "dimensionless", source: "user" };
    const { payload: afterPhysics } = serializeSimulationRequest(base, "mumax3");
    assert.notEqual(afterPhysics.solverDrafts?.mumax3.dampingAlpha?.value, before.solverDrafts?.mumax3.dampingAlpha?.value);
    assert.equal("displayMode" in afterPhysics, false);
    const meshChanged = structuredClone(base);
    meshChanged.solverDrafts.mumax3.gridSize = { nx: 32, ny: 16, nz: 1 };
    const { payload: afterMesh } = serializeSimulationRequest(meshChanged, "mumax3");
    assert.deepEqual(afterMesh.geometry.freeLayerLength, before.geometry.freeLayerLength);
    assert.deepEqual(afterMesh.geometry.freeLayerWidth, before.geometry.freeLayerWidth);
    assert.notDeepEqual(afterMesh.solverDrafts?.mumax3.gridSize, before.solverDrafts?.mumax3.gridSize);
  });
});
