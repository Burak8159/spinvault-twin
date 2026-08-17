import { alignedTrajectory, classifySwitching, representativeFrameIndices } from "./switchingMetrics.js";
import { classifyDeviceObservables } from "./deviceObservables.js";

/**
 * Select six raw frame indices: first, ~10%, ~20%, ~40%, ~60%, final.
 * @param {number} frameCount
 * @returns {number[]}
 */
export function selectSnapshotIndices(frameCount) {
  const n = Math.max(0, Math.trunc(frameCount));
  if (n <= 0) return [];
  if (n === 1) return [0];
  const fractions = [0, 0.1, 0.2, 0.4, 0.6, 1];
  /** @type {number[]} */
  const indices = [];
  for (const fraction of fractions) {
    const index = Math.min(n - 1, Math.round(fraction * (n - 1)));
    if (!indices.includes(index)) indices.push(index);
  }
  return indices;
}

/**
 * @param {import("./types").SimulationResult["metrics"] | undefined} metrics
 * @param {string} id
 */
function metricValue(metrics, id) {
  const metric = (metrics ?? []).find((entry) => entry.id === id);
  return metric?.displayValue ?? null;
}

/**
 * @param {import("./types").SimulationResult["metrics"] | undefined} metrics
 * @param {string} id
 */
function metricNote(metrics, id) {
  const metric = (metrics ?? []).find((entry) => entry.id === id);
  return metric?.note ?? null;
}

/**
 * @param {string | null | undefined} text
 */
function parseFinite(text) {
  if (text == null || text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Map table series time onto a frame index when OVF metadata lacks time.
 * @param {import("./types").ResultSeries | null | undefined} series
 * @param {number} frameIndex
 * @param {number} frameCount
 */
export function estimateFrameTimeFromSeries(series, frameIndex, frameCount) {
  if (!series?.points?.length || frameCount <= 0) return null;
  const points = series.points;
  if (frameCount === 1) return points[0]?.x ?? null;
  const t = frameIndex / Math.max(1, frameCount - 1);
  const pos = t * (points.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(points.length - 1, lo + 1);
  if (lo === hi) return points[lo]?.x ?? null;
  const w = pos - lo;
  return points[lo].x * (1 - w) + points[hi].x * w;
}

/**
 * @param {number | null | undefined} seconds
 */
export function formatBoardTimeLabel(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (Math.abs(seconds) < 1e-9) return `${(seconds * 1e12).toFixed(2)} ps`;
  if (Math.abs(seconds) < 1e-6) return `${(seconds * 1e9).toFixed(2)} ns`;
  if (Math.abs(seconds) < 1e-3) return `${(seconds * 1e6).toFixed(2)} µs`;
  return `${seconds.toExponential(3)} s`;
}

/**
 * Build snapshot slot descriptors from attached OVF frame list (no vectors yet).
 * @param {NonNullable<import("./types").SimulationArtifacts["frames"]>} frames
 * @param {{
 *   mzSeries?: import("./types").ResultSeries | null,
 *   classification?: ReturnType<typeof classifySwitching> | null
 * }} [options]
 */
export function buildSnapshotSlots(frames, options = {}) {
  const ordered = [...frames].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const classification = options.classification ?? null;
  const selected = classification
    ? representativeFrameIndices(ordered.length, classification, ordered)
    : selectSnapshotIndices(ordered.length).map((arrayIndex, slot) => ({
        arrayIndex,
        role: slot === 0 ? "initial" : arrayIndex === ordered.length - 1 ? "final" : "even_sample",
        source: "even_spacing"
      }));
  const evenFallback = selected.every((item) => item.source === "even_spacing");
  return selected.map((item, slot) => {
    const frame = ordered[item.arrayIndex];
    const metaTime = Number(frame.metadata?.time);
    const seriesTime = estimateFrameTimeFromSeries(options.mzSeries, item.arrayIndex, ordered.length);
    const timeSeconds = Number.isFinite(metaTime) ? metaTime : seriesTime;
    const timeLabel = formatBoardTimeLabel(timeSeconds);
    const roleLabel = {
      initial: "initial",
      onset: "onset",
      zero_crossing: "zero cross",
      completion: "completion",
      final: "final",
      even_sample: "sample",
      only: "frame"
    }[item.role] ?? item.role;
    return {
      slot,
      arrayIndex: item.arrayIndex,
      frameIndex: frame.index,
      path: frame.path,
      label: frame.label,
      timeSeconds,
      timeLabel,
      role: item.role,
      roleLabel,
      caption: timeLabel ? `${roleLabel} · t = ${timeLabel}` : `${roleLabel} · frame ${frame.index}`,
      source: Number.isFinite(metaTime)
        ? item.source === "event"
          ? /** @type {const} */ ("event")
          : /** @type {const} */ ("ovf_metadata")
        : seriesTime != null
          ? /** @type {const} */ ("table_series")
          : /** @type {const} */ ("frame_index"),
      evenSpacing: evenFallback
    };
  });
}

/**
 * Parameter axes reserved for future sweep experiments.
 */
export const SWEEP_AXES = [
  { id: "current_density", label: "Current density J", unit: "A/m²" },
  { id: "pulse_duration", label: "Pulse duration τ_p", unit: "s" },
  { id: "damping_alpha", label: "Damping α", unit: "dimensionless" },
  { id: "anisotropy_ku1", label: "Anisotropy Ku1", unit: "J/m³" },
  { id: "field_angle_eta", label: "External field angle η", unit: "rad" },
  { id: "temperature", label: "Temperature", unit: "K" }
];

/**
 * @param {import("./types").SimulationResult | null | undefined} result
 */
export function buildSweepBoardModel(result) {
  const series = result?.series ?? [];
  const sweepSeries = series.filter((item) =>
    /\bsweep\b|switching[_\s-]?probability|normalized[_\s-]?error|error[_\s-]?norm/i.test(
      `${item.id} ${item.label}`
    )
  );
  return {
    axes: SWEEP_AXES,
    series: sweepSeries,
    available: sweepSeries.length > 0,
    message: sweepSeries.length
      ? "Sweep curves from returned result series only."
      : "No sweep data yet."
  };
}

/**
 * @param {import("./types").SimulationResult | null | undefined} result
 * @param {import("./types").JobRecord | null | undefined} [job]
 */
export function buildDynamicsDiagnostics(result, job = null) {
  const metrics = result?.metrics ?? [];
  const frames = result?.artifacts?.frames ?? [];
  const frameCount =
    parseFinite(metricValue(metrics, "ovf-frame-count")) ??
    parseFinite(metricValue(metrics, "mesh-frame-count")) ??
    (frames.length || null);
  const maxDelta = parseFinite(metricValue(metrics, "raw-max-component-delta"));
  const motion = metricValue(metrics, "trajectory-motion");
  const switching = metricValue(metrics, "switching-occurred");
  const alignment = metricValue(metrics, "final-alignment-state");
  const thresholdNote = metricNote(metrics, "final-pinned-alignment") ?? "";
  const thresholdMatch = thresholdNote.match(/±\s*([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
  const threshold = thresholdMatch
    ? Number(thresholdMatch[1])
    : parseFinite(metricValue(metrics, "switching-threshold"));
  const initialMx = parseFinite(metricValue(metrics, "initial-mx"));
  const initialMy = parseFinite(metricValue(metrics, "initial-my"));
  const initialMz = parseFinite(metricValue(metrics, "initial-mz"));
  const finalMx = parseFinite(metricValue(metrics, "final-mx"));
  const finalMy = parseFinite(metricValue(metrics, "final-my"));
  const finalMz = parseFinite(metricValue(metrics, "final-mz"));
  const grid =
    metricValue(metrics, "ovf-grid") ||
    (frames[0]?.metadata?.xnodes != null
      ? `${frames[0].metadata.xnodes}×${frames[0].metadata.ynodes}×${frames[0].metadata.znodes}`
      : null);
  const duration =
    metricValue(metrics, "simulation-duration") ||
    metricValue(metrics, "run-duration") ||
    null;
  const acceleration = metricValue(metrics, "acceleration");
  const solverVersion =
    result?.provenance?.solverVersion ||
    job?.provenance?.solverVersion ||
    null;
  const seed = metricValue(metrics, "seed");
  const exchangeLength = metricValue(metrics, "exchange-length");
  const timestepCriterion = metricValue(metrics, "timestep-criterion");
  const mesh = metricValue(metrics, "mesh");

  /** @type {string[]} */
  const warnings = [];
  if (motion === "static" || (maxDelta != null && maxDelta <= 1e-6)) {
    warnings.push("Output is static at loaded precision (max |Δm| too small).");
  }
  if (maxDelta != null && maxDelta > 0 && maxDelta < 1e-4) {
    warnings.push("Motion is very small; dynamics may be hard to resolve visually.");
  }
  if (frameCount != null && frameCount < 100 && /transition/i.test(String(metricValue(metrics, "state-preset") ?? ""))) {
    warnings.push(`Frame count ${frameCount} is below the ≥100 target for transition runs.`);
  } else if (frameCount != null && frameCount < 10) {
    warnings.push(`Frame count ${frameCount} is low for dynamics inspection.`);
  }
  if (!frames.some((frame) => Number.isFinite(Number(frame.metadata?.time)))) {
    warnings.push("No frame timing metadata on attached frames; labels may fall back to frame index or table time.");
  }

  let switchingOutcome = "indeterminate";
  if (switching === "yes") switchingOutcome = "success";
  else if (switching === "no") switchingOutcome = "failure";
  else if (switching === "not_requested") switchingOutcome = "not_requested";

  let finalState = alignment ?? "indeterminate";
  if (!finalState || finalState === "intermediate") finalState = alignment === "intermediate" ? "indeterminate" : finalState;

  return {
    initialMean: {
      mx: initialMx,
      my: initialMy,
      mz: initialMz,
      label:
        initialMx != null
          ? `(${initialMx.toFixed(4)}, ${initialMy?.toFixed(4) ?? "n/a"}, ${initialMz?.toFixed(4) ?? "n/a"})`
          : "n/a"
    },
    finalMean: {
      mx: finalMx,
      my: finalMy,
      mz: finalMz,
      label:
        finalMx != null
          ? `(${finalMx.toFixed(4)}, ${finalMy?.toFixed(4) ?? "n/a"}, ${finalMz?.toFixed(4) ?? "n/a"})`
          : "n/a"
    },
    maxFrameDelta: maxDelta,
    frameCount,
    grid,
    duration,
    solverSource: result?.source ?? "unknown",
    solverVersion,
    acceleration,
    seed,
    exchangeLength,
    timestepCriterion,
    meshLabel: mesh,
    switchingThreshold: threshold,
    switchingOccurred: switching,
    switchingOutcome,
    finalState,
    warnings,
    isPhysical: Boolean(
      result?.isPhysicalSimulation &&
        (result?.source === "mumax3" ||
          result?.source === "python_llg_twin" ||
          result?.source === "python_micromagnetic")
    )
  };
}

/**
 * Aggregate board model for a completed (or demo) result.
 * @param {{
 *   result: import("./types").SimulationResult,
 *   job?: import("./types").JobRecord | null,
 *   magnetization?: Partial<Record<"mx"|"my"|"mz", import("./types").ResultSeries>>,
 *   tunneling?: ReturnType<import("./quantumTransportView").buildQuantumTransportView> | null
 * }} input
 */
export function buildScientificBoardModel(input) {
  const { result, job = null, magnetization = {}, tunneling = null } = input;
  const frames = result.artifacts?.frames ?? [];
  const pinnedMetric = (result.metrics ?? []).find((metric) => metric.id === "final-pinned-alignment");
  const thresholdMatch = pinnedMetric?.note?.match(/±\s*([0-9.eE+-]+)/);
  const parsedThreshold = thresholdMatch ? Number(thresholdMatch[1]) : Number.NaN;
  const metricThreshold = Number(
    (result.metrics ?? []).find((metric) => metric.id === "switching-threshold")?.displayValue
  );
  const threshold = Number.isFinite(parsedThreshold)
    ? parsedThreshold
    : Number.isFinite(metricThreshold)
      ? metricThreshold
      : 0.8;
  const trajectoryClassification = classifySwitching(alignedTrajectory(magnetization), {
    threshold,
    statePreset: (result.metrics ?? []).find((metric) => metric.id === "state-preset")?.displayValue,
    pinnedDirection: { x: 0, y: 0, z: 1 }
  });
  const snapshots = buildSnapshotSlots(frames, {
    mzSeries: magnetization.mz ?? null,
    classification: trajectoryClassification
  });
  const diagnostics = buildDynamicsDiagnostics(result, job);
  const sweep = buildSweepBoardModel(result);
  const observables = classifyDeviceObservables(result);
  const energySeries = (result.series ?? []).filter((item) =>
    /e_total|e_exch|e_demag|e_anis|e_zeeman|energy/i.test(`${item.id} ${item.label}`)
  );
  return {
    title:
      result.source === "python_micromagnetic"
        ? "Python mesh LLGS · PMTJ dashboard"
        : result.source === "python_llg_twin"
          ? "Python LLG twin (macrospin)"
          : "MuMax3 MTJ cell",
    honesty:
      result.source === "python_micromagnetic"
        ? "SIMULATED mesh maps and m(t). ANALYTICAL MODEL for MR. VISUALIZATION for 3D extrusion. nz=1: no through-thickness domains. Not MuMax3. Not a measured device."
        : result.source === "mumax3"
        ? "Raw MuMax3 free-layer micromagnetic output. No TMR/resistance/retention claims."
        : result.source === "python_llg_twin"
          ? "CPU macrospin LLG. Not MuMax3. No mesh. Uniform m only. No TMR/resistance/retention claims."
          : "Not a physical micromagnetic solve. Demo or other sources must not be read as device validation.",
    snapshots,
    magnetization,
    threshold,
    diagnostics,
    sweep,
    tunneling: tunneling?.source === "kwant" ? tunneling : null,
    observables,
    energySeries,
    classification: trajectoryClassification,
    hasOvfFrames: frames.length > 0,
    hasMagnetizationTrace: Boolean(magnetization.mz?.points?.length || magnetization.mx?.points?.length)
  };
}
