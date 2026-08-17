/**
 * Display-only OVF sanity checks. Raw vectors remain unmodified.
 */

export const ACTIVE_MAGNITUDE_FLOOR = 0.05;
export const NORM_SANITY_TOLERANCE = 0.08;
export const TABLE_OVF_MISMATCH_TOLERANCE = 0.05;

/**
 * @param {import("./types").OvfFrameVector[]} vectors
 */
export function activeOvfVectors(vectors) {
  return vectors.filter((vector) => (Number(vector.magnitude) || Math.hypot(vector.mx, vector.my, vector.mz)) >= ACTIVE_MAGNITUDE_FLOOR);
}

/**
 * @param {import("./types").OvfFrameVector[]} vectors
 */
export function summarizeOvfVectors(vectors) {
  const active = activeOvfVectors(vectors);
  if (!active.length) {
    return {
      activeCellCount: 0,
      totalCellCount: vectors.length,
      meanMx: 0,
      meanMy: 0,
      meanMz: 0,
      stdMz: 0,
      meanNorm: 0,
      normFailureCount: 0,
      normOk: true
    };
  }
  const meanMx = active.reduce((sum, vector) => sum + vector.mx, 0) / active.length;
  const meanMy = active.reduce((sum, vector) => sum + vector.my, 0) / active.length;
  const meanMz = active.reduce((sum, vector) => sum + vector.mz, 0) / active.length;
  const meanNorm = active.reduce((sum, vector) => sum + (vector.magnitude || Math.hypot(vector.mx, vector.my, vector.mz)), 0) / active.length;
  const stdMz = Math.sqrt(active.reduce((sum, vector) => sum + (vector.mz - meanMz) ** 2, 0) / active.length);
  const normFailureCount = active.filter((vector) => {
    const norm = vector.magnitude || Math.hypot(vector.mx, vector.my, vector.mz);
    return Math.abs(norm - 1) > NORM_SANITY_TOLERANCE;
  }).length;
  return {
    activeCellCount: active.length,
    totalCellCount: vectors.length,
    meanMx,
    meanMy,
    meanMz,
    stdMz,
    meanNorm,
    normFailureCount,
    normOk: normFailureCount === 0
  };
}

/**
 * @param {{ mx?: number, my?: number, mz?: number }} table
 * @param {{ meanMx?: number, meanMy?: number, meanMz?: number }} ovf
 */
export function compareTableAndOvfAverages(table, ovf) {
  /** @type {string[]} */
  const mismatched = [];
  /** @type {Record<"mx"|"my"|"mz", number | null>} */
  const deltas = { mx: null, my: null, mz: null };
  const ovfKey = /** @type {const} */ ({ mx: "meanMx", my: "meanMy", mz: "meanMz" });
  for (const key of /** @type {const} */ (["mx", "my", "mz"])) {
    const tableValue = table[key];
    const ovfValue = ovf[ovfKey[key]];
    if (!Number.isFinite(tableValue) || !Number.isFinite(ovfValue)) continue;
    const delta = Math.abs(Number(ovfValue) - Number(tableValue));
    deltas[key] = delta;
    if (delta > TABLE_OVF_MISMATCH_TOLERANCE) mismatched.push(key);
  }
  return {
    deltas,
    mismatched,
    ok: mismatched.length === 0
  };
}

/**
 * Confirm x-fastest OVF indexing: index = z*nx*ny + y*nx + x.
 * @param {import("./types").OvfFrameVector[]} vectors
 * @param {{ xnodes: number, ynodes: number }} grid
 */
export function assertOvfIndexOrder(vectors, grid) {
  return vectors.every((vector) => vector.index === vector.z * grid.xnodes * grid.ynodes + vector.y * grid.xnodes + vector.x);
}
