/**
 * Build index-aligned playback samples from raw parsed MuMax3 table columns.
 * No interpolation or generated physics values are introduced.
 * @param {Partial<Record<"mx" | "my" | "mz", import("./types").ResultSeries>>} components
 */
export function buildMagnetizationPlayback(components) {
  const mx = components.mx;
  const my = components.my;
  const mz = components.mz;
  if (!mx?.points.length || !my?.points.length || !mz?.points.length) {
    return { samples: [], flat: false, message: "No complete mx/my/mz raw series is available for playback." };
  }
  const length = Math.min(mx.points.length, my.points.length, mz.points.length);
  const samples = Array.from({ length }, (_, index) => ({
    time: mx.points[index].x,
    mx: mx.points[index].y,
    my: my.points[index].y,
    mz: mz.points[index].y
  }));
  /** @type {Array<"mx" | "my" | "mz">} */
  const componentKeys = ["mx", "my", "mz"];
  const spans = componentKeys.map((key) => {
    const values = samples.map((sample) => sample[key]);
    return Math.max(...values) - Math.min(...values);
  });
  const flat = Math.max(...spans) <= 1e-12;
  return {
    samples,
    flat,
    message: flat
      ? "Run complete. The parsed magnetization trajectory is flat at table precision."
      : "Raw MuMax3 table playback. Not calibrated. Not experimentally validated."
  };
}

/**
 * Autoplay is disabled when the user prefers reduced motion.
 * @param {{ matches?: boolean } | null | undefined} mediaQuery
 */
export function shouldDisablePlaybackAutoplay(mediaQuery) {
  return Boolean(mediaQuery?.matches);
}

/**
 * Display sampling of a stored m(t) table. Linear in time between solver samples.
 * @param {ReturnType<typeof buildMagnetizationPlayback>["samples"]} samples
 * @param {number} progress
 */
export function sampleMagnetizationAtProgress(samples, progress) {
  if (!samples.length) return null;
  if (samples.length === 1) return samples[0];
  const u = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const start = samples[0].time;
  const end = samples[samples.length - 1].time;
  const target = start + u * (end - start);
  let index = 0;
  while (index < samples.length - 2 && samples[index + 1].time < target) index += 1;
  const a = samples[index];
  const b = samples[index + 1];
  const span = b.time - a.time;
  const t = span > 0 ? (target - a.time) / span : 0;
  return {
    time: target,
    mx: a.mx + (b.mx - a.mx) * t,
    my: a.my + (b.my - a.my) * t,
    mz: a.mz + (b.mz - a.mz) * t
  };
}

/**
 * @param {{ time: number, mx: number, my: number, mz: number }} sample
 */
export function formatPlaybackSample(sample) {
  return {
    time: `${sample.time.toExponential(4)} s`,
    mx: sample.mx.toFixed(6),
    my: sample.my.toFixed(6),
    mz: sample.mz.toFixed(6)
  };
}
