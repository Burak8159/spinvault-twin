/**
 * Paper-style MuMax3 scientific simulation board (panels A–E).
 * Uses real OVF/table data only; empty panels stay empty.
 */

import { getOvfFrame } from "../../api/client.js";
import { buildScientificPlot, scientificAxisMarkup } from "../lib/charts.js";
import { julliereTransport } from "../lib/devicePhysics.js";
import { mzColor } from "./mtjViewportLayout.js";
import { downsampleOvfVectors } from "./viewport.js";
import { buildScientificBoardModel } from "../lib/scientificBoardModel.js";
import { provenanceBadge } from "../lib/deviceObservables.js";

export const DEFAULT_SCIENTIFIC_BOARD_OPEN = true;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {string} name
 * @param {Record<string, string | number>} [attrs]
 */
function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/**
 * @param {number} mz
 */
function mzFill(mz) {
  return mzColor(mz);
}

/**
 * Draw one free-layer snapshot into an SVG (display-downsampled OVF).
 * @param {SVGSVGElement} svg
 * @param {import("../lib/types").OvfFrameData} frame
 * @param {{ caption: string }} options
 */
export function renderSnapshotMap(svg, frame, options) {
  const metadata = frame.metadata ?? {};
  const nx = Math.max(1, Number(metadata.xnodes) || Math.max(...frame.vectors.map((v) => v.x)) + 1);
  const ny = Math.max(1, Number(metadata.ynodes) || Math.max(...frame.vectors.map((v) => v.y)) + 1);
  const activeZ = Math.min(...frame.vectors.map((v) => v.z));
  const rawVectors = frame.vectors.filter((v) => v.z === activeZ);
  const display = downsampleOvfVectors(rawVectors, {
    nx,
    ny,
    activeZ,
    targetNx: Math.min(12, nx),
    targetNy: Math.min(6, ny)
  });
  const vectors = display.vectors;
  const size = 120;
  const pad = 8;
  svg.setAttribute("viewBox", `0 0 ${size} ${size + 18}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Mesh snapshot ${options.caption} · display ${display.nx}×${display.ny} from raw ${nx}×${ny}`);
  svg.replaceChildren();
  const root = el("g", { class: "sv-board-snapshot-map", "data-source": "mesh-frame" });
  root.append(
    el("rect", {
      x: pad,
      y: pad,
      width: size - pad * 2,
      height: size - pad * 2,
      rx: 2,
      fill: "#071018",
      stroke: "#334155",
      "stroke-width": 1
    })
  );
  const mapW = size - pad * 2;
  const mapH = size - pad * 2;
  const cellW = mapW / display.nx;
  const cellH = mapH / display.ny;
  const arrowMax = Math.min(cellW, cellH) * 0.42;
  for (const vector of vectors) {
    if (vector.x < 0 || vector.x >= display.nx || vector.y < 0 || vector.y >= display.ny) continue;
    const cx = pad + (vector.x + 0.5) * cellW;
    const cy = pad + (vector.y + 0.5) * cellH;
    const color = mzFill(vector.mz);
    const inPlane = Math.hypot(vector.mx, vector.my);
    const dx = inPlane > 1e-6 ? (vector.mx / inPlane) * arrowMax : 0;
    const dy = inPlane > 1e-6 ? -(vector.my / inPlane) * arrowMax : -arrowMax * 0.28;
    root.append(
      el("circle", {
        cx,
        cy,
        r: Math.max(1.4, Math.min(cellW, cellH) * 0.16),
        fill: color,
        opacity: 0.95
      })
    );
    root.append(
      el("line", {
        x1: cx - dx / 2,
        y1: cy - dy / 2,
        x2: cx + dx / 2,
        y2: cy + dy / 2,
        stroke: color,
        "stroke-width": 1.4,
        "stroke-linecap": "round",
        "data-magnetization-arrow": "true"
      })
    );
  }
  const caption = el("text", {
    x: size / 2,
    y: size + 12,
    "text-anchor": "middle",
    fill: "#cbd5e1",
    "font-size": 8,
    "font-weight": 700
  });
  caption.textContent = options.caption;
  svg.append(root, caption);
}

/**
 * nz=1 lateral cut: one row of the same frame, not a fabricated z-stack.
 * @param {SVGSVGElement} svg
 * @param {import("../lib/types").OvfFrameData} frame
 * @param {{ caption: string }} options
 */
export function renderCrossSection(svg, frame, options) {
  const metadata = frame.metadata ?? {};
  const nx = Math.max(1, Number(metadata.xnodes) || Math.max(...frame.vectors.map((v) => v.x)) + 1);
  const ny = Math.max(1, Number(metadata.ynodes) || Math.max(...frame.vectors.map((v) => v.y)) + 1);
  const midY = Math.floor(ny / 2);
  const row = frame.vectors.filter((v) => v.y === midY && v.z === Math.min(...frame.vectors.map((cell) => cell.z)));
  const width = 220;
  const height = 44;
  svg.setAttribute("viewBox", `0 0 ${width} ${height + 14}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `nz=1 cross-section ${options.caption}`);
  svg.replaceChildren();
  const root = el("g", { class: "sv-board-cross-section", "data-source": "mesh-frame" });
  const cellW = (width - 8) / Math.max(1, nx);
  row.forEach((vector) => {
    root.append(
      el("rect", {
        x: 4 + vector.x * cellW,
        y: 6,
        width: Math.max(1, cellW - 0.4),
        height: 24,
        fill: mzFill(vector.mz)
      })
    );
  });
  const caption = el("text", {
    x: width / 2,
    y: height + 10,
    "text-anchor": "middle",
    fill: "#94a3b8",
    "font-size": 7,
    "font-weight": 600
  });
  caption.textContent = `${options.caption} · y=${midY} · nz=1`;
  svg.append(root, caption);
}

/**
 * Surface extrusion of the same mz map. Visualization only.
 * @param {SVGSVGElement} svg
 * @param {import("../lib/types").OvfFrameData | null} frame
 */
export function renderExtrudedSurface(svg, frame) {
  svg.setAttribute("viewBox", "0 0 240 140");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Visualization-only surface extrusion of the active mz map");
  svg.replaceChildren();
  const badge = el("text", { x: 8, y: 12, fill: "#fbbf24", "font-size": 7, "font-weight": 700 });
  badge.textContent = "VISUALIZATION";
  svg.append(badge);
  if (!frame?.vectors?.length) {
    const empty = el("text", { x: 120, y: 72, "text-anchor": "middle", fill: "#64748b", "font-size": 8 });
    empty.textContent = "No mesh frame";
    svg.append(empty);
    return;
  }
  const metadata = frame.metadata ?? {};
  const nx = Math.max(1, Number(metadata.xnodes) || 8);
  const ny = Math.max(1, Number(metadata.ynodes) || 4);
  const display = downsampleOvfVectors(frame.vectors, { nx, ny, activeZ: 0, targetNx: Math.min(16, nx), targetNy: Math.min(8, ny) });
  for (const vector of display.vectors) {
    const px = 40 + vector.x * 10 + vector.y * 4;
    const py = 110 - vector.y * 8 - vector.mz * 18;
    svg.append(
      el("rect", {
        x: px,
        y: py,
        width: 9,
        height: 7,
        fill: mzFill(vector.mz),
        opacity: 0.9,
        transform: `skewX(-18)`
      })
    );
  }
}

/**
 * Uniform macrospin fallback: one vector, never a fake spatial texture.
 * @param {SVGSVGElement} svg
 * @param {{ mx: number, my: number, mz: number, caption: string }} options
 */
export function renderUniformMacrospinMap(svg, options) {
  svg.setAttribute("viewBox", "0 0 120 138");
  svg.replaceChildren();
  const color = mzFill(options.mz);
  const label = el("text", { x: 60, y: 58, "text-anchor": "middle", fill: "#0b0f14", "font-size": 8, "font-weight": 700 });
  label.textContent = "UNIFORM";
  svg.append(
    el("rect", { x: 8, y: 8, width: 104, height: 104, fill: color, stroke: "#334155" }),
    label
  );
  const note = el("text", { x: 60, y: 72, "text-anchor": "middle", fill: "#0b0f14", "font-size": 6 });
  note.textContent = "not a spatial mesh";
  svg.append(note);
  const caption = el("text", { x: 60, y: 128, "text-anchor": "middle", fill: "#cbd5e1", "font-size": 8, "font-weight": 700 });
  caption.textContent = options.caption;
  svg.append(caption);
}

/**
 * Analytical Julliere MR(θ) driven by solved ⟨mz⟩. Not a transport solver.
 * @param {HTMLElement} host
 * @param {ReturnType<typeof buildScientificBoardModel>} model
 */
export function renderMrPanel(host, model) {
  const mz = model.magnetization?.mz;
  if (!mz?.points?.length) {
    host.innerHTML = `<div class="sv-board-empty" data-board-empty="mr"><strong>No m(t) to drive MR(θ)</strong><p>The analytical Julliere curve is shown only from a solved mz series.</p></div>`;
    return;
  }
  const polarization = 0.6;
  /** @type {import("../lib/types").ResultSeries} */
  const series = {
    id: "mr",
    label: "R(θ)/R_P",
    xLabel: mz.xLabel,
    xUnit: mz.xUnit,
    yLabel: "R/R_P",
    yUnit: "dimensionless",
    points: mz.points.map((point) => {
      const transport = julliereTransport({
        conductanceAvgS: 1,
        polarizationFree: polarization,
        cosTheta: point.y
      });
      const rp = transport.resistanceParallelOhm;
      return { x: point.x, y: Number.isFinite(rp) && rp > 0 ? transport.resistanceOhm / rp : 1 };
    })
  };
  const plot = buildScientificPlot([series], { width: 280, height: 160, yMin: 0.9, yMax: 2.2 });
  const paths = plot.paths
    .map((path) => `<path d="${path.d}" fill="none" stroke="#f59e0b" stroke-width="1.8" data-series="mr"/>`)
    .join("");
  host.innerHTML = `
    <svg class="sv-board-plot" data-board-mr-plot="true" viewBox="0 0 ${plot.width} ${plot.height}" role="img" aria-label="Analytical Julliere MR versus time">
      ${scientificAxisMarkup(plot, { xLabel: `time (${mz.xUnit || "s"})`, yLabel: "R/R_P" })}
      ${paths}
    </svg>
    <p class="sv-board-caption">ANALYTICAL MODEL · G(θ)=G_avg(1+P² cosθ), P=0.6, cosθ≈⟨mz⟩. Not a transport solver.</p>
  `;
}

/**
 * @param {HTMLElement} host
 * @param {ReturnType<typeof buildScientificBoardModel>} model
 */
export function renderTracePanel(host, model) {
  const series = [model.magnetization.mx, model.magnetization.my, model.magnetization.mz];
  const plot = buildScientificPlot(series, { width: 520, height: 220, yMin: -1.05, yMax: 1.05 });
  const xUnit = model.magnetization.mz?.xUnit || model.magnetization.mx?.xUnit || "s";
  if (plot.empty) {
    host.innerHTML = `<div class="sv-board-empty" data-board-empty="trace"><strong>No mean magnetization trace</strong><p>No parsed mx/my/mz table series were returned for this run.</p></div>`;
    return;
  }
  const colors = {
    [model.magnetization.mx?.id ?? ""]: "#0b6e4f",
    [model.magnetization.my?.id ?? ""]: "#1d4e89",
    [model.magnetization.mz?.id ?? ""]: "#9a3412"
  };
  const threshold = model.threshold;
  const thrP = plot.mapY(threshold);
  const thrAP = plot.mapY(-threshold);
  const markers = model.snapshots
    .map((slot) => {
      const seriesForTime = model.magnetization.mz ?? model.magnetization.mx;
      if (!seriesForTime?.points?.length) return "";
      let xVal = slot.timeSeconds;
      if (xVal == null) {
        const t = slot.arrayIndex / Math.max(1, (model.snapshots.at(-1)?.arrayIndex ?? 1));
        const pts = seriesForTime.points;
        xVal = pts[0].x + t * (pts[pts.length - 1].x - pts[0].x);
      }
      const x = plot.mapX(xVal);
      return `<line x1="${x.toFixed(1)}" y1="${plot.padTop}" x2="${x.toFixed(1)}" y2="${
        plot.height - plot.padBottom
      }" stroke="#64748b" stroke-dasharray="3 3" stroke-width="1"/><circle cx="${x.toFixed(
        1
      )}" cy="${plot.mapY(
        model.magnetization.mz?.points?.length
          ? interpolateSeriesY(model.magnetization.mz, xVal)
          : 0
      ).toFixed(1)}" r="3" fill="#111827"/>`;
    })
    .join("");
  const paths = plot.paths
    .map(
      (path) =>
        `<path d="${path.d}" fill="none" stroke="${colors[path.id] ?? "#111827"}" stroke-width="1.8" data-series="${path.id}"/>`
    )
    .join("");
  host.innerHTML = `
    <svg class="sv-board-plot" data-board-trace-plot="true" viewBox="0 0 ${plot.width} ${plot.height}" role="img" aria-label="Mean magnetization versus time">
      ${scientificAxisMarkup(plot, {
        xLabel: `time (${xUnit})`,
        yLabel: "mean m"
      })}
      <line x1="${plot.padLeft}" y1="${thrP.toFixed(1)}" x2="${plot.width - plot.padRight}" y2="${thrP.toFixed(
        1
      )}" stroke="#0369a1" stroke-dasharray="4 3" stroke-width="1"/>
      <line x1="${plot.padLeft}" y1="${thrAP.toFixed(1)}" x2="${plot.width - plot.padRight}" y2="${thrAP.toFixed(
        1
      )}" stroke="#be123c" stroke-dasharray="4 3" stroke-width="1"/>
      <text x="${plot.width - plot.padRight - 4}" y="${(thrP - 4).toFixed(1)}" text-anchor="end" fill="#0369a1" font-size="9">P thr +${threshold}</text>
      <text x="${plot.width - plot.padRight - 4}" y="${(thrAP + 10).toFixed(1)}" text-anchor="end" fill="#be123c" font-size="9">AP thr −${threshold}</text>
      ${paths}
      ${markers}
    </svg>
    <ul class="sv-board-legend">
      ${model.magnetization.mx ? `<li data-series="mx">mx</li>` : ""}
      ${model.magnetization.my ? `<li data-series="my">my</li>` : ""}
      ${model.magnetization.mz ? `<li data-series="mz">mz</li>` : ""}
      <li>snapshot markers</li>
      <li>final state: <strong>${model.diagnostics.finalState}</strong></li>
    </ul>
    <p class="sv-board-caption">Panel B · mean m from the returned magnetization table · threshold lines are classification aids, not TMR.</p>
  `;
}

/**
 * @param {import("../lib/types").ResultSeries} series
 * @param {number} x
 */
function interpolateSeriesY(series, x) {
  const points = series.points;
  if (!points.length) return 0;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (x >= a.x && x <= b.x) {
      const w = (x - a.x) / (b.x - a.x || 1);
      return a.y * (1 - w) + b.y * w;
    }
  }
  return points[points.length - 1].y;
}

/**
 * @param {HTMLElement} host
 * @param {ReturnType<typeof buildScientificBoardModel>} model
 */
export function renderDiagnosticsPanel(host, model) {
  const d = model.diagnostics;
  const rows = [
    ["Initial mean m", d.initialMean.label],
    ["Final mean m", d.finalMean.label],
    ["Max |Δm| frame-to-frame", d.maxFrameDelta == null ? "n/a" : d.maxFrameDelta.toExponential(3)],
    ["Mesh / OVF frame count", d.frameCount == null ? "n/a" : String(d.frameCount)],
    ["Grid dimensions", d.grid ?? "n/a"],
    ["Simulation duration", d.duration ?? "n/a"],
    ["Solver source", d.solverSource],
    ["Solver version", d.solverVersion || d.acceleration || "n/a"],
    ["Switching threshold", d.switchingThreshold == null ? "n/a" : `±${d.switchingThreshold}`],
    ["Switching outcome", d.switchingOutcome],
    ["Final P/AP state", d.finalState]
  ];
  host.innerHTML = `
    <dl class="sv-board-diagnostics">
      ${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
    </dl>
    <ul class="sv-observables">
      ${(model.observables ?? [])
        .map(
          (row) =>
            `<li>${provenanceBadge(row.klass)} ${row.label}: ${row.value}</li>`
        )
        .join("")}
    </ul>
    ${
      d.warnings.length
        ? `<ul class="sv-board-warnings">${d.warnings.map((w) => `<li>${w}</li>`).join("")}</ul>`
        : `<p class="sv-board-caption">No dynamics warnings for this result.</p>`
    }
    <p class="sv-board-caption">Panel C · classification from mean m only · no TMR/resistance claim. Threshold ±${model.threshold}.</p>
  `;
}

/**
 * @param {HTMLElement} host
 * @param {ReturnType<typeof buildScientificBoardModel>} model
 */
export function renderSweepPanel(host, model) {
  const sweep = model.sweep;
  if (!sweep.available) {
    host.innerHTML = `
      <div class="sv-board-empty" data-board-empty="sweep">
        <strong>No sweep data yet.</strong>
        <p>Reserved axes: ${sweep.axes.map((axis) => axis.label).join("; ")}.</p>
        <p>No fabricated curves are drawn.</p>
      </div>
      <p class="sv-board-caption">Panel D · parameter sweep board (empty until real sweep series exist).</p>
    `;
    return;
  }
  const plot = buildScientificPlot(sweep.series, { width: 520, height: 200 });
  const paths = plot.paths
    .map((path, index) => {
      const palette = ["#0f766e", "#7c2d12", "#1d4ed8", "#a16207"];
      return `<path d="${path.d}" fill="none" stroke="${palette[index % palette.length]}" stroke-width="1.8"/>`;
    })
    .join("");
  host.innerHTML = `
    <svg class="sv-board-plot" viewBox="0 0 ${plot.width} ${plot.height}" role="img" aria-label="Parameter sweep curves">
      ${scientificAxisMarkup(plot, { xLabel: "sweep parameter", yLabel: "metric" })}
      ${paths}
    </svg>
    <p class="sv-board-caption">Panel D · ${sweep.message}</p>
  `;
}

/**
 * @param {HTMLElement} host
 * @param {ReturnType<typeof buildScientificBoardModel>} model
 */
export function renderQuantumPanel(host, model) {
  const tunneling = model.tunneling;
  if (!tunneling || tunneling.source !== "kwant") {
    host.innerHTML = `
      <div class="sv-board-empty" data-board-empty="quantum" data-transport-unavailable="true">
        <strong>UNAVAILABLE</strong>
        <p>Quantum transport, T(E), |ψ|², TMR, and leakage are outside MuMax3. MuMax3 is classical micromagnetics.</p>
        <p>Kwant is not connected. No decorative wavefield is shown.</p>
      </div>
      <p class="sv-board-caption">Transport · UNAVAILABLE until a real solver/model is wired.</p>
    `;
    return;
  }
  host.innerHTML = `
    <div class="sv-board-empty" data-board-empty="quantum" data-has-spin-arrows="false">
      <strong>Kwant series attached</strong>
      <p>${tunneling.note}</p>
    </div>
  `;
}

/**
 * Mount and manage the scientific board inside a results-panel host.
 */
export class ScientificBoardController {
  /**
   * @param {{
   *   root: HTMLElement,
   *   jobId?: string | null,
   *   fetchFrame?: (jobId: string, frameIndex: number) => Promise<import("../lib/types").OvfFrameResponse>,
   *   onSnapshotClick?: (index: number) => void
   * }} options
   */
  constructor(options) {
    this.root = options.root;
    this.jobId = options.jobId ?? null;
    this.fetchFrame = options.fetchFrame ?? getOvfFrame;
    this.onSnapshotClick = options.onSnapshotClick ?? (() => {});
    /** @type {ReturnType<typeof buildScientificBoardModel> | null} */
    this.model = null;
    this.requestToken = 0;
    this.destroyed = false;
  }

  /**
   * @param {ReturnType<typeof buildScientificBoardModel>} model
   * @param {{ jobId?: string | null }} [options]
   */
  render(model, options = {}) {
    this.destroyed = false;
    this.model = model;
    if (options.jobId !== undefined) this.jobId = options.jobId;
    this.root.className = "sv-scientific-board sv-scientific-dashboard";
    this.root.setAttribute("data-scientific-board", "true");
    this.root.setAttribute("aria-label", "PMTJ scientific dashboard");
    const mesh = model.hasOvfFrames;
    const uniform = !mesh && model.hasMagnetizationTrace;
    this.root.innerHTML = `
      <header class="sv-board-header">
        <h3>${model.title}</h3>
        <p>${model.honesty}</p>
        <div class="sv-board-legend" data-mz-legend>
          <span class="sv-prov-badge" data-class="SIMULATED">SIMULATED</span>
          <span>mz</span>
          <span class="sv-mz-scale"><i data-mz="-1"></i><i data-mz="0"></i><i data-mz="1"></i></span>
          <span>−1 / 0 / +1</span>
        </div>
      </header>
      <div class="sv-dash-row" data-row="schematic-snapshots">
        <section class="sv-board-panel" data-panel="schematic">
          <h4>MTJ stack</h4>
          <svg class="sv-dash-schematic" viewBox="0 0 160 120" role="img" aria-label="MTJ stack schematic">
            <rect x="40" y="16" width="80" height="18" fill="#64748b"/><text x="80" y="28" text-anchor="middle" fill="#0b0f14" font-size="7">reference</text>
            <rect x="40" y="38" width="80" height="10" fill="#f8fafc"/><text x="80" y="46" text-anchor="middle" fill="#0b0f14" font-size="6">MgO barrier</text>
            <rect x="40" y="52" width="80" height="18" fill="#dc2626"/><text x="80" y="64" text-anchor="middle" fill="#fff" font-size="7">free (solved)</text>
            <text x="80" y="92" text-anchor="middle" fill="#94a3b8" font-size="6">schematic · not a field solution</text>
          </svg>
        </section>
        <section class="sv-board-panel" data-panel="A">
          <h4><span class="sv-prov-badge" data-class="SIMULATED">SIMULATED</span> Top-view snapshots</h4>
          <div class="sv-board-snapshots" data-board-snapshots></div>
        </section>
      </div>
      <section class="sv-board-panel" data-panel="cross">
        <h4><span class="sv-prov-badge" data-class="SIMULATED">SIMULATED</span> nz=1 lateral cuts · same frames</h4>
        <div class="sv-board-cross-strip" data-board-cross></div>
      </section>
      <div class="sv-dash-row" data-row="plots">
        <section class="sv-board-panel" data-panel="context">
          <h4>Device context</h4>
          <div data-board-diagnostics></div>
        </section>
        <section class="sv-board-panel" data-panel="mr">
          <h4><span class="sv-prov-badge" data-class="MODEL">ANALYTICAL MODEL</span> MR(θ)</h4>
          <div data-board-mr></div>
        </section>
        <section class="sv-board-panel" data-panel="B">
          <h4><span class="sv-prov-badge" data-class="SIMULATED">SIMULATED</span> m(t)</h4>
          <div data-board-trace></div>
        </section>
      </div>
      <div class="sv-dash-row" data-row="viz">
        <section class="sv-board-panel" data-panel="3d">
          <h4><span class="sv-prov-badge" data-class="MODEL">VISUALIZATION</span> Surface extrusion</h4>
          <svg data-board-extrude viewBox="0 0 240 140"></svg>
        </section>
        <section class="sv-board-panel" data-panel="states">
          <h4>P / AP cards</h4>
          <div data-board-states></div>
        </section>
        <section class="sv-board-panel" data-panel="C">
          <h4>Simulation details</h4>
          <div data-board-details></div>
        </section>
      </div>
      <section class="sv-board-panel" data-panel="energy">
        <h4><span class="sv-prov-badge" data-class="SIMULATED">SIMULATED</span> Energy</h4>
        <div data-board-sweep></div>
      </section>
    `;
    this.root.dataset.uniformFallback = uniform && !mesh ? "true" : "false";
    const snapHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-snapshots]"));
    const crossHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-cross]"));
    const traceHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-trace]"));
    const diagHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-diagnostics]"));
    const sweepHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-sweep]"));
    const mrHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-mr]"));
    const statesHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-states]"));
    const detailsHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-details]"));
    const extrudeSvg = this.root.querySelector("[data-board-extrude]");
    renderTracePanel(traceHost, model);
    const plotNode = traceHost.querySelector("[data-board-trace-plot]");
    plotNode?.addEventListener("click", (event) => {
      if (!(event instanceof MouseEvent) || !(plotNode instanceof SVGSVGElement)) return;
      const bounds = plotNode.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
      const lastIndex = model.snapshots.at(-1)?.arrayIndex ?? 0;
      this.onSnapshotClick(Math.round(fraction * lastIndex));
    });
    renderDiagnosticsPanel(diagHost, model);
    renderMrPanel(mrHost, model);
    if (model.energySeries?.length) {
      renderSweepPanel(sweepHost, { ...model, sweep: { available: true, series: model.energySeries, axes: [], message: "Energy from the Python mesh (or table) at sampled frames." } });
    } else {
      sweepHost.innerHTML = `<div class="sv-board-empty" data-board-empty="energy"><strong>Unavailable: not output by this run</strong><p>Energy series appear when the solver returns e_total.</p></div>`;
    }
    const mzPoints = model.magnetization?.mz?.points ?? [];
    const lastMz = mzPoints.at(-1)?.y ?? 0;
    const final = model.diagnostics?.finalState ?? "n/a";
    statesHost.innerHTML = `
      <article class="sv-state-card" data-state="P"><strong>P</strong><span>m aligned with polarizer</span></article>
      <article class="sv-state-card" data-state="AP"><strong>AP</strong><span>m anti-aligned</span></article>
      <p class="sv-board-caption">Classified state: ${final}. Threshold-only. Not TMR. ⟨mz⟩≈${lastMz.toFixed(3)}</p>
    `;
    const d = model.diagnostics ?? {};
    detailsHost.innerHTML = `
      <ul class="sv-dash-details">
        <li>source=${d.solverSource ?? "unknown"}</li>
        <li>grid=${d.meshLabel ?? d.grid ?? "n/a"}</li>
        <li>frames=${d.frameCount ?? 0}</li>
        <li>lex=${d.exchangeLength ?? "n/a"}</li>
        <li>γΔt B_ex=${d.timestepCriterion ?? "n/a"}</li>
        <li>seed=${d.seed ?? "n/a"}</li>
        <li>version=${d.solverVersion ?? "n/a"}</li>
      </ul>
    `;
    if (extrudeSvg instanceof SVGSVGElement) renderExtrudedSurface(extrudeSvg, null);
    this.renderSnapshotPlaceholders(snapHost, model);
    if (crossHost) {
      crossHost.innerHTML = model.snapshots
        .map(
          (slot) =>
            `<svg data-cross-slot="${slot.slot}" viewBox="0 0 220 58" role="img" aria-label="Loading cross-section"></svg>`
        )
        .join("");
    }
    void this.loadSnapshots(snapHost, model);
  }

  /**
   * @param {HTMLElement} host
   * @param {ReturnType<typeof buildScientificBoardModel>} model
   */
  renderSnapshotPlaceholders(host, model) {
    if (!model.snapshots.length) {
      host.innerHTML = `<div class="sv-board-empty" data-board-empty="snapshots"><strong>No mesh snapshots</strong><p>Spatial maps require returned Python mesh frames. Macrospin stays uniform.</p></div>`;
      return;
    }
    host.innerHTML = model.snapshots
      .map(
        (slot) => `
      <figure class="sv-board-snapshot" data-snapshot-slot="${slot.slot}" data-frame-index="${slot.arrayIndex}" tabindex="0" role="button">
        <svg viewBox="0 0 120 138" role="img" aria-label="Loading mesh snapshot ${slot.caption}"></svg>
        <figcaption>${slot.caption}</figcaption>
      </figure>`
      )
      .join("");
    host.querySelectorAll("[data-frame-index]").forEach((node) => {
      const seek = () => this.onSnapshotClick(Number(node.getAttribute("data-frame-index")));
      node.addEventListener("click", seek);
      node.addEventListener("keydown", (event) => {
        if (event instanceof KeyboardEvent && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          seek();
        }
      });
    });
  }

  /**
   * @param {HTMLElement} host
   * @param {ReturnType<typeof buildScientificBoardModel>} model
   */
  async loadSnapshots(host, model) {
    const jobId = this.jobId;
    if (!model.snapshots.length || !jobId) return;
    const token = ++this.requestToken;
    await Promise.all(
      model.snapshots.map(async (slot) => {
        try {
          const response = await this.fetchFrame(jobId, slot.arrayIndex);
          if (this.destroyed || token !== this.requestToken) return;
          if (!response.frame?.vectors?.length) throw new Error("empty frame");
          const figure = host.querySelector(`[data-snapshot-slot="${slot.slot}"]`);
          const svg = figure?.querySelector("svg");
          if (svg instanceof SVGSVGElement) {
            renderSnapshotMap(svg, response.frame, { caption: slot.caption });
            const crossSvg = this.root.querySelector(`[data-cross-slot="${slot.slot}"]`);
            if (crossSvg instanceof SVGSVGElement) {
              renderCrossSection(crossSvg, response.frame, { caption: slot.caption });
            }
            if (slot.slot === model.snapshots.length - 1 || slot.slot === 0) {
              const extrudeSvg = this.root.querySelector("[data-board-extrude]");
              if (extrudeSvg instanceof SVGSVGElement) renderExtrudedSurface(extrudeSvg, response.frame);
            }
          }
        } catch {
          if (this.destroyed || token !== this.requestToken) return;
          const figure = host.querySelector(`[data-snapshot-slot="${slot.slot}"]`);
          if (figure) {
            figure.classList.add("is-error");
            const caption = figure.querySelector("figcaption");
            if (caption) caption.textContent = `${slot.caption} · unavailable`;
          }
        }
      })
    );
  }

  destroy() {
    this.destroyed = true;
    this.requestToken += 1;
    this.root.replaceChildren();
  }
}

export { buildScientificBoardModel };
