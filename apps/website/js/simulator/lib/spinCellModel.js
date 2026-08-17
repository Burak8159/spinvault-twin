/**
 * Deterministic spin lattice for one MTJ cell.
 * When freeMagnetization is supplied it is the Python LLG m(t).
 * Otherwise this is a pre-run schematic, not a solver.
 */

/** @typedef {{ x: number, y: number, z: number }} Vec3 */

/**
 * @param {number} seed
 */
export function createSeededRng(seed) {
  let state = (Math.trunc(seed) >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * @param {Vec3} a
 * @param {Vec3} b
 * @param {number} t
 */
export function lerpVec3(a, b, t) {
  const u = clamp01(t);
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    z: a.z + (b.z - a.z) * u
  };
}

/**
 * @param {Vec3} v
 */
export function normalizeVec3(v) {
  const mag = Math.hypot(v.x, v.y, v.z);
  if (mag <= 1e-15) return { x: 0, y: 0, z: 1 };
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

/**
 * @param {number} value
 */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Convention:
 * - State 0 = antiparallel free vs fixed reference (AP)
 * - State 1 = parallel free vs fixed reference (P)
 * Reference layer is pinned along +z.
 *
 * @param {0 | 1} bit
 * @returns {{ free: Vec3, reference: Vec3, alignment: "AP" | "P", label: string }}
 */
export function spinTargetsForBit(bit) {
  if (bit === 1) {
    return {
      free: { x: 0, y: 0, z: 1 },
      reference: { x: 0, y: 0, z: 1 },
      alignment: "P",
      label: "State 1 · parallel (P)"
    };
  }
  return {
    free: { x: 0, y: 0, z: -1 },
    reference: { x: 0, y: 0, z: 1 },
    alignment: "AP",
    label: "State 0 · antiparallel (AP)"
  };
}

/**
 * @param {{
 *   nx?: number,
 *   ny?: number,
 *   freeRows?: number,
 *   referenceRows?: number,
 *   bit: 0 | 1,
 *   progress?: number,
 *   fromBit?: 0 | 1,
 *   toBit?: 0 | 1,
 *   disorder?: number,
 *   damping?: number,
 *   torqueStrength?: number,
 *   externalFieldZ?: number,
 *   temperature?: number,
 *   seed?: number,
 *   freeLengthNm?: number,
 *   freeWidthNm?: number,
 *   freeThicknessNm?: number,
 *   barrierThicknessNm?: number,
 *   referenceThicknessNm?: number,
 *   materialLabel?: string,
 *   freeMagnetization?: Vec3
 * }} params
 */
export function buildSpinCellField(params) {
  const nx = Math.max(4, Math.min(24, Math.round(params.nx ?? 12)));
  const ny = Math.max(3, Math.min(16, Math.round(params.ny ?? 8)));
  const freeRows = Math.max(2, Math.min(8, Math.round(params.freeRows ?? 4)));
  const referenceRows = Math.max(2, Math.min(8, Math.round(params.referenceRows ?? 3)));
  const disorder = clamp01(params.disorder ?? 0.08);
  const damping = Math.max(0.001, Math.min(1, params.damping ?? 0.02));
  const torqueStrength = Math.max(0, Math.min(2, params.torqueStrength ?? 0));
  const externalFieldZ = Number.isFinite(params.externalFieldZ) ? /** @type {number} */ (params.externalFieldZ) : 0;
  const temperature = Math.max(0, params.temperature ?? 300);
  const seed = params.seed ?? 42;
  const progress = clamp01(params.progress ?? 0);
  const fromBit = params.fromBit ?? params.bit;
  const toBit = params.toBit ?? params.bit;
  const transitioning = params.fromBit != null && params.toBit != null && params.fromBit !== params.toBit;

  const from = spinTargetsForBit(fromBit);
  const to = spinTargetsForBit(toBit);
  const solvedFreeMagnetization = params.freeMagnetization ?? null;
  const simulated = Boolean(solvedFreeMagnetization);
  // Damping slows effective progress; torque and field assist toward the target.
  const assist = clamp01(0.35 * torqueStrength + 0.15 * Math.abs(externalFieldZ));
  const effectiveProgress = transitioning
    ? clamp01(progress ** (0.55 + damping) * (1 - 0.25 * (1 - assist)) + assist * progress)
    : 1;
  // Opposite ±z states cannot be normalized through a linear midpoint without a
  // discontinuity. Follow a deterministic rotation arc in the x-z plane instead.
  const rotationAngle = fromBit === 0
    ? Math.PI * (1 - effectiveProgress)
    : Math.PI * effectiveProgress;
  const freeTarget = solvedFreeMagnetization
    ? normalizeVec3(solvedFreeMagnetization)
    : transitioning
      ? normalizeVec3({
          x: Math.sin(rotationAngle),
          y: 0.12 * Math.sin(rotationAngle * 2),
          z: Math.cos(rotationAngle)
        })
      : normalizeVec3(lerpVec3(from.free, to.free, effectiveProgress));
  const referenceTarget = to.reference;
  const rng = createSeededRng(seed);

  /** @type {Array<{
   *   id: string,
   *   layer: "free" | "barrier" | "reference",
   *   ix: number,
   *   iy: number,
   *   x: number,
   *   y: number,
   *   z: number,
   *   mx: number,
   *   my: number,
   *   mz: number,
   *   magnitude: number
   * }>} */
  const spins = [];

  const thermal = Math.min(0.35, (temperature / 300) * 0.04);
  const noiseAmp = simulated ? 0 : disorder * 0.55 + thermal;

  /**
   * @param {"free" | "reference"} layer
   * @param {Vec3} target
   * @param {number} rowCount
   * @param {number} zBase
   * @param {number} zSpan
   */
  function fillLayer(layer, target, rowCount, zBase, zSpan) {
    for (let iy = 0; iy < rowCount; iy += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        const localSeed = createSeededRng(seed + ix * 97 + iy * 131 + (layer === "free" ? 17 : 53));
        const nxNoise = (localSeed() - 0.5) * 2 * noiseAmp;
        const nyNoise = (localSeed() - 0.5) * 2 * noiseAmp;
        const nzNoise = (localSeed() - 0.5) * 2 * noiseAmp * 0.6;
        // Reference is pinned harder than free layer.
        const pin = layer === "reference" ? 0.15 : 1;
        const oriented = normalizeVec3({
          x: target.x + nxNoise * pin,
          y: target.y + nyNoise * pin,
          z: target.z + nzNoise * pin
        });
        spins.push({
          id: `${layer}-${ix}-${iy}`,
          layer,
          ix,
          iy,
          x: (ix + 0.5) / nx,
          y: (iy + 0.5) / rowCount,
          z: zBase + ((iy + 0.5) / rowCount) * zSpan,
          mx: oriented.x,
          my: oriented.y,
          mz: oriented.z,
          magnitude: 1
        });
        void rng;
      }
    }
  }

  fillLayer("free", freeTarget, freeRows, 0.62, 0.28);
  fillLayer("reference", referenceTarget, referenceRows, 0.08, 0.22);

  const freeSpins = spins.filter((spin) => spin.layer === "free");
  const meanFree = freeSpins.reduce(
    (acc, spin) => ({ x: acc.x + spin.mx, y: acc.y + spin.my, z: acc.z + spin.mz }),
    { x: 0, y: 0, z: 0 }
  );
  const nFree = Math.max(1, freeSpins.length);
  const mean = normalizeVec3({
    x: meanFree.x / nFree,
    y: meanFree.y / nFree,
    z: meanFree.z / nFree
  });
  const desired = transitioning ? to.free : spinTargetsForBit(params.bit).free;
  const alignmentScore = clamp01(0.5 * (1 + mean.x * desired.x + mean.y * desired.y + mean.z * desired.z));
  const switchingProgress = transitioning ? effectiveProgress : params.bit === toBit ? 1 : 0;
  // Conceptual estimate only: higher torque/field and lower damping shorten the proxy time.
  const estimatedSwitchingNs =
    transitioning || params.bit !== toBit
      ? Math.max(0.05, (1.2 + 8 * damping) / (0.35 + torqueStrength + Math.abs(externalFieldZ) * 0.5))
      : 0;

  /** @type {string[]} */
  const warnings = [];
  if (disorder > 0.45) warnings.push("High disorder: orientation field is heavily perturbed (conceptual).");
  if (temperature > 450) warnings.push("Temperature above 450 K is outside the illustrative safe range.");
  if (torqueStrength > 1.5) warnings.push("Torque strength is very high relative to the conceptual model scale.");
  if ((params.barrierThicknessNm ?? 1) < 0.5) {
    warnings.push("Barrier thinner than 0.5 nm is outside the illustrative retention-safe range.");
  }

  return {
    model: simulated ? "python_llg_twin macrospin playback" : "pre-run spin configuration schematic",
    honesty: simulated
      ? "CPU Python macrospin LLG. Uniform free-layer m(t). Not MuMax3, not a mesh, not calibrated."
      : "Pre-run configuration schematic only. Not dynamics, not MuMax3 output, not calibrated, and not experimentally validated.",
    convention: "State 0 = AP (free mz≈-1); State 1 = P (free mz≈+1); reference pinned +z.",
    bit: params.bit,
    fromBit,
    toBit,
    transitioning,
    progress: effectiveProgress,
    nx,
    ny,
    freeRows,
    referenceRows,
    spins,
    meanFreeMagnetization: mean,
    metrics: {
      alignmentScore,
      switchingProgress,
      estimatedSwitchingNs,
      alignment: transitioning ? (effectiveProgress >= 0.5 ? to.alignment : from.alignment) : spinTargetsForBit(params.bit).alignment
    },
    warnings,
    parameters: {
      disorder,
      damping,
      torqueStrength,
      externalFieldZ,
      temperature,
      seed,
      freeLengthNm: params.freeLengthNm ?? null,
      freeWidthNm: params.freeWidthNm ?? null,
      freeThicknessNm: params.freeThicknessNm ?? null,
      barrierThicknessNm: params.barrierThicknessNm ?? null,
      referenceThicknessNm: params.referenceThicknessNm ?? null,
      materialLabel: params.materialLabel ?? "placeholder"
    }
  };
}

/**
 * Advance a transition progress value using conceptual damping/torque/speed.
 * @param {{
 *   progress: number,
 *   dt: number,
 *   speed?: number,
 *   damping?: number,
 *   torqueStrength?: number,
 *   externalFieldZ?: number
 * }} params
 */
export function advanceSpinTransition(params) {
  const speed = Math.max(0.05, Math.min(4, params.speed ?? 1));
  const damping = Math.max(0.001, Math.min(1, params.damping ?? 0.02));
  const torqueStrength = Math.max(0, params.torqueStrength ?? 0);
  const fieldAssist = Math.abs(params.externalFieldZ ?? 0) * 0.25;
  const rate = speed * (0.35 + torqueStrength * 0.55 + fieldAssist) / (0.45 + damping);
  return clamp01(params.progress + params.dt * rate);
}
