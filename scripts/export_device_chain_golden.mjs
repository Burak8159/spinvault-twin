/**
 * Export golden retention/leakage values from the JavaScript device chain.
 *
 * The NumPy port in backend/app/physics/device_chain.py is asserted against
 * this file so the notebook and the web app can never quietly disagree.
 *
 * Regenerate with:
 *   node scripts/export_device_chain_golden.mjs > backend/tests/data/device_chain_golden.json
 */

import {
  effectiveAnisotropy,
  freeLayerVolumeM3,
  julliereTransport,
  retentionFromDelta,
  supplyFunction,
  thermalStability,
  tunnelCurrentDensity
} from "../apps/website/js/simulator/lib/devicePhysics.js";
import { calculateTransmission } from "../apps/website/js/simulator/lib/tunnelingModel.js";

const geometryCases = [
  { lengthNm: 40, widthNm: 40, thicknessNm: 1.2, shape: "ellipse" },
  { lengthNm: 40, widthNm: 40, thicknessNm: 1.2, shape: "rectangle" },
  { lengthNm: 60, widthNm: 30, thicknessNm: 2.0, shape: "ellipse" }
];

const anisotropyCases = [
  { anisotropyJPerM3: 8e5, saturationMagnetizationAPerM: 1e6, easyAxis: "perpendicular" },
  { anisotropyJPerM3: 8e5, saturationMagnetizationAPerM: 1e6, easyAxis: "in_plane" },
  { anisotropyJPerM3: 5e5, saturationMagnetizationAPerM: 1e6, easyAxis: "perpendicular" }
];

const stabilityCases = [
  { anisotropyJPerM3: 1.7e5, volumeM3: 1.5079644737231007e-24, temperatureK: 300 },
  { anisotropyJPerM3: 8e5, volumeM3: 1.5079644737231007e-24, temperatureK: 300 },
  { anisotropyJPerM3: 8e5, volumeM3: 1.5079644737231007e-24, temperatureK: 400 }
];

const deltaCases = [0, 10, 40, 60, 80, 200, 700, 720, 1500];

const supplyCases = [
  { energyEv: 0.2, fermiEv: 0.8, biasVolts: 0.0, temperatureK: 300 },
  { energyEv: 0.8, fermiEv: 0.8, biasVolts: 0.3, temperatureK: 300 },
  { energyEv: 1.4, fermiEv: 0.8, biasVolts: -0.3, temperatureK: 400 },
  { energyEv: 0.05, fermiEv: 0.8, biasVolts: 0.6, temperatureK: 77 }
];

const transmissionCases = [
  { barrierThicknessNm: 1.0, barrierHeightEv: 1.2, electronEnergyEv: 0.4, effectiveMassRatio: 0.4, biasVolts: 0, temperatureK: 300 },
  { barrierThicknessNm: 1.5, barrierHeightEv: 1.2, electronEnergyEv: 0.4, effectiveMassRatio: 0.4, biasVolts: 0, temperatureK: 300 },
  { barrierThicknessNm: 1.0, barrierHeightEv: 1.2, electronEnergyEv: 1.6, effectiveMassRatio: 0.4, biasVolts: 0, temperatureK: 300 },
  { barrierThicknessNm: 1.0, barrierHeightEv: 1.2, electronEnergyEv: 1.2, effectiveMassRatio: 0.4, biasVolts: 0, temperatureK: 300 },
  { barrierThicknessNm: 0.8, barrierHeightEv: 2.0, electronEnergyEv: 0.9, effectiveMassRatio: 0.8, biasVolts: 0, temperatureK: 300 }
];

const leakageCases = [
  { barrierThicknessNm: 1.0, barrierHeightEv: 1.2, effectiveMassRatio: 0.4, biasVolts: 0.1, temperatureK: 300, fermiEv: 0.8, energySamples: 33 },
  { barrierThicknessNm: 1.2, barrierHeightEv: 1.2, effectiveMassRatio: 0.4, biasVolts: 0.1, temperatureK: 300, fermiEv: 0.8, energySamples: 33 },
  { barrierThicknessNm: 1.0, barrierHeightEv: 1.2, effectiveMassRatio: 0.4, biasVolts: 0.4, temperatureK: 300, fermiEv: 0.8, energySamples: 65 },
  { barrierThicknessNm: 1.0, barrierHeightEv: 0.6, effectiveMassRatio: 0.4, biasVolts: 0.1, temperatureK: 300, fermiEv: 0.8, energySamples: 33 },
  { barrierThicknessNm: 1.0, barrierHeightEv: 1.2, effectiveMassRatio: 0.4, biasVolts: 0.1, temperatureK: 77, fermiEv: 0.8, energySamples: 33 }
];

const julliereCases = [
  { conductanceAvgS: 1e-4, polarizationFree: 0.6, cosTheta: 1 },
  { conductanceAvgS: 1e-4, polarizationFree: 0.6, cosTheta: -1 },
  { conductanceAvgS: 1e-4, polarizationFree: 0.6, cosTheta: 0.25 }
];

/** JSON cannot hold Infinity; mark it explicitly. */
function encode(value) {
  if (!Number.isFinite(value)) {
    return value > 0 ? "Infinity" : "-Infinity";
  }
  return value;
}

const golden = {
  generatedBy: "scripts/export_device_chain_golden.mjs",
  source: "apps/website/js/simulator/lib/devicePhysics.js",
  note: "Golden values for the NumPy port. Analytical models only; not measured device data.",
  volume: geometryCases.map((geometry) => ({
    input: geometry,
    volumeM3: freeLayerVolumeM3(geometry)
  })),
  anisotropy: anisotropyCases.map((input) => {
    const out = effectiveAnisotropy(input);
    return { input, effectiveJPerM3: out.effectiveJPerM3, shapeTermJPerM3: out.shapeTermJPerM3 };
  }),
  stability: stabilityCases.map((input) => {
    const out = thermalStability(input);
    return { input, energyBarrierJ: out.energyBarrierJ, energyBarrierEv: out.energyBarrierEv, delta: encode(out.delta) };
  }),
  retention: deltaCases.map((delta) => {
    const out = retentionFromDelta(delta);
    return {
      delta,
      tauSeconds: encode(out.tauSeconds),
      tauYears: encode(out.tauYears),
      flipProbability: out.flipProbability,
      meetsTenYearRetention: out.meetsTenYearRetention
    };
  }),
  supply: supplyCases.map((input) => ({
    input,
    supply: supplyFunction(input.energyEv, input.fermiEv, input.biasVolts, input.temperatureK)
  })),
  transmission: transmissionCases.map((input) => {
    const out = calculateTransmission(input);
    return { input, transmission: out.transmission, reflection: out.reflection, kappa: out.kappa, regime: out.regime };
  }),
  leakage: leakageCases.map((input) => {
    const out = tunnelCurrentDensity(input);
    return { input, currentDensityAPerM2: out.currentDensityAPerM2, regime: out.regime };
  }),
  julliere: julliereCases.map((input) => {
    const out = julliereTransport(input);
    return {
      input,
      conductanceS: out.conductanceS,
      resistanceOhm: encode(out.resistanceOhm),
      resistanceParallelOhm: encode(out.resistanceParallelOhm),
      resistanceAntiparallelOhm: encode(out.resistanceAntiparallelOhm),
      tmrRatio: encode(out.tmrRatio)
    };
  })
};

process.stdout.write(`${JSON.stringify(golden, null, 2)}\n`);
