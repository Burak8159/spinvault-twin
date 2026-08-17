import { accuracyColor } from "./mtjViewportLayout.js";

const PSI_COLOR = "#5ec8ff";
const PROB_COLOR = "#ffd27a";
const POTENTIAL_COLOR = "#c4a5ff";
const ENERGY_COLOR = "#8ce0be";

/**
 * Text-free plot of the exact 1D finite-barrier stationary scattering state.
 *
 * Every curve shares one linear position axis in nanometres, so the barrier
 * width, the wavelengths on both sides, and the evanescent decay length are all
 * drawn to the same scale and ψ stays continuous across both interfaces.
 * Labels and numbers are rendered in the surrounding HTML board.
 *
 * @param {SVGSVGElement} svg
 * @param {ReturnType<import("../lib/tunnelingModel").evaluateTunnelingModel>} model
 * @param {{
 *   scale?: "atomic" | "cell" | "energy",
 *   title?: string,
 *   geometry?: import("../lib/types").DeviceGeometry,
 *   transportSource?: string,
 *   variant?: "desktop" | "compact",
 *   phaseRad?: number,
 *   physicalTimeSeconds?: number,
 *   physicalSecondsPerDisplaySecond?: number
 * }} [options]
 */
export function renderWaveView(svg, model, options = {}) {
  const compact = options.variant === "compact";
  const width = compact ? 420 : 1280;
  const height = compact ? 560 : 720;
  const NS = "http://www.w3.org/2000/svg";
  /**
   * @param {string} name
   * @param {Record<string, string | number>} [attrs]
   */
  const el = (name, attrs = {}) => {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };

  const plot = compact
    ? { x: 0, y: 0, w: 420, h: 560 }
    : { x: 0, y: 0, w: 1280, h: 720 };
  // Vertical split: potential/energy panel on top, wavefunction panel below.
  const energyPanel = { y: plot.y, h: plot.h * 0.3 };
  const wavePanel = { y: plot.y + plot.h * 0.36, h: plot.h * 0.42 };
  const densityPanel = { y: plot.y + plot.h * 0.82, h: plot.h * 0.18 };

  const potentialPoints = model.potential.points;
  const xMinNm = model.potential.xMinNm;
  const xMaxNm = model.potential.xMaxNm;
  const spanNm = Math.max(1e-9, xMaxNm - xMinNm);
  /** @param {number} xNm */
  const xAt = (xNm) => plot.x + ((xNm - xMinNm) / spanNm) * plot.w;

  const barrierNm = model.params.barrierThicknessNm;
  const xBarrierStart = xAt(0);
  const xBarrierEnd = xAt(barrierNm);

  const phaseRad = Number.isFinite(options.phaseRad) ? Number(options.phaseRad) : 0;
  const phaseCos = Math.cos(phaseRad);
  const phaseSin = Math.sin(phaseRad);
  const maxWaveMagnitude = Math.max(
    ...model.wavePoints.map((point) => Math.hypot(point.psiRe, point.psiIm)),
    1e-12
  );

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Exact one-dimensional finite-barrier stationary scattering solution on a shared ${xMinNm.toFixed(2)} to ${xMaxNm.toFixed(2)} nanometre axis. ` +
      `Transmission ${model.transmission.toExponential(3)}, reflection ${model.reflection.toExponential(3)}.`
  );
  svg.replaceChildren();

  const root = el("g", {
    class: "sv-wave-field",
    "data-view-variant": compact ? "compact" : "desktop",
    "data-phase-rad": phaseRad.toFixed(6),
    "data-x-min-nm": xMinNm.toFixed(4),
    "data-x-max-nm": xMaxNm.toFixed(4),
    "data-peak-x-nm": Number(model.peakXNm ?? 0).toFixed(4)
  });
  const body = el("g", { "data-cell-body": "wave", "data-render-dimension": "2d" });

  // Region backgrounds sit at true positions on the shared axis.
  body.append(
    el("rect", {
      x: plot.x,
      y: plot.y,
      width: Math.max(0, xBarrierStart - plot.x),
      height: plot.h,
      fill: "#0f2a40",
      "data-region-band": "left"
    }),
    el("rect", {
      x: xBarrierStart,
      y: plot.y,
      width: Math.max(0, xBarrierEnd - xBarrierStart),
      height: plot.h,
      fill: "#2c2140",
      stroke: POTENTIAL_COLOR,
      "stroke-width": 1.2,
      "data-region-band": "barrier",
      "data-barrier-width-nm": barrierNm.toFixed(4)
    }),
    el("rect", {
      x: xBarrierEnd,
      y: plot.y,
      width: Math.max(0, plot.x + plot.w - xBarrierEnd),
      height: plot.h,
      fill: "#12332a",
      "data-region-band": "right"
    })
  );

  // Potential energy V(x) and the electron energy E share one eV axis.
  const energies = [
    ...potentialPoints.map((point) => point.Vev),
    model.params.electronEnergyEv,
    0
  ];
  const vMin = Math.min(...energies);
  const vMax = Math.max(...energies);
  const vSpan = Math.max(1e-6, vMax - vMin);
  /** @param {number} ev */
  const yEnergy = (ev) => energyPanel.y + energyPanel.h - ((ev - vMin) / vSpan) * energyPanel.h;

  const potentialPath = potentialPoints
    .map((point, index) => `${index ? "L" : "M"} ${round(xAt(point.xNm))} ${round(yEnergy(point.Vev))}`)
    .join(" ");
  body.append(
    el("path", {
      d: potentialPath,
      fill: "none",
      stroke: POTENTIAL_COLOR,
      "stroke-width": 2.4,
      "data-curve": "potential-vx"
    }),
    el("line", {
      x1: plot.x,
      y1: round(yEnergy(model.params.electronEnergyEv)),
      x2: plot.x + plot.w,
      y2: round(yEnergy(model.params.electronEnergyEv)),
      stroke: ENERGY_COLOR,
      "stroke-width": 1.6,
      "stroke-dasharray": "8 5",
      "data-curve": "electron-energy",
      "data-energy-ev": model.params.electronEnergyEv.toFixed(4)
    })
  );

  // Re[psi(x,t)] as one continuous path across all three regions.
  const waveBaseline = wavePanel.y + wavePanel.h / 2;
  const waveAmplitude = wavePanel.h * 0.46;
  const wavePath = model.wavePoints
    .map((point, index) => {
      // Re[psi(x) e^(-iEt/hbar)] = Re(psi)cos(Et/hbar) + Im(psi)sin(Et/hbar).
      const value = (point.psiRe * phaseCos + point.psiIm * phaseSin) / maxWaveMagnitude;
      return `${index ? "L" : "M"} ${round(xAt(point.xNm))} ${round(waveBaseline - value * waveAmplitude)}`;
    })
    .join(" ");
  const envelopePath = model.wavePoints
    .map((point, index) => {
      const value = Math.hypot(point.psiRe, point.psiIm) / maxWaveMagnitude;
      return `${index ? "L" : "M"} ${round(xAt(point.xNm))} ${round(waveBaseline - value * waveAmplitude)}`;
    })
    .join(" ");
  body.append(
    el("line", {
      x1: plot.x,
      y1: round(waveBaseline),
      x2: plot.x + plot.w,
      y2: round(waveBaseline),
      stroke: "#40546b",
      "stroke-width": 1,
      "data-curve": "wave-axis"
    }),
    el("path", {
      d: envelopePath,
      fill: "none",
      stroke: PSI_COLOR,
      "stroke-width": 1,
      "stroke-dasharray": "3 4",
      opacity: 0.55,
      "data-curve": "wave-envelope",
      "data-stationary": "true"
    }),
    el("path", {
      d: wavePath,
      fill: "none",
      stroke: PSI_COLOR,
      "stroke-width": compact ? 2 : 2.6,
      "data-curve": "wavefunction"
    })
  );

  // |psi|^2 is stationary for a stationary scattering state.
  const densityBase = densityPanel.y + densityPanel.h;
  const densityPath = model.wavePoints
    .map((point, index) => {
      const y = densityBase - clamp01(point.probNorm) * densityPanel.h;
      return `${index ? "L" : "M"} ${round(xAt(point.xNm))} ${round(y)}`;
    })
    .join(" ");
  body.append(
    el("path", {
      d: densityPath,
      fill: "none",
      stroke: PROB_COLOR,
      "stroke-width": 1.9,
      "data-curve": "probability-density",
      "data-stationary": "true"
    })
  );

  const peakXNm = Number(model.peakXNm);
  const peakX = xAt(Number.isFinite(peakXNm) ? peakXNm : 0);
  body.append(
    el("line", {
      x1: round(peakX),
      y1: plot.y,
      x2: round(peakX),
      y2: plot.y + plot.h,
      stroke: "#fff4c4",
      "stroke-width": 1.4,
      "stroke-dasharray": "5 4",
      "data-peak-marker": "true",
      "data-peak-x-nm": Number.isFinite(peakXNm) ? peakXNm.toFixed(4) : "0"
    })
  );

  const arrowStride = compact ? 10 : 8;
  const arrowLen = compact ? 22 : 36;
  for (let index = 1; index < model.wavePoints.length - 1; index += arrowStride) {
    const point = model.wavePoints[index];
    const x = xAt(point.xNm);
    const y = waveBaseline;
    const dx = peakX - x;
    const dist = Math.abs(dx);
    if (dist < 8) continue;
    const signed = Math.sign(dx) * Math.min(arrowLen, dist - 6);
    const accuracy = Number.isFinite(point.accuracy) ? point.accuracy : point.probNorm;
    const color = accuracyColor(accuracy);
    const end = x + signed;
    const head = signed > 0 ? -7 : 7;
    body.append(
      el("line", {
        x1: round(x),
        y1: round(y),
        x2: round(end),
        y2: round(y),
        stroke: color,
        "stroke-width": 2.2,
        "data-probability-arrow": "true",
        "data-accuracy": Number(accuracy).toFixed(4),
        "data-peak-x-nm": Number.isFinite(peakXNm) ? peakXNm.toFixed(4) : "0"
      }),
      el("polygon", {
        points: `${round(end)},${round(y)} ${round(end + head)},${round(y - 4)} ${round(end + head)},${round(y + 4)}`,
        fill: color,
        "data-probability-arrowhead": "true"
      })
    );
  }

  // Flux-amplitude arrows: lengths track the solved amplitudes, not decoration.
  const reflectedAmplitude = Math.sqrt(Math.max(0, model.reflection));
  const transmittedAmplitude = Math.sqrt(Math.max(0, model.transmission));
  const leftWidth = Math.max(24, xBarrierStart - plot.x);
  const rightWidth = Math.max(24, plot.x + plot.w - xBarrierEnd);
  const flowMax = Math.min(compact ? 88 : 190, leftWidth * 0.8);
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} dx
   * @param {string} id
   * @param {string} color
   * @param {number} amplitude
   */
  const drawFlow = (x, y, dx, id, color, amplitude) => {
    const end = x + dx;
    const head = dx > 0 ? -8 : 8;
    body.append(
      el("line", {
        x1: round(x),
        y1: round(y),
        x2: round(end),
        y2: round(y),
        stroke: color,
        "stroke-width": 2.6,
        "data-flow-component": id,
        "data-amplitude": amplitude.toExponential(3)
      }),
      el("polygon", {
        points: `${round(end)},${round(y)} ${round(end + head)},${round(y - 4.5)} ${round(end + head)},${round(y + 4.5)}`,
        fill: color,
        "data-flow-head": id
      })
    );
  };
  const flowY = plot.y + plot.h * 0.325;
  drawFlow(plot.x + 12, flowY, flowMax, "incident", "#7cddff", 1);
  drawFlow(
    xBarrierStart - 12,
    flowY + (compact ? 14 : 20),
    -Math.max(10, flowMax * reflectedAmplitude),
    "reflected",
    "#ff9e8f",
    reflectedAmplitude
  );
  drawFlow(
    xBarrierEnd + 12,
    flowY,
    Math.max(10, Math.min(rightWidth * 0.8, flowMax) * transmittedAmplitude),
    "transmitted",
    "#72e0aa",
    transmittedAmplitude
  );

  root.append(body);

  // Position scale bar: one nanometre of true axis length, no text.
  const nmPerPx = spanNm / plot.w;
  const scaleY = plot.y + plot.h - (compact ? 8 : 12);
  const scaleGroup = el("g", { "data-scale-inset": "true" });
  scaleGroup.append(
    el("line", {
      x1: plot.x,
      y1: scaleY,
      x2: plot.x + 1 / nmPerPx,
      y2: scaleY,
      stroke: "#d8e3ef",
      "stroke-width": 2,
      "data-scale-bar-nm": "1"
    })
  );
  root.append(scaleGroup);

  svg.append(root);
}

/**
 * Update only the oscillating Re[ψ] path when the Hamiltonian has not changed.
 * @param {SVGSVGElement} svg
 * @param {ReturnType<import("../lib/tunnelingModel").evaluateTunnelingModel>} model
 * @param {{ phaseRad?: number, variant?: "desktop" | "compact" }} [options]
 */
export function updateWaveView(svg, model, options = {}) {
  const root = svg.querySelector(".sv-wave-field");
  if (!(root instanceof SVGElement)) {
    renderWaveView(svg, model, options);
    return;
  }
  const compact = options.variant === "compact";
  const expectedPeak = Number(model.peakXNm ?? 0).toFixed(4);
  if (root.getAttribute("data-peak-x-nm") !== expectedPeak) {
    renderWaveView(svg, model, options);
    return;
  }
  const plot = compact ? { x: 0, y: 0, w: 420, h: 560 } : { x: 0, y: 0, w: 1280, h: 720 };
  const wavePanel = { y: plot.y + plot.h * 0.36, h: plot.h * 0.42 };
  const xMinNm = model.potential.xMinNm;
  const spanNm = Math.max(1e-9, model.potential.xMaxNm - xMinNm);
  const phaseRad = Number.isFinite(options.phaseRad) ? Number(options.phaseRad) : 0;
  const phaseCos = Math.cos(phaseRad);
  const phaseSin = Math.sin(phaseRad);
  const maxWaveMagnitude = Math.max(
    ...model.wavePoints.map((point) => Math.hypot(point.psiRe, point.psiIm)),
    1e-12
  );
  const waveBaseline = wavePanel.y + wavePanel.h / 2;
  const waveAmplitude = wavePanel.h * 0.46;
  const wavePath = model.wavePoints
    .map((point, index) => {
      const value = (point.psiRe * phaseCos + point.psiIm * phaseSin) / maxWaveMagnitude;
      const x = plot.x + ((point.xNm - xMinNm) / spanNm) * plot.w;
      return `${index ? "L" : "M"} ${round(x)} ${round(waveBaseline - value * waveAmplitude)}`;
    })
    .join(" ");
  const curve = svg.querySelector('[data-curve="wavefunction"]');
  if (curve) curve.setAttribute("d", wavePath);
  root.setAttribute("data-phase-rad", phaseRad.toFixed(6));
}

/** @param {number} value */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** @param {number} value */
function round(value) {
  return Math.round(value * 100) / 100;
}
