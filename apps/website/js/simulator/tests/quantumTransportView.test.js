import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildQuantumTransportView } from "../lib/quantumTransportView.js";

const analyticalParams = {
  barrierThicknessNm: 1,
  barrierHeightEv: 1.2,
  electronEnergyEv: 0.25,
  effectiveMassRatio: 0.4,
  biasVolts: 0,
  temperatureK: 300,
  cellAreaNm2: 3200,
  spinState: /** @type {0 | 1} */ (0),
  spinPolarization: 0.4
};

describe("quantum transport integration boundary", () => {
  it("provides exact analytical finite-barrier T(E), V(x), and |psi|² data", () => {
    const view = buildQuantumTransportView({ analyticalParams });
    assert.equal(view.source, "analytical_schrodinger");
    assert.equal(view.pending, true);
    assert.ok(view.transmissionEnergy.length > 20);
    assert.ok(view.potentialProfile.length > 20);
    assert.ok(view.probabilityDensity.length > 20);
    assert.match(view.note, /solve/i);
    assert.match(view.note, /unavailable/i);
    assert.equal(view.leakageMetric, null);
    assert.equal(view.retentionMetric, null);
  });

  it("uses returned Kwant series only when the complete interface is present", () => {
    const series = [
      {
        id: "transmission-energy",
        label: "Transmission T(E)",
        xLabel: "Energy",
        xUnit: "eV",
        yLabel: "T",
        yUnit: "dimensionless",
        points: [{ x: 0.2, y: 0.01 }]
      },
      {
        id: "barrier-potential",
        label: "Potential V(x)",
        xLabel: "x",
        xUnit: "nm",
        yLabel: "V",
        yUnit: "eV",
        points: [{ x: 0, y: 1.2 }]
      },
      {
        id: "probability-density",
        label: "|psi|^2",
        xLabel: "x",
        xUnit: "nm",
        yLabel: "probability",
        yUnit: "dimensionless",
        points: [{ x: 0, y: 1 }]
      }
    ];
    const view = buildQuantumTransportView({
      analyticalParams,
      result: /** @type {import("../lib/types").SimulationResult} */ ({
        source: "kwant",
        series,
        metrics: []
      })
    });
    assert.equal(view.source, "kwant");
    assert.equal(view.pending, false);
    assert.equal(view.transmissionEnergy, series[0].points);
  });
});
