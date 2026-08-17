import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ATTEMPT_TIME_SECONDS,
  BOLTZMANN,
  MU_0,
  SECONDS_PER_YEAR,
  criticalCurrentDensity,
  effectiveAnisotropy,
  evaluateDevicePhysics,
  freeLayerVolumeM3,
  julliereTransport,
  retentionFromDelta,
  sttEfficiency,
  supplyFunction,
  thermalStability,
  tunnelCurrentDensity
} from "../lib/devicePhysics.js";

const baseDevice = {
  barrierThicknessNm: 1.0,
  // Absolute barrier top on the shared energy axis; the Fermi level sits below it.
  barrierHeightEv: 1.2,
  fermiEv: 0.8,
  effectiveMassRatio: 0.4,
  biasVolts: 0.1,
  temperatureK: 300,
  junctionAreaNm2: Math.PI / 4 * 60 * 40,
  anisotropyJPerM3: 5e5,
  freeLengthNm: 60,
  freeWidthNm: 40,
  freeThicknessNm: 1.2,
  spinPolarization: 0.6,
  cosTheta: 1
};

describe("free-layer volume", () => {
  it("uses the elliptical footprint by default and the rectangle when asked", () => {
    const ellipse = freeLayerVolumeM3({ lengthNm: 60, widthNm: 40, thicknessNm: 1.2 });
    const rectangle = freeLayerVolumeM3({
      lengthNm: 60,
      widthNm: 40,
      thicknessNm: 1.2,
      shape: "rectangle"
    });
    assert.ok(Math.abs(rectangle - 60e-9 * 40e-9 * 1.2e-9) / rectangle < 1e-12);
    assert.ok(Math.abs(ellipse / rectangle - Math.PI / 4) < 1e-12);
  });
});

describe("effective perpendicular anisotropy", () => {
  it("subtracts the thin-film demagnetizing term only for a perpendicular easy axis", () => {
    const ms = 1e6;
    const shape = (MU_0 * ms * ms) / 2;
    const perpendicular = effectiveAnisotropy({
      anisotropyJPerM3: 8e5,
      saturationMagnetizationAPerM: ms
    });
    assert.ok(Math.abs(perpendicular.shapeTermJPerM3 - shape) / shape < 1e-12);
    assert.ok(Math.abs(perpendicular.effectiveJPerM3 - (8e5 - shape)) / perpendicular.effectiveJPerM3 < 1e-12);
    assert.equal(perpendicular.losesPerpendicularEasyAxis, false);

    const inPlane = effectiveAnisotropy({
      anisotropyJPerM3: 8e5,
      saturationMagnetizationAPerM: ms,
      easyAxis: "in_plane"
    });
    assert.equal(inPlane.shapeTermJPerM3, 0);
    assert.equal(inPlane.effectiveJPerM3, 8e5);
  });

  it("flags a film whose shape anisotropy defeats the uniaxial constant", () => {
    const weak = effectiveAnisotropy({
      anisotropyJPerM3: 2e5,
      saturationMagnetizationAPerM: 1e6
    });
    assert.equal(weak.losesPerpendicularEasyAxis, true);
    assert.equal(weak.effectiveJPerM3, 0);
    // A lost easy axis must not be reported as a stable bit.
    const chain = evaluateDevicePhysics({
      ...baseDevice,
      anisotropyJPerM3: 2e5,
      saturationMagnetizationAPerM: 1e6
    });
    assert.equal(chain.stability.delta, 0);
    assert.equal(chain.retention.meetsTenYearRetention, false);
  });

  it("lowers the reported barrier once the demagnetizing term is included", () => {
    const withMs = evaluateDevicePhysics({ ...baseDevice, saturationMagnetizationAPerM: 1e6 });
    const withoutMs = evaluateDevicePhysics({ ...baseDevice, saturationMagnetizationAPerM: 0 });
    assert.ok(withMs.stability.delta < withoutMs.stability.delta);
  });
});

describe("thermal stability and Neel-Arrhenius retention", () => {
  it("reproduces Delta = K V / kT exactly", () => {
    const volumeM3 = freeLayerVolumeM3({ lengthNm: 60, widthNm: 40, thicknessNm: 1.2 });
    const stability = thermalStability({
      anisotropyJPerM3: 5e5,
      volumeM3,
      temperatureK: 300
    });
    const expected = (5e5 * volumeM3) / (BOLTZMANN * 300);
    assert.ok(Math.abs(stability.delta - expected) / expected < 1e-12);
    assert.ok(Math.abs(stability.energyBarrierJ - 5e5 * volumeM3) / stability.energyBarrierJ < 1e-12);
  });

  it("scales retention exponentially and responds to temperature", () => {
    const cold = thermalStability({ anisotropyJPerM3: 5e5, volumeM3: 1e-24, temperatureK: 250 });
    const hot = thermalStability({ anisotropyJPerM3: 5e5, volumeM3: 1e-24, temperatureK: 400 });
    assert.ok(cold.delta > hot.delta, "lower temperature must be more stable");

    const tau = retentionFromDelta(40);
    const expectedTau = ATTEMPT_TIME_SECONDS * Math.exp(40);
    assert.ok(Math.abs(tau.tauSeconds - expectedTau) / expectedTau < 1e-9);
    assert.ok(Math.abs(tau.tauYears - expectedTau / SECONDS_PER_YEAR) / tau.tauYears < 1e-9);

    // With a 1 ns attempt time, Delta = 40 is tau ~ 7.4 years, just short of ten.
    assert.ok(tau.tauYears > 7 && tau.tauYears < 8, `tau was ${tau.tauYears} years`);
    assert.equal(tau.meetsTenYearRetention, false);
    assert.equal(retentionFromDelta(41).meetsTenYearRetention, true);
    assert.equal(retentionFromDelta(30).meetsTenYearRetention, false);
    assert.ok(retentionFromDelta(30).flipProbability > retentionFromDelta(60).flipProbability);
  });

  it("stays finite for a barrier far above the overflow limit", () => {
    const huge = retentionFromDelta(5000);
    assert.equal(huge.tauSeconds, Infinity);
    assert.equal(huge.flipProbability, 0);
    assert.equal(huge.meetsTenYearRetention, true);
    const none = retentionFromDelta(0);
    assert.ok(Number.isFinite(none.tauSeconds));
    assert.ok(none.flipProbability > 0.99);
  });
});

describe("Tsu-Esaki tunnel current", () => {
  it("has the sign and vanishing-bias behaviour of the supply function", () => {
    assert.ok(supplyFunction(0.5, 0.8, 0.5, 300) > 0);
    assert.ok(Math.abs(supplyFunction(0.5, 0.8, 0, 300)) < 1e-12);
    assert.ok(supplyFunction(0.5, 0.8, -0.5, 300) < 0);
  });

  it("reports the tunneling regime only when the barrier tops the Fermi level", () => {
    assert.equal(tunnelCurrentDensity(baseDevice).regime, "tunneling");
    assert.equal(
      tunnelCurrentDensity({ ...baseDevice, barrierHeightEv: 0.4 }).regime,
      "over_barrier"
    );
    assert.ok(
      tunnelCurrentDensity({ ...baseDevice, barrierHeightEv: 0.4 }).currentDensityAPerM2 >
        tunnelCurrentDensity(baseDevice).currentDensityAPerM2
    );
  });

  it("falls off exponentially with barrier thickness", () => {
    const thin = tunnelCurrentDensity({ ...baseDevice, barrierThicknessNm: 0.8 });
    const thick = tunnelCurrentDensity({ ...baseDevice, barrierThicknessNm: 1.6 });
    assert.ok(thin.currentDensityAPerM2 > thick.currentDensityAPerM2 * 10,
      `expected strong thickness dependence, got ${thin.currentDensityAPerM2} vs ${thick.currentDensityAPerM2}`);
  });

  it("falls off with barrier height and rises with bias", () => {
    const low = tunnelCurrentDensity({ ...baseDevice, barrierHeightEv: 0.8 });
    const high = tunnelCurrentDensity({ ...baseDevice, barrierHeightEv: 2.4 });
    assert.ok(low.currentDensityAPerM2 > high.currentDensityAPerM2);

    const small = tunnelCurrentDensity({ ...baseDevice, biasVolts: 0.05 });
    const large = tunnelCurrentDensity({ ...baseDevice, biasVolts: 0.4 });
    assert.ok(large.currentDensityAPerM2 > small.currentDensityAPerM2);
  });
});

describe("Julliere angular magnetoresistance", () => {
  it("matches the closed-form TMR and orders R_P below R_AP", () => {
    const transport = julliereTransport({
      conductanceAvgS: 1e-3,
      polarizationFree: 0.6,
      cosTheta: 1
    });
    const product = 0.36;
    assert.ok(Math.abs(transport.tmrRatio - (2 * product) / (1 - product)) < 1e-12);
    assert.ok(transport.resistanceParallelOhm < transport.resistanceAntiparallelOhm);
    assert.ok(Math.abs(transport.resistanceOhm - transport.resistanceParallelOhm) < 1e-12);
  });

  it("varies continuously with the junction angle from the solver", () => {
    const at = (cosTheta) =>
      julliereTransport({ conductanceAvgS: 1e-3, polarizationFree: 0.6, cosTheta }).resistanceOhm;
    assert.ok(at(1) < at(0));
    assert.ok(at(0) < at(-1));
    assert.ok(Math.abs(at(0) - 1e3) < 1e-9, "unpolarized angle must give the average conductance");
  });

  it("collapses TMR to zero without polarization", () => {
    const transport = julliereTransport({
      conductanceAvgS: 1e-3,
      polarizationFree: 0,
      cosTheta: -1
    });
    assert.equal(transport.tmrRatio, 0);
    assert.equal(transport.resistanceParallelOhm, transport.resistanceAntiparallelOhm);
  });
});

describe("coupled device chain", () => {
  it("shares one magnetization angle between retention, leakage, and resistance", () => {
    const parallel = evaluateDevicePhysics(baseDevice);
    const antiparallel = evaluateDevicePhysics({ ...baseDevice, cosTheta: -1 });

    assert.ok(parallel.stability.delta > 0);
    assert.ok(parallel.leakage.currentA > 0);
    assert.ok(parallel.transport.resistanceOhm < antiparallel.transport.resistanceOhm,
      "P state must conduct better than AP");
    // Retention depends on the barrier energy, not on the junction angle.
    assert.equal(parallel.stability.delta, antiparallel.stability.delta);
    // The leakage current scales with the junction area.
    const doubled = evaluateDevicePhysics({
      ...baseDevice,
      junctionAreaNm2: baseDevice.junctionAreaNm2 * 2
    });
    assert.ok(Math.abs(doubled.leakage.currentA / parallel.leakage.currentA - 2) < 1e-9);
  });

  it("responds to every physical input that should matter", () => {
    const base = evaluateDevicePhysics(baseDevice);
    const hotter = evaluateDevicePhysics({ ...baseDevice, temperatureK: 400 });
    const softer = evaluateDevicePhysics({ ...baseDevice, anisotropyJPerM3: 2e5 });
    const thicker = evaluateDevicePhysics({ ...baseDevice, barrierThicknessNm: 1.8 });

    assert.ok(hotter.stability.delta < base.stability.delta);
    assert.ok(softer.stability.delta < base.stability.delta);
    assert.ok(softer.retention.tauSeconds < base.retention.tauSeconds);
    assert.ok(thicker.leakage.currentA < base.leakage.currentA);
  });

  it("reports a Slonczewski threshold that scales with thickness and damping", () => {
    assert.equal(sttEfficiency(0.6, 1, 0), 0.3);
    const base = evaluateDevicePhysics({
      ...baseDevice,
      anisotropyJPerM3: 8e5,
      dampingAlpha: 0.01,
      currentDensityAPerM2: 2e11,
      saturationMagnetizationAPerM: 1e6
    });
    const thicker = evaluateDevicePhysics({
      ...baseDevice,
      anisotropyJPerM3: 8e5,
      dampingAlpha: 0.01,
      currentDensityAPerM2: 2e11,
      saturationMagnetizationAPerM: 1e6,
      freeThicknessNm: 2.4
    });
    assert.ok(base.stt.criticalCurrentAPerM2 > 0);
    assert.ok(Math.abs(thicker.stt.criticalCurrentAPerM2 / base.stt.criticalCurrentAPerM2 - 2) < 1e-9);
    const jc0 = criticalCurrentDensity({
      alpha: 0.01,
      kEff: base.anisotropy.effectiveJPerM3,
      thicknessM: 1.2e-9,
      polarization: 0.6
    });
    assert.ok(Math.abs(base.stt.criticalCurrentAPerM2 - jc0) / jc0 < 1e-12);
    assert.equal(base.stt.belowThreshold, 2e11 < jc0);
  });
});
