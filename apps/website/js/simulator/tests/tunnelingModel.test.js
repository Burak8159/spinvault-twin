import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ELECTRON_MASS,
  EV_TO_J,
  HBAR,
  calculateKappa,
  calculateTransmission,
  evaluateTunnelingModel,
  generatePotentialProfile,
  generateWavefunctionProfile,
  schrodingerPhaseRad
} from "../lib/tunnelingModel.js";

describe("tunnelingModel", () => {
  it("advances temporal phase according to the configured energy and Et/ħ", () => {
    const timeSeconds = 2.5e-15;
    const lowEnergyPhase = schrodingerPhaseRad(0.2, timeSeconds);
    const highEnergyPhase = schrodingerPhaseRad(0.4, timeSeconds);
    assert.ok(Math.abs(highEnergyPhase - 2 * lowEnergyPhase) < 1e-12);
    assert.ok(
      Math.abs(lowEnergyPhase - ((0.2 * EV_TO_J * timeSeconds) / HBAR) % (2 * Math.PI)) <
        1e-12
    );
  });

  it("keeps kappa positive for E < V", () => {
    const result = calculateKappa({
      barrierHeightEv: 1.5,
      electronEnergyEv: 0.3,
      effectiveMassRatio: 0.4
    });
    assert.equal(result.regime, "tunneling");
    assert.ok(result.kappa > 0);
  });

  it("handles the over-barrier case", () => {
    const result = calculateTransmission({
      barrierHeightEv: 0.4,
      electronEnergyEv: 1.0,
      barrierThicknessNm: 1,
      effectiveMassRatio: 0.4,
      spinPolarization: 0
    });
    assert.equal(result.regime, "over_barrier");
    assert.equal(result.kappa, 0);
    assert.ok(result.transmission > 0.5);
  });

  it("decreases tunneling probability when barrier thickness increases", () => {
    const thin = calculateTransmission({
      barrierThicknessNm: 0.6,
      barrierHeightEv: 1.2,
      electronEnergyEv: 0.25,
      spinPolarization: 0
    });
    const thick = calculateTransmission({
      barrierThicknessNm: 1.8,
      barrierHeightEv: 1.2,
      electronEnergyEv: 0.25,
      spinPolarization: 0
    });
    assert.ok(thick.transmission < thin.transmission);
  });

  it("decreases tunneling probability when barrier height increases", () => {
    const low = calculateTransmission({
      barrierThicknessNm: 1,
      barrierHeightEv: 0.8,
      electronEnergyEv: 0.25,
      spinPolarization: 0
    });
    const high = calculateTransmission({
      barrierThicknessNm: 1,
      barrierHeightEv: 2.0,
      electronEnergyEv: 0.25,
      spinPolarization: 0
    });
    assert.ok(high.transmission < low.transmission);
  });

  it("responds to energy, effective mass, and bias while conserving probability", () => {
    const base = {
      barrierThicknessNm: 1,
      barrierHeightEv: 1.2,
      electronEnergyEv: 0.25,
      effectiveMassRatio: 0.4,
      biasVolts: 0
    };
    const baseline = calculateTransmission(base);
    const higherEnergy = calculateTransmission({ ...base, electronEnergyEv: 0.5 });
    const heavierMass = calculateTransmission({ ...base, effectiveMassRatio: 0.8 });
    const biased = calculateTransmission({ ...base, biasVolts: 0.2 });
    assert.ok(higherEnergy.transmission > baseline.transmission);
    assert.ok(heavierMass.transmission < baseline.transmission);
    assert.notEqual(biased.transmission, baseline.transmission);
    for (const result of [baseline, higherEnergy, heavierMass, biased]) {
      assert.ok(Math.abs(result.probabilityConservation - 1) < 1e-6);
    }
  });

  it("places the probability peak and reports a TISE accuracy in (0,1]", () => {
    const wave = generateWavefunctionProfile({
      barrierThicknessNm: 1,
      barrierHeightEv: 1.2,
      electronEnergyEv: 0.25,
      biasVolts: 0
    });
    assert.ok(Number.isFinite(wave.peakXNm));
    assert.ok(wave.peakProb > 0);
    const peak = wave.points.reduce((best, point) => (point.prob > best.prob ? point : best));
    assert.equal(peak.xNm, wave.peakXNm);
    assert.ok(wave.points.every((point) => point.accuracy >= 0 && point.accuracy <= 1));
  });

  it("conserves current on the trapezoidal biased barrier", () => {
    const result = calculateTransmission({
      barrierThicknessNm: 1,
      barrierHeightEv: 1.2,
      electronEnergyEv: 0.25,
      biasVolts: 0.4,
      effectiveMassRatio: 0.4
    });
    assert.ok(Math.abs(result.probabilityConservation - 1) < 5e-4);
  });

  it("matches the closed-form rectangular-barrier transmission", () => {
    const params = {
      barrierThicknessNm: 1,
      barrierHeightEv: 1.2,
      electronEnergyEv: 0.25,
      effectiveMassRatio: 0.4,
      biasVolts: 0
    };
    const result = calculateTransmission(params);
    const mass = params.effectiveMassRatio * ELECTRON_MASS;
    const kappa =
      Math.sqrt(2 * mass * (params.barrierHeightEv - params.electronEnergyEv) * EV_TO_J) /
      HBAR;
    const expected =
      1 /
      (1 +
        (params.barrierHeightEv ** 2 * Math.sinh(kappa * params.barrierThicknessNm * 1e-9) ** 2) /
          (4 * params.electronEnergyEv * (params.barrierHeightEv - params.electronEnergyEv)));
    assert.ok(Math.abs(result.transmission - expected) < 1e-10);
    assert.ok(Math.abs(result.probabilityConservation - 1) < 1e-10);
  });

  it("generates potential and wave profiles from the equation model", () => {
    const potential = generatePotentialProfile({
      barrierThicknessNm: 1,
      barrierHeightEv: 1.2,
      electronEnergyEv: 0.25,
      biasVolts: 0.2
    });
    const wave = generateWavefunctionProfile({
      barrierThicknessNm: 1,
      barrierHeightEv: 1.2,
      electronEnergyEv: 0.25,
      biasVolts: 0.2
    });
    assert.ok(potential.points.length > 40);
    assert.ok(wave.points.length > 40);
    assert.ok(potential.points.some((point) => point.region === "barrier"));
    assert.ok(wave.points.every((point) => Number.isFinite(point.probNorm)));
  });

  it("labels placeholders and rejects fake experimental validation claims", () => {
    const model = evaluateTunnelingModel({
      barrierThicknessNm: 1,
      spinState: 0,
      spinPolarization: 0.5
    });
    assert.ok(model.placeholders.some((item) => /placeholder/i.test(item)));
    assert.match(model.honesty, /Not experimentally validated/i);
    assert.doesNotMatch(model.honesty, /is experimentally validated|product retention rating achieved/i);
    const other = evaluateTunnelingModel({
      barrierThicknessNm: 1,
      spinState: 1,
      spinPolarization: 0.5
    });
    assert.equal(model.transmission, other.transmission);
    assert.match(model.formula, /ψI=.*continu/i);
  });
});
