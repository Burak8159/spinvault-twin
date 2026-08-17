/**
 * Paper-style MuMax3 scientific simulation board (panels A–E).
 * Uses real OVF/table data only; empty panels stay empty.
 */

import { getOvfFrame } from "../../api/client.js";
import { buildScientificPlot, scientificAxisMarkup } from "../lib/charts.js";
import { mzColor } from "./mtjViewportLayout.js";
import { downsampleOvfVectors } from "./viewport.js";
import { buildScientificBoardModel } from "../lib/scientificBoardModel.js";
import { provenanceBadge } from "../lib/deviceObservables.js";

export const DEFAULT_SCIENTIFIC_BOARD_OPEN = false;

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
  svg.setAttribute("aria-label", `MuMax3 OVF snapshot ${options.caption} · display ${display.nx}×${display.ny} from raw ${nx}×${ny}`);
  svg.replaceChildren();
  const root = el("g", { class: "sv-board-snapshot-map", "data-source": "mumax3-ovf" });
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
    <p class="sv-board-caption">Panel B · mean m from parsed MuMax3 table series only · threshold lines are classification aids, not TMR.</p>
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
    ["OVF frame count", d.frameCount == null ? "n/a" : String(d.frameCount)],
    ["Grid dimensions", d.grid ?? "n/a"],
    ["Simulation duration", d.duration ?? "n/a"],
    ["Solver source", d.solverSource],
    ["MuMax3 / CUDA label", d.solverVersion || d.acceleration || "n/a"],
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
    this.root.className = "sv-scientific-board";
    this.root.setAttribute("data-scientific-board", "true");
    this.root.setAttribute("aria-label", "MuMax3 scientific simulation board");
    this.root.innerHTML = `
      <header class="sv-board-header">
        <h3>MuMax3 MTJ cell</h3>
        <p>${model.honesty}</p>
      </header>
      <div class="sv-board-grid">
        <section class="sv-board-panel" data-panel="A">
          <h4><span>A</span> Time evolution</h4>
          <div class="sv-board-snapshots" data-board-snapshots></div>
          <p class="sv-board-caption">${
            model.snapshots.some((slot) => slot.evenSpacing)
              ? "Evenly spaced frames · event detection not used for this strip."
              : "Representative frames from mean-m events when detected. Click to seek."
          } Display downsampled from raw OVF.</p>
        </section>
        <section class="sv-board-panel" data-panel="B">
          <h4><span>B</span> ⟨mx⟩ ⟨my⟩ ⟨mz⟩</h4>
          <div data-board-trace></div>
        </section>
        <section class="sv-board-panel" data-panel="C">
          <h4><span>C</span> Device state</h4>
          <div data-board-diagnostics></div>
        </section>
        <section class="sv-board-panel" data-panel="D">
          <h4><span>D</span> Energy</h4>
          <div data-board-sweep></div>
        </section>
        <section class="sv-board-panel" data-panel="E">
          <h4><span>E</span> Transport</h4>
          <div data-board-quantum></div>
        </section>
      </div>
    `;
    const snapHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-snapshots]"));
    const traceHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-trace]"));
    const diagHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-diagnostics]"));
    const sweepHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-sweep]"));
    const quantumHost = /** @type {HTMLElement} */ (this.root.querySelector("[data-board-quantum]"));
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
    if (model.energySeries?.length) {
      renderSweepPanel(sweepHost, { ...model, sweep: { available: true, series: model.energySeries, axes: [], message: "Energy columns from table.txt" } });
    } else {
      sweepHost.innerHTML = `<div class="sv-board-empty" data-board-empty="energy"><strong>Unavailable: not output by this run</strong><p>Energy series appear only when MuMax3 table columns are parsed.</p></div>`;
    }
    renderQuantumPanel(quantumHost, model);
    this.renderSnapshotPlaceholders(snapHost, model);
    void this.loadSnapshots(snapHost, model);
  }

  /**
   * @param {HTMLElement} host
   * @param {ReturnType<typeof buildScientificBoardModel>} model
   */
  renderSnapshotPlaceholders(host, model) {
    if (!model.snapshots.length) {
      host.innerHTML = `<div class="sv-board-empty" data-board-empty="snapshots"><strong>No OVF snapshots</strong><p>This run attached no raw MuMax3 OVF frames.</p></div>`;
      return;
    }
    host.innerHTML = model.snapshots
      .map(
        (slot) => `
      <figure class="sv-board-snapshot" data-snapshot-slot="${slot.slot}" data-frame-index="${slot.arrayIndex}" tabindex="0" role="button">
        <svg viewBox="0 0 120 138" role="img" aria-label="Loading OVF snapshot ${slot.caption}"></svg>
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
