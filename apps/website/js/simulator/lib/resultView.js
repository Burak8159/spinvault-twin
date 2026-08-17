/**
 * Result panel helpers for demo / MuMax3 smoke / SpinVault MTJ v0.
 * Presentation only — does not invent physics values.
 */

/**
 * @param {import("./types").SimulatorState} state
 * @returns {"demo" | "mumax3_smoke" | import("./types").MumaxModelKind | "other"}
 */
export function resolveRunModelLabel(state) {
  if (state.solverTarget === "demo") return "demo";
  if (state.solverTarget === "python_llg" || state.solverTarget === "mumax3") {
    if (state.solverDrafts?.mumax3?.modelKind === "spinvault_mtj_free_layer_switching_v1") {
      return "spinvault_mtj_free_layer_switching_v1";
    }
    if (state.solverDrafts?.mumax3?.modelKind === "spinvault_mtj_free_layer_v0_visible") {
      return "spinvault_mtj_free_layer_v0_visible";
    }
    return state.solverDrafts?.mumax3?.modelKind === "spinvault_mtj_free_layer_v0"
      ? "spinvault_mtj_free_layer_v0"
      : "mumax3_smoke";
  }
  return "other";
}

/**
 * Prefer completed job/result identity over the live editor selection.
 * @param {import("./types").SimulatorState} state
 * @param {import("./types").JobRecord | null | undefined} job
 * @param {import("./types").SimulationResult | null | undefined} result
 * @returns {"demo" | "python_llg_twin" | "mumax3_smoke" | import("./types").MumaxModelKind | "other"}
 */
export function resolveDisplayedRunModelLabel(state, job, result) {
  if (result?.source === "demo_fixture") return "demo";
  const fields = extractProvenanceFields(job, result);
  const metricKind = result?.metrics?.find((metric) => metric.id === "model-kind")?.displayValue;
  const kind =
    fields.modelKind || metricKind || job?.request?.solverDrafts?.mumax3?.modelKind || null;
  if (kind === "spinvault_mtj_free_layer_switching_v1") {
    return "spinvault_mtj_free_layer_switching_v1";
  }
  if (kind === "spinvault_mtj_free_layer_v0_visible") {
    return "spinvault_mtj_free_layer_v0_visible";
  }
  if (kind === "spinvault_mtj_free_layer_v0") return "spinvault_mtj_free_layer_v0";
  if (result?.source === "python_llg_twin") return "python_llg_twin";
  if (kind === "smoke" || result?.source === "mumax3") return "mumax3_smoke";
  return resolveRunModelLabel(state);
}

/**
 * @param {"demo" | "mumax3_smoke" | import("./types").MumaxModelKind | "other" | string} kind
 */
export function bannerCopyForRunModel(kind) {
  if (kind === "demo") {
    return {
      title: "Local / API demo fixture",
      note: "Demo fixtures only. Not a physical simulation."
    };
  }
  if (kind === "spinvault_mtj_free_layer_v0") {
    return {
      title: "SpinVault MTJ free-layer v0",
      note: "MuMax3 free-layer model. Not calibrated or experimentally validated. No TMR/resistance claims."
    };
  }
  if (kind === "spinvault_mtj_free_layer_v0_visible") {
    return {
      title: "SpinVault MTJ free-layer v0 · visible dynamics",
      note: "Raw MuMax3 playback preset. Not calibrated. Not experimentally validated. No TMR/resistance/switching-performance inference."
    };
  }
  if (kind === "spinvault_mtj_free_layer_switching_v1") {
    return {
      title: "MTJ free-layer switching · field pulse",
      note: "Magnetization dynamics for one free layer with uniaxial anisotropy. If source is python_llg_twin this is CPU macrospin LLG, not MuMax3. Switching is threshold-classified from m(t). MgO/TMR/resistance are not simulated."
    };
  }
  if (kind === "python_llg_twin") {
    return {
      title: "CPU Python LLG twin",
      note: "Macrospin Landau–Lifshitz–Gilbert on this machine. Not MuMax3. Not a mesh. Not calibrated."
    };
  }
  if (kind === "mumax3_smoke") {
    return {
      title: "MuMax3 smoke / basic",
      note: "Connectivity mesh run. Not a calibrated SpinVault device model."
    };
  }
  return {
    title: String(kind),
    note: "Backend status only. Pending solvers remain not_configured."
  };
}

/**
 * @param {import("./types").SimulatorState} state
 * @param {import("./types").JobRecord | null | undefined} [job]
 * @param {import("./types").SimulationResult | null | undefined} [result]
 */
export function runModelBannerCopy(state, job = null, result = null) {
  const kind =
    job || result
      ? resolveDisplayedRunModelLabel(state, job, result)
      : resolveRunModelLabel(state);
  return bannerCopyForRunModel(kind);
}

/**
 * @param {string | undefined | null} text
 * @param {string} key
 */
function noteValue(text, key) {
  if (!text) return null;
  const prefix = `${key}=`;
  if (!text.startsWith(prefix)) return null;
  return text.slice(prefix.length);
}

/**
 * @param {import("./types").JobRecord | null | undefined} job
 * @param {import("./types").SimulationResult | null | undefined} result
 */
export function extractProvenanceFields(job, result) {
  const notes = [
    ...(result?.provenance?.notes ?? []),
    ...(job?.provenance?.notes ?? [])
  ];
  /** @type {Record<string, string>} */
  const fields = {};
  for (const note of notes) {
    for (const key of [
      "modelKind",
      "request_hash",
      "script_hash",
      "worker_id",
      "run_acceleration",
      "host_gpu_label",
      "artifacts_dir"
    ]) {
      const value = noteValue(note, key);
      if (value && !fields[key]) fields[key] = value;
    }
  }
  if (job?.workerId) fields.worker_id = job.workerId;
  if (job?.gpu?.acceleration) fields.host_gpu_label = job.gpu.acceleration;
  return fields;
}

const FEATURED_METRIC_IDS = [
  "model-kind",
  "acceleration",
  "parsed-series",
  "final-mx",
  "final-my",
  "final-mz",
  "final-max-abs-m",
  "raw-max-component-delta",
  "ovf-frame-count",
  "final-alignment-state",
  "final-pinned-alignment",
  "switching-occurred",
  "m-state-heuristic"
];

/**
 * @param {import("./types").SimulationResult["metrics"]} metrics
 */
export function partitionMetrics(metrics) {
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  /** @type {typeof metrics} */
  const featured = [];
  for (const id of FEATURED_METRIC_IDS) {
    const metric = byId.get(id);
    if (metric) featured.push(metric);
  }
  const featuredIds = new Set(featured.map((metric) => metric.id));
  const rest = metrics.filter((metric) => !featuredIds.has(metric.id));
  return { featured, rest };
}

/**
 * @param {import("./types").ResultSeries} series
 * @returns {"mx" | "my" | "mz" | null}
 */
function magnetizationComponent(series) {
  const token = `${series.yLabel || series.label || ""}`.toLowerCase();
  /** @type {Array<"mx" | "my" | "mz">} */
  const keys = ["mx", "my", "mz"];
  for (const key of keys) {
    if (token.startsWith(key) || token.includes(`${key} (`) || token.split(/\s+/)[0] === key) {
      return key;
    }
  }
  return null;
}

/**
 * @param {import("./types").ResultSeries[]} series
 */
export function splitMagnetizationSeries(series) {
  /** @type {Partial<Record<"mx" | "my" | "mz", import("./types").ResultSeries>>} */
  const magnetization = {};
  /** @type {import("./types").ResultSeries[]} */
  const other = [];
  for (const item of series) {
    const key = magnetizationComponent(item);
    if (key && !magnetization[key]) magnetization[key] = item;
    else other.push(item);
  }
  return { magnetization, other };
}

/**
 * @param {import("./types").SimulationResult["metrics"][number]} metric
 */
export function metricIsHeuristic(metric) {
  return (
    metric.id === "m-state-heuristic" ||
    /heuristic/i.test(metric.label) ||
    /not validated/i.test(metric.note)
  );
}
