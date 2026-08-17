/**
 * Derived switching / P-AP classification from mean-m trajectories only.
 * Never invents TMR, resistance, or spatial textures.
 */

/**
 * @typedef {{ t: number, mx: number, my: number, mz: number }} TrajectorySample
 */

/**
 * @param {Partial<Record<"mx"|"my"|"mz", import("./types").ResultSeries>>} magnetization
 * @returns {TrajectorySample[]}
 */
export function alignedTrajectory(magnetization) {
  const mx = magnetization.mx?.points ?? [];
  const my = magnetization.my?.points ?? [];
  const mz = magnetization.mz?.points ?? [];
  const count = Math.min(mx.length, my.length, mz.length);
  return Array.from({ length: count }, (_, index) => ({
    t: mx[index].x,
    mx: mx[index].y,
    my: my[index].y,
    mz: mz[index].y
  }));
}

/**
 * @param {{ x: number, y: number, z: number }} pinned
 */
function normalizedPinned(pinned) {
  const norm = Math.hypot(pinned.x, pinned.y, pinned.z) || 1;
  return { x: pinned.x / norm, y: pinned.y / norm, z: pinned.z / norm };
}

/**
 * @param {TrajectorySample[]} trajectory
 * @param {{
 *   pinnedDirection?: { x: number, y: number, z: number },
 *   threshold?: number,
 *   statePreset?: string
 * }} [options]
 */
export function classifySwitching(trajectory, options = {}) {
  const threshold = options.threshold ?? 0.8;
  const pinned = normalizedPinned(options.pinnedDirection ?? { x: 0, y: 0, z: 1 });
  const preset = options.statePreset ?? "transition_0_to_1";
  if (!trajectory.length) {
    return {
      finalState: "unavailable",
      switchingOccurred: "unavailable",
      onsetTime: null,
      zeroCrossingTime: null,
      completionTime: null,
      settlingDelta: null,
      threshold,
      algorithm: "mean-m alignment to pinned direction"
    };
  }
  const alignments = trajectory.map((sample) => sample.mx * pinned.x + sample.my * pinned.y + sample.mz * pinned.z);
  const finalAlignment = alignments[alignments.length - 1];
  const finalState =
    finalAlignment >= threshold ? "P" : finalAlignment <= -threshold ? "AP" : "intermediate";
  const requested = preset === "transition_0_to_1" || preset === "transition_1_to_0";
  let switched = false;
  if (preset === "transition_0_to_1") {
    switched =
      alignments[0] <= -threshold && Math.max(...alignments) >= threshold && finalAlignment >= threshold;
  } else if (preset === "transition_1_to_0") {
    switched =
      alignments[0] >= threshold && Math.min(...alignments) <= -threshold && finalAlignment <= -threshold;
  }
  const leaveWell = threshold * 0.75;
  let onsetTime = null;
  let zeroCrossingTime = null;
  let completionTime = null;
  if (preset === "transition_0_to_1") {
    for (let index = 0; index < alignments.length; index += 1) {
      if (onsetTime == null && alignments[index] > -leaveWell) onsetTime = trajectory[index].t;
      if (zeroCrossingTime == null && alignments[index] >= 0) zeroCrossingTime = trajectory[index].t;
      if (completionTime == null && alignments[index] >= threshold) {
        completionTime = trajectory[index].t;
        break;
      }
    }
  } else if (preset === "transition_1_to_0") {
    for (let index = 0; index < alignments.length; index += 1) {
      if (onsetTime == null && alignments[index] < leaveWell) onsetTime = trajectory[index].t;
      if (zeroCrossingTime == null && alignments[index] <= 0) zeroCrossingTime = trajectory[index].t;
      if (completionTime == null && alignments[index] <= -threshold) {
        completionTime = trajectory[index].t;
        break;
      }
    }
  } else {
    for (let index = 1; index < trajectory.length; index += 1) {
      if (trajectory[index - 1].mz * trajectory[index].mz <= 0) {
        zeroCrossingTime = trajectory[index].t;
        break;
      }
    }
  }
  let settlingDelta = null;
  if (completionTime != null) {
    const after = [];
    for (let index = 1; index < trajectory.length; index += 1) {
      if (trajectory[index].t >= completionTime) after.push(Math.abs(alignments[index] - alignments[index - 1]));
    }
    if (after.length) settlingDelta = Math.max(...after);
  }
  return {
    finalState,
    finalAlignment,
    switchingOccurred: switched ? "yes" : requested ? "no" : "not_requested",
    onsetTime,
    zeroCrossingTime,
    completionTime,
    settlingDelta,
    threshold,
    alignments,
    algorithm:
      "P if alignment≥+thr, AP if alignment≤−thr, else intermediate. Onset = |alignment| leaves 0.75×thr source well. Completion = first target-thr sample."
  };
}

/**
 * Map classified events onto attached OVF frame indices. Falls back to even spacing.
 * @param {number} frameCount
 * @param {ReturnType<typeof classifySwitching>} classification
 * @param {Array<{ metadata?: { time?: number }, index?: number }>} frames
 */
export function representativeFrameIndices(frameCount, classification, frames = []) {
  const n = Math.max(0, Math.trunc(frameCount));
  if (n <= 0) return [];
  if (n === 1) return [{ arrayIndex: 0, role: "only", source: "frame_index" }];
  const times = frames.map((frame) => Number(frame.metadata?.time));
  const hasTimes = times.every((time) => Number.isFinite(time));
  /**
   * @param {number | null} seconds
   * @param {string} role
   */
  const nearest = (seconds, role) => {
    if (!hasTimes || seconds == null) return null;
    let best = 0;
    let bestDelta = Infinity;
    times.forEach((time, index) => {
      const delta = Math.abs(time - seconds);
      if (delta < bestDelta) {
        best = index;
        bestDelta = delta;
      }
    });
    return { arrayIndex: best, role, source: /** @type {const} */ ("event") };
  };
  const events = [
    { arrayIndex: 0, role: "initial", source: /** @type {const} */ ("event") },
    nearest(classification.onsetTime, "onset"),
    nearest(classification.zeroCrossingTime, "zero_crossing"),
    nearest(classification.completionTime, "completion"),
    { arrayIndex: n - 1, role: "final", source: /** @type {const} */ ("event") }
  ].filter(Boolean);
  /** @type {Array<{ arrayIndex: number, role: string, source: string }>} */
  const unique = [];
  for (const event of events) {
    if (!event) continue;
    if (unique.some((item) => item.arrayIndex === event.arrayIndex)) continue;
    unique.push(event);
  }
  if (unique.length >= 3 && unique.some((item) => item.role !== "initial" && item.role !== "final")) {
    return unique.slice(0, 6);
  }
  const fractions = [0, 0.1, 0.2, 0.4, 0.6, 1];
  return fractions
    .map((fraction) => Math.min(n - 1, Math.round(fraction * (n - 1))))
    .filter((index, position, all) => all.indexOf(index) === position)
    .map((arrayIndex, slot) => ({
      arrayIndex,
      role: slot === 0 ? "initial" : arrayIndex === n - 1 ? "final" : "even_sample",
      source: "even_spacing"
    }));
}
