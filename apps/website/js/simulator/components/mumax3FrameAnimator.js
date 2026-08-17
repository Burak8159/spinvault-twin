import { getOvfFrame } from "../../api/client.js";
import {
  calculateOvfFrameDiagnostics,
  formatFrameMetadata,
  formatOvfFrameTime
} from "../lib/frameView.js";
import { shouldDisablePlaybackAutoplay } from "../lib/playback.js";
import { pickViewportVariant } from "./mtjViewportLayout.js";
import {
  renderOvfFrameErrorViewport,
  renderOvfFrameLoadingViewport,
  renderOvfFrameViewport
} from "./viewport.js";

/**
 * @param {number} seconds
 */
function formatSecondsLabel(seconds) {
  if (Math.abs(seconds) < 1e-9) return `t≈${(seconds * 1e12).toFixed(1)} ps`;
  return `t≈${(seconds * 1e9).toFixed(3)} ns`;
}

/**
 * @param {import("../lib/types").OvfFrameData} frame
 */
export function formatCompactFrameTime(frame) {
  const seconds = Number(frame.metadata?.time);
  if (!Number.isFinite(seconds)) return `frame index ${frame.index}`;
  return formatSecondsLabel(seconds);
}

/**
 * Prefer OVF timing metadata; otherwise map onto the returned table series.
 * Never label a playing frame as “time unavailable” when table.txt has t.
 * @param {import("../lib/types").OvfFrameData | { index?: number, metadata?: { time?: number } }} frame
 * @param {number} index
 * @param {number} frameCount
 * @param {{ mz?: { points?: Array<{ x: number }> }, mx?: { points?: Array<{ x: number }> } }} [magnetization]
 */
export function formatPlaybackTimeLabel(frame, index, frameCount, magnetization = {}) {
  const direct = Number(frame?.metadata?.time);
  if (Number.isFinite(direct)) return formatCompactFrameTime(/** @type {import("../lib/types").OvfFrameData} */ (frame));
  const points = magnetization.mz?.points ?? magnetization.mx?.points ?? [];
  if (!points.length) return `frame ${index + 1}`;
  const pointIndex = Math.round((index / Math.max(1, frameCount - 1)) * (points.length - 1));
  const seconds = points[pointIndex]?.x;
  if (!Number.isFinite(seconds)) return `frame ${index + 1}`;
  return formatSecondsLabel(seconds);
}

/**
 * Attached mesh frames only. Python results never invent OVF paths.
 * Some MuMax3 hosts omit the frames array and only report ovf-frame-count.
 * @param {import("../lib/types").SimulationResult | null | undefined} result
 * @returns {NonNullable<import("../lib/types").SimulationArtifacts["frames"]>}
 */
export function ovfFramesFromResult(result) {
  const attached = result?.artifacts?.frames;
  if (Array.isArray(attached) && attached.length > 0) return attached;
  if (result?.source === "python_micromagnetic") return [];
  const count = Number(
    result?.metrics?.find((metric) => metric.id === "ovf-frame-count")?.displayValue
  );
  if (!Number.isFinite(count) || count < 1) return [];
  return Array.from({ length: Math.trunc(count) }, (_, index) => ({
    id: `frame-${index}`,
    index,
    path: `outputs/m${String(index).padStart(6, "0")}.ovf`,
    label: `m${String(index).padStart(6, "0")}.ovf`,
    bytes: 0,
    format: "ovf"
  }));
}

/**
 * @param {NonNullable<import("../lib/types").SimulationArtifacts["frames"]> | undefined} frames
 */
export function isPythonMeshFrameList(frames) {
  return frames?.[0]?.format === "spinvault-magnetization-npz-v1";
}

/**
 * The schematic must not own the viewport once real MuMax3 frame artifacts exist.
 * @param {import("../lib/types").SimulationResult | null | undefined} result
 */
export function shouldUseMumax3FrameAnimator(result) {
  const frames = ovfFramesFromResult(result);
  if (!frames.length) return false;
  if (result?.source === "python_micromagnetic") return true;
  return Boolean(result?.isPhysicalSimulation === true && result?.source === "mumax3");
}

export const shouldUseMeshFrameAnimator = shouldUseMumax3FrameAnimator;

/**
 * Claim the center viewport synchronously before controls or frame requests are set up.
 * This prevents a previously rendered schematic from surviving even briefly once a
 * completed MuMax3 result has attached frames.
 *
 * @param {SVGSVGElement} viewport
 * @param {NonNullable<import("../lib/types").SimulationArtifacts["frames"]>[number] | null} frame
 * @param {import("../lib/types").DeviceGeometry | null} [geometry]
 */
export function claimMumax3FrameViewport(viewport, frame, geometry = null) {
  if (viewport.querySelector(".sv-stack") || !viewport.querySelector(".sv-ovf-field")) {
    renderOvfFrameLoadingViewport(viewport, frame, geometry, pickViewportVariant());
  }
}

/**
 * Map completed-run metrics into OVF viewport classification fields.
 * @param {import("../lib/types").SimulationResult["metrics"] | undefined} metrics
 */
export function extractRunClassification(metrics = []) {
  /** @type {{ switchingThreshold?: number, finalAlignmentState?: string, switchingOccurred?: string }} */
  const out = {};
  for (const metric of metrics) {
    if (metric.id === "switching-occurred") out.switchingOccurred = String(metric.displayValue);
    if (metric.id === "final-alignment-state") out.finalAlignmentState = String(metric.displayValue);
    if (metric.id === "final-pinned-alignment") {
      const note = metric.note ?? "";
      const match = note.match(/threshold is ±([0-9.eE+-]+)/);
      if (match) out.switchingThreshold = Number(match[1]);
    }
  }
  return out;
}

/**
 * Fetch and cache raw OVF responses by attached-frame array index.
 * Failed requests are removed so an explicit retry can fetch again.
 */
export class MuMax3FrameCache {
  /**
   * @param {(jobId: string, frameIndex: number) => Promise<import("../lib/types").OvfFrameResponse>} fetchFrame
   */
  constructor(fetchFrame) {
    this.fetchFrame = fetchFrame;
    /** @type {Map<number, Promise<import("../lib/types").OvfFrameData>>} */
    this.entries = new Map();
  }

  /**
   * @param {string} jobId
   * @param {number} frameIndex
   */
  load(jobId, frameIndex) {
    const cached = this.entries.get(frameIndex);
    if (cached) return cached;
    const request = this.fetchFrame(jobId, frameIndex)
      .then((response) => {
        if (!Array.isArray(response.frame?.vectors) || response.frame.vectors.length === 0) {
          throw new Error("Mesh frame response contains no raw vectors.");
        }
        return response.frame;
      })
      .catch((error) => {
        this.entries.delete(frameIndex);
        throw error;
      });
    this.entries.set(frameIndex, request);
    return request;
  }

  clear() {
    this.entries.clear();
  }
}

/**
 * Dedicated owner of the center viewport and controls for completed MuMax3 OVF runs.
 *
 * Parent contract:
 * - jobId
 * - frames
 * - selectedFrameIndex
 * - onFrameIndexChange
 */
export class MuMax3FrameAnimator {
  /**
   * @param {{
   *   viewport: SVGSVGElement,
   *   controlsRoot: HTMLElement,
   *   jobId: string,
   *   frames: NonNullable<import("../lib/types").SimulationArtifacts["frames"]>,
   *   selectedFrameIndex?: number,
   *   onFrameIndexChange?: (index: number) => void,
   *   fetchFrame?: (jobId: string, frameIndex: number) => Promise<import("../lib/types").OvfFrameResponse>,
   *   intervalMs?: number,
 *   reducedMotion?: boolean,
 *   geometry?: import("../lib/types").DeviceGeometry,
 *   isViewportActive?: () => boolean,
 *   runMetrics?: import("../lib/types").SimulationResult["metrics"],
 *   magnetization?: Partial<Record<"mx"|"my"|"mz", import("../lib/types").ResultSeries>>,
 *   displayMode?: "vector" | "mz" | "mx" | "my",
 *   source?: string
 * }} options
   */
  constructor(options) {
    this.viewport = options.viewport;
    this.controlsRoot = options.controlsRoot;
    this.jobId = options.jobId;
    this.frames = options.frames;
    this.source = options.source ?? (isPythonMeshFrameList(options.frames) ? "python_micromagnetic" : "mumax3");
    this.frameNoun = this.source === "python_micromagnetic" ? "mesh frame" : "OVF frame";
    this.selectedFrameIndex = options.selectedFrameIndex ?? 0;
    this.onFrameIndexChange = options.onFrameIndexChange ?? (() => {});
    this.intervalMs = options.intervalMs ?? 120;
    this.speed = 1;
    this.geometry = options.geometry ?? null;
    this.runMetrics = options.runMetrics ?? [];
    this.magnetization = options.magnetization ?? {};
    this.displayMode = options.displayMode ?? "vector";
    this.isViewportActive = options.isViewportActive ?? (() => true);
    this.reducedMotion =
      options.reducedMotion ??
      shouldDisablePlaybackAutoplay(
        typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null
      );
    this.cache = new MuMax3FrameCache(
      options.fetchFrame ?? ((jobId, index) => getOvfFrame(jobId, index))
    );
    /** @type {number | null} */
    this.timer = null;
    this.playDirection = 1;
    /** @type {import("../lib/types").OvfFrameData | null} */
    this.lastRenderedFrame = null;
    /** @type {ReturnType<typeof calculateOvfFrameDiagnostics> | null} */
    this.lastDiagnostics = null;
    this.motionObserved = false;
    this.deltaOverlay = true;
    this.hasAutoplayed = false;
    this.comparedFrameCount = 0;
    this.requestToken = 0;
    this.destroyed = false;
    /** @type {HTMLInputElement | null} */
    this.slider = null;
    /** @type {HTMLButtonElement | null} */
    this.toggle = null;
    /** @type {HTMLElement | null} */
    this.status = null;
    /** @type {HTMLElement | null} */
    this.frameDetails = null;
    /** @type {HTMLInputElement | null} */
    this.speedInput = null;
    /** @type {HTMLElement | null} */
    this.indicator = null;
    /** @type {SVGSVGElement | null} */
    this.trace = null;
    /** @type {SVGLineElement | null} */
    this.traceCursor = null;
  }

  mount() {
    this.destroyed = false;
    this.controlsRoot.replaceChildren();
    this.controlsRoot.className = "sv-frame-playback sv-frame-playback-featured sv-frame-playback-center";
    this.controlsRoot.setAttribute(
      "aria-label",
      this.source === "python_micromagnetic" ? "Python mesh frame animator" : "Raw MuMax3 OVF frame animator"
    );

    const row = document.createElement("div");
    row.className = "sv-ovf-playback-row";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sv-text-link";
    toggle.textContent = "Pause";
    toggle.setAttribute("aria-pressed", "false");
    if (this.reducedMotion || this.frames.length < 2) {
      toggle.hidden = true;
      toggle.disabled = true;
      toggle.title = this.reducedMotion
        ? "Autoplay disabled when reduced motion is preferred. Use the slider."
        : `Only one ${this.frameNoun} is available.`;
    }

    const indicator = document.createElement("strong");
    indicator.className = "sv-ovf-frame-indicator";
    indicator.textContent = `frame ${this.selectedFrameIndex + 1} / ${this.frames.length}`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(Math.max(0, this.frames.length - 1));
    slider.step = "1";
    slider.setAttribute(
      "aria-label",
      this.source === "python_micromagnetic" ? "Python mesh frame index" : "Raw MuMax3 OVF frame index"
    );

    const speedLabel = document.createElement("label");
    speedLabel.className = "sv-twin-slider sv-ovf-speed";
    speedLabel.textContent = "Speed";
    const speed = document.createElement("input");
    speed.type = "range";
    speed.min = "0.25";
    speed.max = "3";
    speed.step = "0.25";
    speed.value = String(this.speed);
    speed.setAttribute(
      "aria-label",
      this.source === "python_micromagnetic" ? "Python mesh playback speed" : "Raw MuMax3 OVF playback speed"
    );
    const speedReadout = document.createElement("span");
    speedReadout.textContent = `${this.speed.toFixed(2)}×`;
    speedLabel.append(speed, speedReadout);

    const extras = document.createElement("details");
    extras.className = "sv-ovf-playback-extras";
    const extrasSummary = document.createElement("summary");
    extrasSummary.textContent = "Δm / trace";
    const deltaToggle = document.createElement("button");
    deltaToggle.type = "button";
    deltaToggle.className = "sv-text-link";
    deltaToggle.dataset.deltaOverlay = "true";
    deltaToggle.setAttribute("aria-pressed", "true");
    deltaToggle.textContent = "Δm overlay on";
    extras.append(extrasSummary, deltaToggle);

    const status = document.createElement("p");
    status.className = "sv-ovf-motion-status";
    status.setAttribute("role", "status");

    row.append(toggle, indicator, slider, speedLabel, extras);
    this.controlsRoot.append(row, status);
    const trace = this.buildMiniTrace();
    if (trace) extras.append(trace);
    this.slider = slider;
    this.toggle = toggle;
    this.status = status;
    this.frameDetails = null;
    this.speedInput = speed;
    this.indicator = indicator;
    this.trace = trace;
    this.traceCursor = trace?.querySelector("[data-trace-cursor]") ?? null;
    if (trace) {
      trace.addEventListener("click", (event) => {
        const bounds = trace.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 360;
        const fraction = Math.min(1, Math.max(0, (x - 8) / 344));
        this.pause();
        void this.seek(Math.round(fraction * (this.frames.length - 1)));
      });
    }

    slider.addEventListener("input", () => {
      this.pause();
      void this.seek(Number(slider.value));
    });
    speed.addEventListener("input", () => {
      this.speed = Number(speed.value);
      speedReadout.textContent = `${this.speed.toFixed(2)}×`;
    });
    toggle.addEventListener("click", () => {
      if (this.timer === null) this.play(this.playDirection, true);
      else this.pause();
    });
    deltaToggle.addEventListener("click", () => {
      this.deltaOverlay = !this.deltaOverlay;
      deltaToggle.setAttribute("aria-pressed", String(this.deltaOverlay));
      deltaToggle.textContent = `Δm overlay ${this.deltaOverlay ? "on" : "off"}`;
      void this.seek(this.selectedFrameIndex);
    });

    void this.seek(this.selectedFrameIndex).then(() => {
      if (!this.reducedMotion && this.frames.length > 1 && !this.hasAutoplayed) {
        this.hasAutoplayed = true;
        this.play(1, true);
      } else {
        this.syncToggle();
      }
    });
  }

  /**
   * Reattach controls after the parent results panel is rendered again, retaining cache.
   * @param {HTMLElement} controlsRoot
   * @param {number} selectedFrameIndex
   */
  attach(controlsRoot, selectedFrameIndex = this.selectedFrameIndex) {
    this.pause();
    this.controlsRoot = controlsRoot;
    this.selectedFrameIndex = selectedFrameIndex;
    this.mount();
  }

  buildMiniTrace() {
    const series = this.magnetization.mz;
    if (!series?.points?.length) return null;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "sv-ovf-mini-trace");
    svg.setAttribute("viewBox", "0 0 360 62");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Mean mz trace synchronized to mesh playback");
    const points = series.points;
    const minX = points[0].x;
    const maxX = points[points.length - 1].x;
    const spanX = maxX - minX || 1;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      points
        .map((point, index) => {
          const x = 8 + ((point.x - minX) / spanX) * 344;
          const y = 31 - Math.max(-1, Math.min(1, point.y)) * 23;
          return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" ")
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#ff9b72");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("data-series", "mz");
    const cursor = document.createElementNS("http://www.w3.org/2000/svg", "line");
    cursor.setAttribute("x1", "8");
    cursor.setAttribute("x2", "8");
    cursor.setAttribute("y1", "5");
    cursor.setAttribute("y2", "57");
    cursor.setAttribute("stroke", "#ffffff");
    cursor.setAttribute("stroke-width", "1.5");
    cursor.setAttribute("data-trace-cursor", "true");
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", "10");
    label.setAttribute("y", "13");
    label.setAttribute("fill", "#cbd5e1");
    label.setAttribute("font-size", "9");
    label.textContent = "mean mz";
    svg.append(path, cursor, label);
    return svg;
  }

  /** @param {number} index */
  syncTraceCursor(index) {
    if (!this.traceCursor) return;
    const x = 8 + (index / Math.max(1, this.frames.length - 1)) * 344;
    this.traceCursor.setAttribute("x1", x.toFixed(1));
    this.traceCursor.setAttribute("x2", x.toFixed(1));
  }

  syncToggle() {
    if (!this.toggle) return;
    const playing = this.timer !== null;
    this.toggle.textContent = playing ? "Pause" : "Play";
    this.toggle.setAttribute("aria-pressed", String(playing));
  }

  /**
   * Prefer OVF timing metadata; otherwise map to the nearest returned table sample.
   * @param {number} index
   * @param {import("../lib/types").OvfFrameData} frame
   */
  formatTimeAt(index, frame) {
    return formatPlaybackTimeLabel(frame, index, this.frames.length, this.magnetization);
  }

  /** @param {number} requestedIndex */
  async seek(requestedIndex) {
    if (this.destroyed || !this.frames.length) return;
    const index = Math.min(Math.max(0, Math.trunc(requestedIndex)), this.frames.length - 1);
    this.selectedFrameIndex = index;
    if (this.slider) this.slider.value = String(index);
    this.onFrameIndexChange(index);
    const token = ++this.requestToken;
    if (!this.lastRenderedFrame && this.isViewportActive()) {
      renderOvfFrameLoadingViewport(
        this.viewport,
        this.frames[index],
        this.geometry,
        pickViewportVariant()
      );
    }
    if (this.status) this.status.textContent = `Loading attached ${this.frameNoun} ${index + 1}/${this.frames.length}…`;
    try {
      const [frame, chronologicalPrevious] = await Promise.all([
        this.cache.load(this.jobId, index),
        this.deltaOverlay && index > 0
          ? this.cache.load(this.jobId, index - 1).catch(() => null)
          : Promise.resolve(null)
      ]);
      if (this.destroyed || token !== this.requestToken) return;
      const previousForDiagnostics =
        this.lastRenderedFrame?.path === frame.path ? null : this.lastRenderedFrame;
      const diagnostics = calculateOvfFrameDiagnostics(frame, previousForDiagnostics);
      if (diagnostics.maxFrameDelta !== null) {
        this.comparedFrameCount += 1;
        if (!diagnostics.staticAtPrecision) this.motionObserved = true;
      }
      const timeLabel = this.formatTimeAt(index, frame);
      if (this.isViewportActive()) {
        renderOvfFrameViewport(this.viewport, frame, {
          ...diagnostics,
          timeLabel,
          framePosition: `${index + 1} / ${this.frames.length}`,
          previousFrame: chronologicalPrevious,
          deltaOverlay: this.deltaOverlay,
          geometry: this.geometry ?? undefined,
          variant: pickViewportVariant(),
          displayMode: this.displayMode,
          ...extractRunClassification(this.runMetrics)
        });
      }
      this.lastRenderedFrame = frame;
      this.lastDiagnostics = diagnostics;
      this.renderMetadata(index, frame, diagnostics);
      if (this.indicator) {
        this.indicator.textContent = `frame ${index + 1} / ${this.frames.length} · ${timeLabel}`;
      }
      this.syncTraceCursor(index);
      if (this.status) {
        const motionStatus =
          this.comparedFrameCount === 0
            ? "Select or play another frame to measure change."
            : this.motionObserved
              ? "Raw frame changes detected."
              : "Frames compared so far are static at loaded precision.";
        this.status.textContent = `${motionStatus} ${this.deltaOverlay ? "Δm outlines use adjacent raw frames." : ""}`.trim();
      }
      for (let offset = 1; offset <= 4; offset += 1) {
        const next = index + this.playDirection * offset;
        if (next >= 0 && next < this.frames.length) {
          void this.cache.load(this.jobId, next).catch(() => {});
        }
      }
    } catch (error) {
      if (this.destroyed || token !== this.requestToken) return;
      const message = error instanceof Error ? error.message : `Could not fetch or parse ${this.frameNoun}.`;
      if (this.isViewportActive()) {
        renderOvfFrameErrorViewport(this.viewport, message, this.geometry, pickViewportVariant());
      }
      if (this.status) this.status.textContent = `${this.frameNoun} error: ${message}`;
    }
  }

  /**
   * Play every attached raw frame in order. No synthetic in-between vectors are generated.
   * @param {number} direction
   * @param {boolean} loop
   */
  play(direction = 1, loop = true) {
    if (this.destroyed || this.reducedMotion || this.frames.length < 2 || this.timer !== null) return;
    this.playDirection = direction < 0 ? -1 : 1;
    if (this.toggle) {
      this.syncToggle();
    }
    const step = async () => {
      if (this.destroyed || this.timer === null) return;
      let next = this.selectedFrameIndex + this.playDirection;
      if (next < 0 || next >= this.frames.length) {
        if (!loop) {
          this.pause();
          return;
        }
        next = this.playDirection > 0 ? 0 : this.frames.length - 1;
      }
      await this.seek(next);
      if (this.timer !== null) {
        this.timer = window.setTimeout(() => void step(), this.intervalMs / Math.max(0.25, this.speed));
      }
    };
    this.timer = window.setTimeout(() => void step(), 0);
    this.syncToggle();
  }

  pause() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.syncToggle();
  }

  /**
   * @param {number} delta
   */
  step(delta) {
    this.pause();
    void this.seek(this.selectedFrameIndex + delta);
  }

  /**
   * @param {"vector" | "mz" | "mx" | "my"} mode
   */
  setDisplayMode(mode) {
    this.displayMode = mode;
    this.showSelected();
  }

  showSelected() {
    if (this.destroyed || !this.isViewportActive()) return;
    if (this.lastRenderedFrame) {
      const diagnostics =
        this.lastDiagnostics ?? calculateOvfFrameDiagnostics(this.lastRenderedFrame, null);
      const timeLabel = this.formatTimeAt(this.selectedFrameIndex, this.lastRenderedFrame);
      renderOvfFrameViewport(this.viewport, this.lastRenderedFrame, {
        ...diagnostics,
        timeLabel,
        framePosition: `${this.selectedFrameIndex + 1} / ${this.frames.length}`,
        deltaOverlay: this.deltaOverlay,
        geometry: this.geometry ?? undefined,
        variant: pickViewportVariant(),
        displayMode: this.displayMode,
        ...extractRunClassification(this.runMetrics)
      });
      if (this.indicator) {
        this.indicator.textContent = `frame ${this.selectedFrameIndex + 1} / ${this.frames.length} · ${timeLabel}`;
      }
      return;
    }
    void this.seek(this.selectedFrameIndex);
  }

  /**
   * @param {number} index
   * @param {import("../lib/types").OvfFrameData} frame
   * @param {ReturnType<typeof calculateOvfFrameDiagnostics>} diagnostics
   */
  renderMetadata(index, frame, diagnostics) {
    if (!this.frameDetails) return;
    const metadata = this.frames[index];
    this.frameDetails.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = metadata.label;
    const list = document.createElement("dl");
    for (const [label, value] of [
      ["Source", this.source === "python_micromagnetic" ? "Python mesh NPZ" : "MuMax3 OVF"],
      ["Frame", `${index + 1} / ${this.frames.length}`],
      ["Attached index", `${index}`],
      ["Artifact index", `${metadata.index}`],
      ["Frame time", formatOvfFrameTime(frame)],
      ["Grid", formatFrameMetadata(frame.metadata)],
      ["Raw vectors", `${diagnostics.vectorCount}`],
      ["Mean mx/my/mz", `${diagnostics.meanMx.toFixed(6)} / ${diagnostics.meanMy.toFixed(6)} / ${diagnostics.meanMz.toFixed(6)}`],
      ["Max |Δm|", diagnostics.maxFrameDelta == null ? "n/a (first frame)" : diagnostics.maxFrameDelta.toExponential(4)],
      ["Motion", diagnostics.maxFrameDelta == null ? "not compared" : diagnostics.staticAtPrecision ? "static at loaded precision" : "frame change detected"],
      ["Alignment", `${diagnostics.alignment} relative to pinned (0,0,+1); score ${(diagnostics.alignmentScore * 100).toFixed(2)}%`],
      ["Path", metadata.path],
      ["Bytes", `${metadata.bytes}`]
    ]) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      row.append(term, description);
      list.append(row);
    }
    this.frameDetails.append(title, list);
  }

  destroy() {
    this.pause();
    this.destroyed = true;
    this.requestToken += 1;
    this.cache.clear();
  }
}
