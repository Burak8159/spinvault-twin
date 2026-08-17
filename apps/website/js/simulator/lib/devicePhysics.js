/**
 * One device chain, one set of equations.
 *
 * The same free-layer magnetization that the LLG solver produces sets the
 * junction angle, and the same 1D barrier that produces psi(x) in the Quantum
 * Wave view produces the tunnel current. Nothing here is fitted to measured
 * devices, and nothing is invented outside the stated equations:
 *
 *   1. Energy barrier and retention: Neel-Arrhenius / Neel-Brown macrospin.
 *        E_b = K_eff V,  Delta = E_b / (k_B T),  tau = tau_0 exp(Delta)
 *   2. Tunnel current: Tsu-Esaki supply function over the transmission T(E)
 *      returned by the 1D Schrodinger solution in tunnelingModel.js.
 *   3. Angular magnetoresistance: Julliere two-current model,
 *        G(theta) = G_avg (1 + P1 P2 cos theta),  TMR = 2 P1 P2 / (1 - P1 P2)
 *
 * Single-domain, single-band, zero-temperature-transport assumptions apply.
 * Barrier height, tunneling effective mass, and the Fermi level are
 * placeholders until reviewed values replace them.
 */

import { ELECTRON_CHARGE, ELECTRON_MASS, HBAR, calculateTransmission, eVToJoules } from "./tunnelingModel.js";

/** Boltzmann constant [J/K] */
export const BOLTZMANN = 1.380_649e-23;
/** Attempt time of the Neel-Brown model [s]. 1 ns is the conventional choice. */
export const ATTEMPT_TIME_SECONDS = 1e-9;
/** Seconds in a Julian year, for the ten-year retention comparison. */
export const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
/** Storage-class retention target used only as a reported comparison. */
export const TEN_YEAR_SECONDS = 10 * SECONDS_PER_YEAR;
/**
 * Lead Fermi level on the shared absolute energy axis [eV]. Placeholder: it
 * fixes which states carry the tunnel current and is not a reviewed value.
 */
export const DEFAULT_FERMI_EV = 0.8;

/**
 * @param {number | undefined | null} value
 * @param {number} fallback
 */
function finite(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

/**
 * Free-layer volume from the drawn footprint.
 * @param {{ lengthNm: number, widthNm: number, thicknessNm: number, shape?: "ellipse" | "rectangle" }} geometry
 */
export function freeLayerVolumeM3(geometry) {
  const l = Math.max(0, finite(geometry.lengthNm, 0)) * 1e-9;
  const w = Math.max(0, finite(geometry.widthNm, 0)) * 1e-9;
  const t = Math.max(0, finite(geometry.thicknessNm, 0)) * 1e-9;
  const area = geometry.shape === "rectangle" ? l * w : (Math.PI / 4) * l * w;
  return area * t;
}

/** Vacuum permeability [H/m] */
export const MU_0 = 4 * Math.PI * 1e-7;

/**
 * Effective perpendicular anisotropy of a thin film.
 *
 * The uniaxial constant alone overstates the barrier, because the film's own
 * demagnetizing field opposes an out-of-plane easy axis:
 *   K_eff = K_u1 - mu_0 M_s^2 / 2
 * An in-plane easy axis has no such shape penalty in this thin-film limit.
 *
 * @param {{
 *   anisotropyJPerM3: number,
 *   saturationMagnetizationAPerM: number,
 *   easyAxis?: "perpendicular" | "in_plane"
 * }} params
 */
export function effectiveAnisotropy(params) {
  const ku1 = finite(params.anisotropyJPerM3, 0);
  const ms = Math.max(0, finite(params.saturationMagnetizationAPerM, 0));
  const shapeTerm = params.easyAxis === "in_plane" ? 0 : (MU_0 * ms * ms) / 2;
  const kEff = ku1 - shapeTerm;
  return {
    anisotropyJPerM3: ku1,
    shapeTermJPerM3: shapeTerm,
    effectiveJPerM3: Math.max(0, kEff),
    losesPerpendicularEasyAxis: kEff <= 0,
    formula: "K_eff = K_u1 - mu_0 M_s^2 / 2 (thin-film demagnetizing correction)"
  };
}

/**
 * Neel-Arrhenius energy barrier and thermal stability factor.
 * @param {{ anisotropyJPerM3: number, volumeM3: number, temperatureK: number }} params
 */
export function thermalStability(params) {
  const kEff = Math.max(0, finite(params.anisotropyJPerM3, 0));
  const volume = Math.max(0, finite(params.volumeM3, 0));
  const temperature = Math.max(0, finite(params.temperatureK, 0));
  const energyBarrierJ = kEff * volume;
  const thermalEnergyJ = BOLTZMANN * temperature;
  const delta = thermalEnergyJ > 0 ? energyBarrierJ / thermalEnergyJ : Infinity;
  return {
    energyBarrierJ,
    energyBarrierEv: energyBarrierJ / ELECTRON_CHARGE,
    thermalEnergyJ,
    delta,
    formula: "E_b = K_eff V; Delta = E_b / (k_B T)"
  };
}

/**
 * Neel-Brown mean dwell time and the resulting bit-error probability.
 * @param {number} delta
 * @param {{ attemptTimeSeconds?: number, elapsedSeconds?: number }} [options]
 */
export function retentionFromDelta(delta, options = {}) {
  const attempt = Math.max(1e-15, finite(options.attemptTimeSeconds, ATTEMPT_TIME_SECONDS));
  const elapsed = Math.max(0, finite(options.elapsedSeconds, TEN_YEAR_SECONDS));
  if (!Number.isFinite(delta)) {
    return {
      delta,
      tauSeconds: Infinity,
      tauYears: Infinity,
      elapsedSeconds: elapsed,
      flipProbability: 0,
      meetsTenYearRetention: true,
      formula: "tau = tau_0 exp(Delta); P_flip = 1 - exp(-t/tau)"
    };
  }
  // exp() overflows near Delta ~ 710, so hold the log and convert once.
  const logTau = Math.log(attempt) + delta;
  const tauSeconds = Math.exp(Math.min(logTau, 709));
  const ratio = Math.exp(Math.min(Math.log(Math.max(elapsed, 1e-300)) - logTau, 709));
  const flipProbability = logTau > Math.log(Math.max(elapsed, 1e-300)) + 40 ? 0 : 1 - Math.exp(-ratio);
  return {
    delta,
    tauSeconds: logTau > 709 ? Infinity : tauSeconds,
    tauYears: logTau > 709 ? Infinity : tauSeconds / SECONDS_PER_YEAR,
    elapsedSeconds: elapsed,
    flipProbability: Math.min(1, Math.max(0, flipProbability)),
    meetsTenYearRetention: logTau >= Math.log(TEN_YEAR_SECONDS),
    formula: "tau = tau_0 exp(Delta); P_flip = 1 - exp(-t/tau)"
  };
}

/**
 * Tsu-Esaki supply function [J^-1 dimensionless weight] at energy E.
 * @param {number} energyEv
 * @param {number} fermiEv
 * @param {number} biasVolts
 * @param {number} temperatureK
 */
export function supplyFunction(energyEv, fermiEv, biasVolts, temperatureK) {
  const kT = BOLTZMANN * Math.max(1e-6, temperatureK);
  const left = (eVToJoules(fermiEv - energyEv)) / kT;
  const right = (eVToJoules(fermiEv - energyEv) - ELECTRON_CHARGE * biasVolts) / kT;
  /** @param {number} x */
  const log1pExp = (x) => (x > 30 ? x : Math.log1p(Math.exp(Math.min(x, 30))));
  return log1pExp(left) - log1pExp(right);
}

/**
 * Tunnel current density through the same 1D barrier used for psi(x).
 *
 * J = (q m* k_B T / 2 pi^2 hbar^3) * integral T(E) N(E) dE
 *
 * Energies share one absolute axis with the Quantum Wave view: zero is the left
 * lead band bottom, barrierHeightEv is the barrier top on that axis, and
 * fermiEv is the lead Fermi level on that same axis. Tunneling requires
 * fermiEv < barrierHeightEv; otherwise the occupied states pass over the
 * barrier and the reported regime says so instead of implying tunneling.
 *
 * @param {{
 *   barrierThicknessNm: number,
 *   barrierHeightEv: number,
 *   effectiveMassRatio: number,
 *   biasVolts: number,
 *   temperatureK: number,
 *   fermiEv?: number,
 *   energySamples?: number
 * }} params
 */
export function tunnelCurrentDensity(params) {
  const fermiEv = Math.max(0.05, finite(params.fermiEv, DEFAULT_FERMI_EV));
  const temperatureK = Math.max(1e-6, finite(params.temperatureK, 300));
  const biasVolts = finite(params.biasVolts, 0);
  const samples = Math.max(9, Math.round(finite(params.energySamples, 33)));
  const kT = (BOLTZMANN * temperatureK) / ELECTRON_CHARGE;
  const barrierTopEv = Math.max(0.01, finite(params.barrierHeightEv, 1.2));
  const eMaxEv = fermiEv + Math.abs(biasVolts) + 20 * kT;
  const eMinEv = 1e-4;
  const step = (eMaxEv - eMinEv) / (samples - 1);
  const mass = Math.max(0.01, finite(params.effectiveMassRatio, 0.4)) * ELECTRON_MASS;
  const prefactor =
    (ELECTRON_CHARGE * mass * BOLTZMANN * temperatureK) /
    (2 * Math.PI * Math.PI * HBAR * HBAR * HBAR);

  let integral = 0;
  /** @type {Array<{ energyEv: number, transmission: number, supply: number }>} */
  const spectrum = [];
  for (let index = 0; index < samples; index += 1) {
    const energyEv = eMinEv + index * step;
    const solved = calculateTransmission({
      barrierThicknessNm: params.barrierThicknessNm,
      barrierHeightEv: barrierTopEv,
      electronEnergyEv: energyEv,
      effectiveMassRatio: params.effectiveMassRatio,
      biasVolts,
      temperatureK
    });
    const supply = supplyFunction(energyEv, fermiEv, biasVolts, temperatureK);
    const weight = index === 0 || index === samples - 1 ? 0.5 : 1;
    integral += weight * solved.transmission * supply * eVToJoules(step);
    spectrum.push({ energyEv, transmission: solved.transmission, supply });
  }
  const currentDensity = prefactor * integral;
  return {
    currentDensityAPerM2: currentDensity,
    spectrum,
    fermiEv,
    barrierTopEv,
    barrierAboveFermiEv: barrierTopEv - fermiEv,
    regime: barrierTopEv > fermiEv ? /** @type {const} */ ("tunneling") : /** @type {const} */ ("over_barrier"),
    formula: "J = (q m* k_B T / 2 pi^2 hbar^3) * INT T(E) [ln(1+e^((E_F-E)/kT)) - ln(1+e^((E_F-E-qV)/kT))] dE",
    placeholders: [
      "fermiEv is a placeholder lead Fermi level, not a reviewed band-structure value.",
      "Single parabolic band with one transverse-mode supply function."
    ]
  };
}

/**
 * Julliere angular conductance around a spin-averaged conductance.
 * @param {{ conductanceAvgS: number, polarizationFree: number, polarizationRef?: number, cosTheta: number }} params
 */
export function julliereTransport(params) {
  const p1 = Math.min(0.999, Math.max(0, finite(params.polarizationFree, 0.4)));
  const p2 = Math.min(0.999, Math.max(0, finite(params.polarizationRef, p1)));
  const cosTheta = Math.min(1, Math.max(-1, finite(params.cosTheta, 1)));
  const gAvg = Math.max(0, finite(params.conductanceAvgS, 0));
  const product = p1 * p2;
  const conductance = gAvg * (1 + product * cosTheta);
  const conductanceP = gAvg * (1 + product);
  const conductanceAp = gAvg * (1 - product);
  /** @param {number} g */
  const toResistance = (g) => (g > 0 ? 1 / g : Infinity);
  return {
    polarizationFree: p1,
    polarizationRef: p2,
    cosTheta,
    conductanceS: conductance,
    resistanceOhm: toResistance(conductance),
    resistanceParallelOhm: toResistance(conductanceP),
    resistanceAntiparallelOhm: toResistance(conductanceAp),
    tmrRatio: product < 1 ? (2 * product) / (1 - product) : Infinity,
    formula: "G(theta) = G_avg (1 + P1 P2 cos theta); TMR = 2 P1 P2 / (1 - P1 P2)"
  };
}

/**
 * Slonczewski angular efficiency η(θ) = P Λ² / [(Λ²+1) + (Λ²-1) cosθ].
 * Λ = 1 is the symmetric limit η = P/2.
 * @param {number} polarization
 * @param {number} asymmetry
 * @param {number} cosTheta
 */
export function sttEfficiency(polarization, asymmetry, cosTheta) {
  const p = Math.min(1, Math.max(0, finite(polarization, 0)));
  const lam = Math.max(1e-9, finite(asymmetry, 1));
  const lam2 = lam * lam;
  const denom = lam2 + 1 + (lam2 - 1) * finite(cosTheta, 0);
  if (denom <= 0) return 0;
  return (p * lam2) / denom;
}

/**
 * Zero-temperature macrospin switching threshold
 *   Jc0 = 4 e α K_eff t / (ħ η0)
 * with η0 = η(cosθ = 0). Coherent rotation overestimates nucleation Jc.
 * @param {{
 *   alpha: number,
 *   kEff: number,
 *   thicknessM: number,
 *   polarization: number,
 *   asymmetry?: number
 * }} params
 */
export function criticalCurrentDensity(params) {
  const eta0 = sttEfficiency(params.polarization, params.asymmetry ?? 1, 0);
  const thickness = Math.max(0, finite(params.thicknessM, 0));
  const alpha = Math.max(0, finite(params.alpha, 0));
  const kEff = finite(params.kEff, 0);
  if (eta0 <= 0 || thickness <= 0) return Infinity;
  return (4 * ELECTRON_CHARGE * alpha * kEff * thickness) / (HBAR * eta0);
}

/**
 * Full chain for one device state: retention, leakage, and angular resistance.
 * cosTheta comes from the solved magnetization when a run is available.
 * @param {{
 *   barrierThicknessNm: number,
 *   barrierHeightEv: number,
 *   effectiveMassRatio: number,
 *   biasVolts: number,
 *   temperatureK: number,
 *   junctionAreaNm2: number,
 *   anisotropyJPerM3: number,
 *   saturationMagnetizationAPerM?: number,
 *   easyAxis?: "perpendicular" | "in_plane",
 *   freeLengthNm: number,
 *   freeWidthNm: number,
 *   freeThicknessNm: number,
 *   shape?: "ellipse" | "rectangle",
 *   spinPolarization: number,
 *   cosTheta: number,
 *   fermiEv?: number,
 *   retentionWindowSeconds?: number,
 *   dampingAlpha?: number,
 *   currentDensityAPerM2?: number
 * }} params
 */
export function evaluateDevicePhysics(params) {
  const volumeM3 = freeLayerVolumeM3({
    lengthNm: params.freeLengthNm,
    widthNm: params.freeWidthNm,
    thicknessNm: params.freeThicknessNm,
    shape: params.shape
  });
  const anisotropy = effectiveAnisotropy({
    anisotropyJPerM3: params.anisotropyJPerM3,
    saturationMagnetizationAPerM: finite(params.saturationMagnetizationAPerM, 0),
    easyAxis: params.easyAxis
  });
  const stability = thermalStability({
    anisotropyJPerM3: anisotropy.effectiveJPerM3,
    volumeM3,
    temperatureK: params.temperatureK
  });
  const retention = retentionFromDelta(stability.delta, {
    elapsedSeconds: params.retentionWindowSeconds ?? TEN_YEAR_SECONDS
  });
  const leakage = tunnelCurrentDensity(params);
  const areaM2 = Math.max(0, finite(params.junctionAreaNm2, 0)) * 1e-18;
  const currentA = leakage.currentDensityAPerM2 * areaM2;
  const biasVolts = finite(params.biasVolts, 0);
  // Spin-averaged conductance from the same barrier; Julliere splits it by angle.
  const conductanceAvgS = Math.abs(biasVolts) > 1e-9 ? Math.abs(currentA / biasVolts) : 0;
  const transport = julliereTransport({
    conductanceAvgS,
    polarizationFree: params.spinPolarization,
    cosTheta: params.cosTheta
  });
  const jc0 = criticalCurrentDensity({
    alpha: finite(params.dampingAlpha, 0.01),
    kEff: anisotropy.effectiveJPerM3,
    thicknessM: Math.max(0, finite(params.freeThicknessNm, 0)) * 1e-9,
    polarization: params.spinPolarization
  });
  const currentDensityAPerM2 = finite(params.currentDensityAPerM2, 0);
  const jOverJc0 = Number.isFinite(jc0) && jc0 > 0 ? Math.abs(currentDensityAPerM2) / jc0 : 0;
  return {
    volumeM3,
    conductanceAvgS,
    anisotropy,
    stability,
    retention,
    leakage: {
      ...leakage,
      currentA,
      areaM2,
      leakagePowerW: Math.abs(currentA * biasVolts)
    },
    stt: {
      currentDensityAPerM2,
      criticalCurrentAPerM2: jc0,
      jOverJc0,
      eta0: sttEfficiency(params.spinPolarization, 1, 0),
      belowThreshold: jOverJc0 > 0 && jOverJc0 < 1
    },
    transport,
    honesty:
      "Analytical device chain: Neel-Arrhenius retention, Tsu-Esaki tunnel current, Julliere magnetoresistance, and Slonczewski Jc0. Dynamics (STT write and Brown noise) are integrated in the Python LLGS solver, not here. Single-domain and single-band assumptions. Not calibrated."
  };
}
