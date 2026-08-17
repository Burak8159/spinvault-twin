/**
 * Build a display model for raw MuMax3 OVF frame artifacts.
 * No spatial field values are invented or interpolated here.
 */

/**
 * @param {import("./types").SimulationResult | null | undefined} result
 */
export function buildFramePlaybackView(result) {
  const frames = Array.isArray(result?.artifacts?.frames) ? result.artifacts.frames : [];
  const ordered = [...frames].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (!ordered.length) {
    return {
      available: false,
      frames: [],
      message: "No OVF magnetization frames were attached. This run can show only table-based mx/my/mz playback."
    };
  }
  return {
    available: true,
    frames: ordered,
    message:
      `${ordered.length} raw MuMax3 OVF magnetization frame(s) were exported. ` +
      "Center viewport playback uses parsed OVF Text/Binary vectors only; no fabricated spatial field is drawn."
  };
}

/**
 * @param {Record<string, unknown> | undefined} metadata
 */
export function formatFrameMetadata(metadata) {
  if (!metadata) return "metadata unavailable";
  const dims =
    metadata.xnodes && metadata.ynodes && metadata.znodes
      ? `${metadata.xnodes} x ${metadata.ynodes} x ${metadata.znodes}`
      : "grid unknown";
  const cells = metadata.cellCount ? `${metadata.cellCount} cells` : "cell count unknown";
  return `${dims}; ${cells}`;
}

/**
 * Calculate diagnostics directly from raw OVF vectors.
 * maxFrameDelta is the largest Euclidean |Δm| among matching vector indices.
 *
 * @param {import("./types").OvfFrameData} frame
 * @param {import("./types").OvfFrameData | null | undefined} previousFrame
 */
export function calculateOvfFrameDiagnostics(frame, previousFrame) {
  const count = frame.vectors.length;
  const sums = frame.vectors.reduce(
    (acc, vector) => ({
      mx: acc.mx + vector.mx,
      my: acc.my + vector.my,
      mz: acc.mz + vector.mz
    }),
    { mx: 0, my: 0, mz: 0 }
  );
  const previousByIndex = new Map(
    (previousFrame?.vectors ?? []).map((vector) => [vector.index, vector])
  );
  let maxFrameDelta = null;
  let matchedVectors = 0;
  for (const vector of frame.vectors) {
    const previous = previousByIndex.get(vector.index);
    if (!previous) continue;
    const delta = Math.hypot(
      vector.mx - previous.mx,
      vector.my - previous.my,
      vector.mz - previous.mz
    );
    maxFrameDelta = Math.max(maxFrameDelta ?? 0, delta);
    matchedVectors += 1;
  }
  const meanMx = count ? sums.mx / count : 0;
  const meanMy = count ? sums.my / count : 0;
  const meanMz = count ? sums.mz / count : 0;
  return {
    vectorCount: count,
    meanMx,
    meanMy,
    meanMz,
    maxFrameDelta,
    matchedVectors,
    staticAtPrecision: maxFrameDelta !== null && maxFrameDelta <= 1e-12,
    pinnedDirection: { mx: 0, my: 0, mz: 1 },
    alignment: meanMz >= 0 ? "P" : "AP",
    alignmentScore: Math.min(1, Math.abs(meanMz))
  };
}

/**
 * @param {import("./types").OvfFrameData | NonNullable<import("./types").SimulationArtifacts["frames"]>[number]} frame
 */
export function formatOvfFrameTime(frame) {
  const time = Number(frame.metadata?.time);
  return Number.isFinite(time) ? `${time.toExponential(4)} s` : "time unavailable in OVF metadata";
}
