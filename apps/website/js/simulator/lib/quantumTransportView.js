import { calculateTransmission as calculateTransmissionVersioned, evaluateTunnelingModel as evaluateTunnelingModelVersioned } from "./tunnelingModel.js";

/** @type {typeof import("./tunnelingModel.js").calculateTransmission} */
const calculateTransmission = calculateTransmissionVersioned;
/** @type {typeof import("./tunnelingModel.js").evaluateTunnelingModel} */
const evaluateTunnelingModel = evaluateTunnelingModelVersioned;

/**
 * Stable integration boundary for future Kwant transport results.
 * Until all required Kwant series exist, this returns the exact analytical
 * finite-rectangular-barrier Schrödinger solution.
 *
 * Expected future series:
 * - transmission T(E)
 * - barrier profile V(x)
 * - probability density |psi|^2
 *
 * @param {{
 *   result?: import("./types").SimulationResult | null,
 *   analyticalParams: Parameters<typeof evaluateTunnelingModel>[0]
 * }} input
 */
export function buildQuantumTransportView(input) {
  const series = input.result?.source === "kwant" ? input.result.series ?? [] : [];
  const transmissionSeries = series.find((item) => /transmission|t\(e\)/i.test(`${item.id} ${item.label}`));
  const potentialSeries = series.find((item) => /potential|v\(x\)|barrier/i.test(`${item.id} ${item.label}`));
  const probabilitySeries = series.find((item) => /probability|psi|wavefunction/i.test(`${item.id} ${item.label}`));

  if (transmissionSeries && potentialSeries && probabilitySeries) {
    return {
      source: /** @type {const} */ ("kwant"),
      label: "Kwant transport result",
      pending: false,
      transmissionEnergy: transmissionSeries.points,
      potentialProfile: potentialSeries.points,
      probabilityDensity: probabilitySeries.points,
      leakageMetric: input.result?.metrics.find((metric) => /leak/i.test(metric.id)) ?? null,
      retentionMetric: input.result?.metrics.find((metric) => /retention/i.test(metric.id)) ?? null,
      note: "Displayed from returned Kwant-sourced series; interpretation depends on backend provenance."
    };
  }

  const analytical = evaluateTunnelingModel(input.analyticalParams);
  const maxEnergy = Math.max(analytical.params.barrierHeightEv * 1.5, analytical.params.electronEnergyEv, 0.5);
  const transmissionEnergy = Array.from({ length: 61 }, (_, index) => {
    const energyEv = (maxEnergy * index) / 60;
    return {
      x: energyEv,
      y: calculateTransmission({
        ...input.analyticalParams,
        electronEnergyEv: Math.max(0.01, energyEv)
      }).transmission
    };
  });
  return {
    source: /** @type {const} */ ("analytical_schrodinger"),
    label: "1D barrier Schrödinger scattering solution",
    pending: true,
    transmissionEnergy,
    potentialProfile: analytical.potential.points.map((point) => ({ x: point.xNm, y: point.Vev })),
    probabilityDensity: analytical.wavePoints.map((point) => ({ x: point.xNm, y: point.probNorm })),
    leakageMetric: null,
    retentionMetric: null,
    note:
      "T(E), V(x), and |psi|² solve the stated 1D finite-barrier boundary problem. Leakage, retention, TMR, and resistance remain unavailable."
  };
}
