/**
 * Exact 1D stationary scattering solution for a finite rectangular barrier.
 *
 * Region I:   exp(ik_L x) + r exp(-ik_L x)
 * Region II:  A exp(iq x) + B exp(-iq x)
 * Region III: t exp(ik_R(x-d))
 *
 * The four complex amplitudes satisfy continuity of ψ and dψ/dx at x=0,d.
 * This is an analytical single-particle model; MuMax3 and Kwant are not invoked.
 */

/** Reduced Planck constant [J·s] */
export const HBAR = 1.054_571_817e-34;
/** Electron mass [kg] */
export const ELECTRON_MASS = 9.109_383_701_5e-31;
/** Elementary charge [C] */
export const ELECTRON_CHARGE = 1.602_176_634e-19;
/** Electron-volt in joules */
export const EV_TO_J = ELECTRON_CHARGE;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {number} nm
 */
export function nmToMeters(nm) {
  return nm * 1e-9;
}

/**
 * @param {number} eV
 */
export function eVToJoules(eV) {
  return eV * EV_TO_J;
}

/**
 * Exact stationary-state temporal phase Et/ħ in radians.
 * The caller may choose a displayed physical-time scale, but the phase itself
 * always follows the configured electron energy.
 * @param {number} electronEnergyEv
 * @param {number} physicalTimeSeconds
 */
export function schrodingerPhaseRad(electronEnergyEv, physicalTimeSeconds) {
  const energyEv = Math.max(0, Number(electronEnergyEv) || 0);
  const timeSeconds = Math.max(0, Number(physicalTimeSeconds) || 0);
  return ((eVToJoules(energyEv) * timeSeconds) / HBAR) % (2 * Math.PI);
}

/**
 * Normalize and clamp tunneling inputs. Clamps are reported, never silent.
 * @param {Partial<TunnelingParams>} raw
 * @returns {{ params: TunnelingParams, clamps: string[], placeholders: string[] }}
 *
 * @typedef {{
 *   barrierThicknessNm: number,
 *   barrierHeightEv: number,
 *   electronEnergyEv: number,
 *   effectiveMassRatio: number,
 *   biasVolts: number,
 *   temperatureK: number,
 *   cellAreaNm2: number,
 *   spinState: 0 | 1,
 *   spinPolarization: number,
 *   samplePoints?: number,
 *   materialLabel?: string,
 *   barrierHeightIsPlaceholder?: boolean,
 *   effectiveMassIsPlaceholder?: boolean
 * }} TunnelingParams
 */
export function normalizeTunnelingParams(raw = {}) {
  /** @type {string[]} */
  const clamps = [];
  /** @type {string[]} */
  const placeholders = [];

  /**
   * @param {number | undefined} value
   * @param {number} fallback
   * @param {number} min
   * @param {number} max
   * @param {string} name
   */
  const bounded = (value, fallback, min, max, name) => {
    const source = Number.isFinite(value) ? /** @type {number} */ (value) : fallback;
    const next = clamp(source, min, max);
    if (next !== source) clamps.push(`${name} clamped from ${source} to ${next}`);
    return next;
  };

  const params = {
    barrierThicknessNm: bounded(raw.barrierThicknessNm, 1.0, 0.2, 5, "barrierThicknessNm"),
    barrierHeightEv: bounded(raw.barrierHeightEv, 1.2, 0.1, 8, "barrierHeightEv"),
    electronEnergyEv: bounded(raw.electronEnergyEv, 0.25, 0.01, 10, "electronEnergyEv"),
    effectiveMassRatio: bounded(raw.effectiveMassRatio, 0.4, 0.05, 2, "effectiveMassRatio"),
    biasVolts: bounded(raw.biasVolts, 0, -1.5, 1.5, "biasVolts"),
    temperatureK: bounded(raw.temperatureK, 300, 0, 800, "temperatureK"),
    cellAreaNm2: bounded(raw.cellAreaNm2, 40 * 40, 1, 1e6, "cellAreaNm2"),
    spinState: /** @type {0 | 1} */ (raw.spinState === 1 ? 1 : 0),
    spinPolarization: bounded(raw.spinPolarization, 0.4, 0, 1, "spinPolarization"),
    samplePoints: Math.round(bounded(raw.samplePoints, 201, 41, 801, "samplePoints")),
    materialLabel: raw.materialLabel ?? "MgO-like barrier (placeholder)",
    barrierHeightIsPlaceholder: raw.barrierHeightIsPlaceholder !== false,
    effectiveMassIsPlaceholder: raw.effectiveMassIsPlaceholder !== false
  };

  if (params.barrierHeightIsPlaceholder) {
    placeholders.push("barrierHeightEv is a placeholder example value, not a measured MgO barrier height.");
  }
  if (params.effectiveMassIsPlaceholder) {
    placeholders.push("effectiveMassRatio is a placeholder tunneling effective-mass factor.");
  }
  return { params, clamps, placeholders };
}

/**
 * Decay constant κ = sqrt(2 m_eff (V-E)) / ħ for E < V.
 * @param {Partial<TunnelingParams>} raw
 */
export function calculateKappa(raw) {
  const { params, clamps, placeholders } = normalizeTunnelingParams(raw);
  const mEff = params.effectiveMassRatio * ELECTRON_MASS;
  const barrierLeftEv = params.barrierHeightEv - 0.5 * params.biasVolts;
  const barrierRightEv = params.barrierHeightEv + 0.5 * params.biasVolts;
  const meanBarrierEv = 0.5 * (barrierLeftEv + barrierRightEv);
  const deltaEv = meanBarrierEv - params.electronEnergyEv;
  if (deltaEv <= 0) {
    return {
      kappa: 0,
      regime: /** @type {const} */ ("over_barrier"),
      meanBarrierEv,
      params,
      clamps,
      placeholders,
      formula: "kappa = 0 (E >= mean barrier; over-barrier / weak-barrier regime)"
    };
  }
  const kappa = Math.sqrt(2 * mEff * eVToJoules(deltaEv)) / HBAR;
  return {
    kappa,
    regime: /** @type {const} */ ("tunneling"),
    meanBarrierEv,
    params,
    clamps,
    placeholders,
    formula: "kappa = sqrt(2*m_eff*(V_mean - E)) / hbar"
  };
}

/** @typedef {{ re: number, im: number }} Complex */
/** @param {number} re @param {number} [im] @returns {Complex} */
function complex(re, im = 0) {
  return { re, im };
}
/** @param {Complex} a @param {Complex} b */
function cAdd(a, b) {
  return complex(a.re + b.re, a.im + b.im);
}
/** @param {Complex} a @param {Complex} b */
function cSub(a, b) {
  return complex(a.re - b.re, a.im - b.im);
}
/** @param {Complex} a @param {Complex} b */
function cMul(a, b) {
  return complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}
/** @param {Complex} a @param {Complex} b */
function cDiv(a, b) {
  const denominator = b.re * b.re + b.im * b.im;
  if (denominator < 1e-300) throw new Error("Singular tunneling boundary system.");
  return complex(
    (a.re * b.re + a.im * b.im) / denominator,
    (a.im * b.re - a.re * b.im) / denominator
  );
}
/** @param {Complex} value */
function cAbs2(value) {
  return value.re * value.re + value.im * value.im;
}
/** @param {Complex} value */
function cExp(value) {
  const magnitude = Math.exp(value.re);
  return complex(magnitude * Math.cos(value.im), magnitude * Math.sin(value.im));
}

/**
 * Solve a dense complex linear system with partial pivoting.
 * @param {Complex[][]} matrix
 * @param {Complex[]} rhs
 * @returns {Complex[]}
 */
function solveComplexSystem(matrix, rhs) {
  const n = rhs.length;
  const augmented = matrix.map((row, index) => [...row.map((item) => ({ ...item })), { ...rhs[index] }]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (cAbs2(augmented[row][column]) > cAbs2(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (cAbs2(divisor) < 1e-28) throw new Error("Degenerate tunneling boundary conditions.");
    for (let j = column; j <= n; j += 1) {
      augmented[column][j] = cDiv(augmented[column][j], divisor);
    }
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = column; j <= n; j += 1) {
        augmented[row][j] = cSub(augmented[row][j], cMul(factor, augmented[column][j]));
      }
    }
  }
  return augmented.map((row) => row[n]);
}

const BARRIER_SLICES = 192;

/**
 * k² = 2m(E−V)/ħ². Negative means evanescent.
 * @param {number} energyEv
 * @param {number} potentialEv
 * @param {number} mass
 */
function kSquared(energyEv, potentialEv, mass) {
  return (2 * mass * eVToJoules(energyEv - potentialEv)) / (HBAR * HBAR);
}

/**
 * Inverse slice map: values at x+Δ → values at x for ψ'' = −k² ψ.
 * @param {Complex} psi
 * @param {Complex} dpsi
 * @param {number} k2
 * @param {number} width
 */
function transferLeft(psi, dpsi, k2, width) {
  if (width === 0) return { psi, dpsi };
  if (k2 > 1e-24) {
    const k = Math.sqrt(k2);
    const c = Math.cos(k * width);
    const s = Math.sin(k * width);
    return {
      psi: cAdd(cMul(complex(c), psi), cMul(complex(-s / k), dpsi)),
      dpsi: cAdd(cMul(complex(k * s), psi), cMul(complex(c), dpsi))
    };
  }
  if (k2 < -1e-24) {
    const kappa = Math.sqrt(-k2);
    const ch = Math.cosh(kappa * width);
    const sh = Math.sinh(kappa * width);
    return {
      psi: cAdd(cMul(complex(ch), psi), cMul(complex(-sh / kappa), dpsi)),
      dpsi: cAdd(cMul(complex(-kappa * sh), psi), cMul(complex(ch), dpsi))
    };
  }
  return { psi: cSub(psi, cMul(complex(width), dpsi)), dpsi };
}

/**
 * Forward slice map: values at x → values at x+Δ.
 * @param {Complex} psi
 * @param {Complex} dpsi
 * @param {number} k2
 * @param {number} width
 */
function transferRight(psi, dpsi, k2, width) {
  if (width === 0) return { psi, dpsi };
  if (k2 > 1e-24) {
    const k = Math.sqrt(k2);
    const c = Math.cos(k * width);
    const s = Math.sin(k * width);
    return {
      psi: cAdd(cMul(complex(c), psi), cMul(complex(s / k), dpsi)),
      dpsi: cAdd(cMul(complex(-k * s), psi), cMul(complex(c), dpsi))
    };
  }
  if (k2 < -1e-24) {
    const kappa = Math.sqrt(-k2);
    const ch = Math.cosh(kappa * width);
    const sh = Math.sinh(kappa * width);
    return {
      psi: cAdd(cMul(complex(ch), psi), cMul(complex(sh / kappa), dpsi)),
      dpsi: cAdd(cMul(complex(kappa * sh), psi), cMul(complex(ch), dpsi))
    };
  }
  return { psi: cAdd(psi, cMul(complex(width), dpsi)), dpsi };
}

/**
 * Stationary scattering on the trapezoidal barrier, unit incident amplitude.
 * Same mass on all regions, so ψ and dψ/dx are continuous.
 * @param {TunnelingParams} params
 */
function solveTrapezoidalBarrier(params) {
  const mass = params.effectiveMassRatio * ELECTRON_MASS;
  const energyJ = eVToJoules(params.electronEnergyEv);
  const d = nmToMeters(params.barrierThicknessNm);
  const kLeft = Math.sqrt(Math.max(0, 2 * mass * energyJ)) / HBAR;
  const rightKineticEv = params.electronEnergyEv + params.biasVolts;
  const kRight2 = (2 * mass * eVToJoules(rightKineticEv)) / (HBAR * HBAR);
  const kRight = kRight2 > 0 ? Math.sqrt(kRight2) : 0;
  const kappaRight = kRight2 < 0 ? Math.sqrt(-kRight2) : 0;

  /** @type {Complex} */
  let psi = complex(1);
  /** @type {Complex} */
  let dpsi = kappaRight > 0 ? complex(-kappaRight) : complex(0, kRight);

  const slice = d / BARRIER_SLICES;
  for (let index = BARRIER_SLICES - 1; index >= 0; index -= 1) {
    const xMidNm = ((index + 0.5) / BARRIER_SLICES) * params.barrierThicknessNm;
    const k2 = kSquared(params.electronEnergyEv, potentialEvAt(xMidNm, params), mass);
    const next = transferLeft(psi, dpsi, k2, slice);
    psi = next.psi;
    dpsi = next.dpsi;
  }

  const ikLeft = complex(0, kLeft);
  const incident = cMul(complex(0.5), cAdd(psi, cDiv(dpsi, ikLeft)));
  const reflectedAmp = cMul(complex(0.5), cSub(psi, cDiv(dpsi, ikLeft)));
  if (cAbs2(incident) < 1e-30) throw new Error("Vanishing incident amplitude in trapezoidal barrier.");
  const scale = cDiv(complex(1), incident);
  const reflectionAmplitude = cMul(reflectedAmp, scale);
  const transmissionAmplitude = scale;
  const reflection = cAbs2(reflectionAmplitude);
  const transmission = kRight > 0 ? (kRight / kLeft) * cAbs2(transmissionAmplitude) : 0;
  const qMid = kSquared(
    params.electronEnergyEv,
    potentialEvAt(params.barrierThicknessNm / 2, params),
    mass
  );
  const q =
    qMid >= 0
      ? complex(Math.sqrt(qMid), 0)
      : complex(0, Math.sqrt(-qMid));
  return {
    kLeft,
    kRight,
    q,
    kappa: Math.abs(q.im),
    regime: /** @type {"tunneling" | "over_barrier"} */ (q.im ? "tunneling" : "over_barrier"),
    barrierEv: params.barrierHeightEv,
    rightPotentialEv: -params.biasVolts,
    barrierThicknessM: d,
    reflectionAmplitude,
    forwardBarrierAmplitude: complex(0),
    backwardBarrierAmplitude: complex(0),
    transmissionAmplitude,
    reflection,
    transmission,
    probabilityConservation: reflection + transmission,
    formula:
      "−(ħ²/2m)ψ″+V(x)ψ=Eψ on V(x)=V0−V_bias x/d in the barrier; ψ and dψ/dx continuous; T=(k_R/k_L)|t|²",
    honesty:
      "Exact 1D stationary scattering for the stated trapezoidal effective-mass Hamiltonian. Not experimentally validated; not a Kwant, TMR, resistance, or calibrated-device result."
  };
}

/**
 * ψ(x) for the solved trapezoidal state, unit incident wave from the left.
 * @param {number} xNm
 * @param {TunnelingParams} params
 * @param {ReturnType<typeof solveTrapezoidalBarrier>} solution
 */
function psiTrapezoidAt(xNm, params, solution) {
  const mass = params.effectiveMassRatio * ELECTRON_MASS;
  const x = nmToMeters(xNm);
  const i = complex(0, 1);
  if (xNm < 0) {
    const incident = cExp(cMul(i, complex(solution.kLeft * x)));
    const reflected = cMul(
      solution.reflectionAmplitude,
      cExp(cMul(complex(0, -1), complex(solution.kLeft * x)))
    );
    return cAdd(incident, reflected);
  }
  if (xNm > params.barrierThicknessNm) {
    const xi = x - solution.barrierThicknessM;
    if (solution.kRight > 0) {
      return cMul(solution.transmissionAmplitude, cExp(cMul(i, complex(solution.kRight * xi))));
    }
    const kappa = Math.abs(
      Math.sqrt(Math.max(0, -kSquared(params.electronEnergyEv, -params.biasVolts, mass)))
    );
    return cMul(solution.transmissionAmplitude, cExp(complex(-kappa * xi)));
  }
  let psi = cAdd(complex(1), solution.reflectionAmplitude);
  let dpsi = cMul(complex(0, solution.kLeft), cSub(complex(1), solution.reflectionAmplitude));
  const d = solution.barrierThicknessM;
  const slice = d / BARRIER_SLICES;
  const target = Math.min(d, Math.max(0, x));
  let walked = 0;
  for (let index = 0; index < BARRIER_SLICES && walked < target - 1e-22; index += 1) {
    const step = Math.min(slice, target - walked);
    const xMidNm = ((index + 0.5) / BARRIER_SLICES) * params.barrierThicknessNm;
    const k2 = kSquared(params.electronEnergyEv, potentialEvAt(xMidNm, params), mass);
    const next = transferRight(psi, dpsi, k2, step);
    psi = next.psi;
    dpsi = next.dpsi;
    walked += step;
  }
  return psi;
}

/**
 * Finite-difference residual of (−ħ²/2m ψ″ + Vψ − Eψ) relative to |Eψ|.
 * @param {Array<{ xNm: number, psiRe: number, psiIm: number, Vev: number }>} points
 * @param {TunnelingParams} params
 */
function annotateAccuracy(points, params) {
  const mass = params.effectiveMassRatio * ELECTRON_MASS;
  const energyJ = eVToJoules(params.electronEnergyEv);
  const prefactor = -(HBAR * HBAR) / (2 * mass);
  let peakIndex = 0;
  let peakProb = -1;
  const annotated = points.map((point, index) => {
    const psi = complex(point.psiRe, point.psiIm);
    const prob = cAbs2(psi);
    if (prob > peakProb) {
      peakProb = prob;
      peakIndex = index;
    }
    if (index === 0 || index === points.length - 1) {
      return { ...point, prob, residual: 0, accuracy: 1 };
    }
    const xM = points.map((item) => nmToMeters(item.xNm));
    const dxL = xM[index] - xM[index - 1];
    const dxR = xM[index + 1] - xM[index];
    if (dxL < 1e-24 || dxR < 1e-24) {
      return { ...point, prob, residual: 0, accuracy: 1 };
    }
    const psiL = complex(points[index - 1].psiRe, points[index - 1].psiIm);
    const psiR = complex(points[index + 1].psiRe, points[index + 1].psiIm);
    const dLeft = cMul(cSub(psi, psiL), complex(1 / dxL));
    const dRight = cMul(cSub(psiR, psi), complex(1 / dxR));
    const d2 = cMul(cSub(dRight, dLeft), complex(2 / (dxL + dxR)));
    const vTerm = cMul(psi, complex(eVToJoules(point.Vev)));
    const eTerm = cMul(psi, complex(energyJ));
    const residualAmp = cSub(cAdd(cMul(d2, complex(prefactor)), vTerm), eTerm);
    const residual = Math.sqrt(cAbs2(residualAmp));
    const scale = Math.max(Math.abs(energyJ) * Math.sqrt(Math.max(prob, 1e-30)), 1e-30);
    const accuracy = 1 / (1 + residual / scale);
    return { ...point, prob, residual, accuracy };
  });
  const maxProb = Math.max(peakProb, 1e-12);
  return {
    points: annotated.map((point) => ({ ...point, probNorm: point.prob / maxProb })),
    peakIndex,
    peakXNm: annotated[peakIndex].xNm,
    peakProb: annotated[peakIndex].prob
  };
}

/**
 * Exact finite-barrier amplitudes from the time-independent Schrödinger equation.
 * Zero bias uses the closed rectangular matching system; finite bias uses the
 * trapezoidal transfer-matrix limit of that same Hamiltonian.
 * @param {Partial<TunnelingParams>} raw
 */
export function solveFiniteBarrier(raw = {}) {
  const { params, clamps, placeholders } = normalizeTunnelingParams(raw);
  if (Math.abs(params.biasVolts) > 1e-12) {
    return { params, clamps, placeholders, ...solveTrapezoidalBarrier(params) };
  }
  const mass = params.effectiveMassRatio * ELECTRON_MASS;
  const energyJ = eVToJoules(params.electronEnergyEv);
  const barrierEv = params.barrierHeightEv - 0.5 * params.biasVolts;
  const rightPotentialEv = -params.biasVolts;
  const rightKineticEv = params.electronEnergyEv - rightPotentialEv;
  const kLeft = Math.sqrt(2 * mass * energyJ) / HBAR;
  const kRight =
    rightKineticEv > 0
      ? Math.sqrt(2 * mass * eVToJoules(rightKineticEv)) / HBAR
      : 0;
  const barrierDeltaEv = params.electronEnergyEv - barrierEv;
  let q =
    barrierDeltaEv >= 0
      ? complex(Math.sqrt(2 * mass * eVToJoules(barrierDeltaEv)) / HBAR, 0)
      : complex(0, Math.sqrt(2 * mass * eVToJoules(-barrierDeltaEv)) / HBAR);
  const d = nmToMeters(params.barrierThicknessNm);
  if (Math.abs(barrierDeltaEv) < 1e-12 && Math.abs(params.biasVolts) < 1e-12) {
    const halfKd = (kLeft * d) / 2;
    const denominator = complex(1, -halfKd);
    const transmissionAmplitude = cDiv(complex(1), denominator);
    const reflectionAmplitude = cDiv(complex(0, halfKd), denominator);
    const transmission = cAbs2(transmissionAmplitude);
    const reflection = cAbs2(reflectionAmplitude);
    return {
      params,
      clamps,
      placeholders,
      kLeft,
      kRight,
      q,
      kappa: 0,
      regime: /** @type {const} */ ("over_barrier"),
      barrierEv,
      rightPotentialEv,
      barrierThicknessM: d,
      reflectionAmplitude,
      forwardBarrierAmplitude: complex(0),
      backwardBarrierAmplitude: complex(0),
      transmissionAmplitude,
      reflection,
      transmission,
      probabilityConservation: reflection + transmission,
      formula: "E=V limit of finite rectangular barrier: T=1/(1+(k d/2)^2)",
      honesty:
        "Exact 1D finite rectangular-barrier scattering solution for the stated effective-mass assumptions. Not experimentally validated; not a Kwant, TMR, resistance, or calibrated-device result."
    };
  }
  // At E=V with a finite right-lead step, use the continuous q→0 limit.
  if (cAbs2(q) < 1e-24) q = complex(Math.max(kLeft * 1e-8, 1e-4), 0);
  const i = complex(0, 1);
  const ikLeft = cMul(i, complex(kLeft));
  const ikRight = cMul(i, complex(kRight));
  const iq = cMul(i, q);
  const eForward = cExp(cMul(iq, complex(d)));
  const eBackward = cExp(cMul(complex(0, -1), cMul(q, complex(d))));
  const zero = complex(0);
  const one = complex(1);

  const [reflectionAmplitude, forwardBarrierAmplitude, backwardBarrierAmplitude, transmissionAmplitude] =
    solveComplexSystem(
      [
        [one, complex(-1), complex(-1), zero],
        [complex(-ikLeft.re, -ikLeft.im), complex(-iq.re, -iq.im), iq, zero],
        [zero, eForward, eBackward, complex(-1)],
        [
          zero,
          cMul(iq, eForward),
          cMul(complex(-iq.re, -iq.im), eBackward),
          complex(-ikRight.re, -ikRight.im)
        ]
      ],
      [complex(-1), complex(-ikLeft.re, -ikLeft.im), zero, zero]
    );

  const reflection = cAbs2(reflectionAmplitude);
  const transmission = kRight > 0 ? (kRight / kLeft) * cAbs2(transmissionAmplitude) : 0;
  return {
    params,
    clamps,
    placeholders,
    kLeft,
    kRight,
    q,
    kappa: Math.abs(q.im),
    regime: /** @type {"tunneling" | "over_barrier"} */ (q.im ? "tunneling" : "over_barrier"),
    barrierEv,
    rightPotentialEv,
    barrierThicknessM: d,
    reflectionAmplitude,
    forwardBarrierAmplitude,
    backwardBarrierAmplitude,
    transmissionAmplitude,
    reflection,
    transmission,
    probabilityConservation: reflection + transmission,
    formula:
      "ψI=e^(ikLx)+r e^(-ikLx); ψII=A e^(iqx)+B e^(-iqx); ψIII=t e^(ikR(x-d)); ψ,dψ/dx continuous at 0,d",
    honesty:
      "Exact 1D finite rectangular-barrier scattering solution for the stated effective-mass assumptions. Not experimentally validated; not a Kwant, TMR, resistance, or calibrated-device result."
  };
}

/**
 * Spin alignment modulates transmission conceptually:
 * parallel (state 1) increases T, antiparallel (state 0) decreases T.
 * This is an explicit model factor, not measured TMR.
 * @param {0 | 1} spinState
 * @param {number} spinPolarization
 */
export function spinTransmissionFactor(spinState, spinPolarization) {
  const p = clamp(spinPolarization, 0, 1);
  // Julliere-like conceptual factor on probability, labeled as model factor only.
  return spinState === 1 ? 1 + p : Math.max(0.05, 1 - p);
}

/**
 * @param {Partial<TunnelingParams>} raw
 */
export function calculateTransmission(raw) {
  return solveFiniteBarrier(raw);
}

/**
 * @param {Partial<TunnelingParams>} raw
 */
/**
 * Electrostatics of a uniform field in the insulator: electrodes at 0 and -V_bias,
 * barrier offset V0. Zero bias recovers the exact rectangle.
 * @param {number} xNm
 * @param {TunnelingParams} params
 */
export function potentialEvAt(xNm, params) {
  const dNm = params.barrierThicknessNm;
  if (xNm < 0) return 0;
  if (xNm > dNm) return -params.biasVolts;
  return params.barrierHeightEv - params.biasVolts * (xNm / Math.max(dNm, 1e-15));
}

/**
 * @param {number} xNm
 * @param {number} dNm
 */
function regionAt(xNm, dNm) {
  if (xNm < 0) return /** @type {const} */ ("left");
  if (xNm > dNm) return /** @type {const} */ ("right");
  return /** @type {const} */ ("barrier");
}

/**
 * @param {Partial<TunnelingParams>} raw
 */
export function generatePotentialProfile(raw) {
  const { params, clamps, placeholders } = normalizeTunnelingParams(raw);
  const n = params.samplePoints ?? 201;
  const dNm = params.barrierThicknessNm;
  const pad = dNm * 1.25;
  const xMin = -pad;
  const xMax = dNm + pad;
  /** @type {Array<{ xNm: number, Vev: number, region: "left" | "barrier" | "right" }>} */
  const points = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const xNm = xMin + (xMax - xMin) * t;
    points.push({
      xNm,
      Vev: potentialEvAt(xNm, params),
      region: regionAt(xNm, dNm)
    });
  }
  return {
    params,
    clamps,
    placeholders,
    xMinNm: xMin,
    xMaxNm: xMax,
    electronEnergyEv: params.electronEnergyEv,
    points,
    formula:
      "Trapezoidal 1D barrier: V(x<0)=0, V(0≤x≤d)=V0 − V_bias x/d, V(x>d)=−V_bias. Zero bias is the exact rectangle."
  };
}

/**
 * Sample the exact complex stationary scattering state from solveFiniteBarrier().
 * @param {Partial<TunnelingParams>} raw
 */
export function generateWavefunctionProfile(raw) {
  const potential = generatePotentialProfile(raw);
  const solution = solveFiniteBarrier(raw);
  const { params } = solution;
  const i = complex(0, 1);
  const useTrapezoid = Math.abs(params.biasVolts) > 1e-12;
  /** @type {Array<{ xNm: number, psi: number, psiRe: number, psiIm: number, Vev: number, region: "left" | "barrier" | "right" }>} */
  const points = [];
  for (const sample of potential.points) {
    /** @type {Complex} */
    let psi;
    if (useTrapezoid) {
      psi = psiTrapezoidAt(sample.xNm, params, solution);
    } else if (sample.region === "left") {
      const x = nmToMeters(sample.xNm);
      const incident = cExp(cMul(i, complex(solution.kLeft * x)));
      const reflected = cMul(
        solution.reflectionAmplitude,
        cExp(cMul(complex(0, -1), complex(solution.kLeft * x)))
      );
      psi = cAdd(incident, reflected);
    } else if (sample.region === "barrier") {
      const x = nmToMeters(sample.xNm);
      const forward = cMul(
        solution.forwardBarrierAmplitude,
        cExp(cMul(i, cMul(solution.q, complex(x))))
      );
      const backward = cMul(
        solution.backwardBarrierAmplitude,
        cExp(cMul(complex(0, -1), cMul(solution.q, complex(x))))
      );
      psi = cAdd(forward, backward);
    } else {
      const x = nmToMeters(sample.xNm);
      psi = cMul(
        solution.transmissionAmplitude,
        cExp(cMul(i, complex(solution.kRight * (x - solution.barrierThicknessM))))
      );
    }
    points.push({
      xNm: sample.xNm,
      psi: psi.re,
      psiRe: psi.re,
      psiIm: psi.im,
      Vev: sample.Vev,
      region: sample.region
    });
  }
  const annotated = annotateAccuracy(points, params);
  return {
    ...solution,
    potential,
    points: annotated.points,
    peakIndex: annotated.peakIndex,
    peakXNm: annotated.peakXNm,
    peakProb: annotated.peakProb,
    formula: solution.formula
  };
}

/**
 * Leakage risk rises with transmission; retention falls with leakage.
 * @param {Partial<TunnelingParams>} raw
 */
export function calculateLeakageRetention(raw) {
  const transmission = calculateTransmission(raw);
  const T = transmission.transmission;
  // Conceptual mapping only.
  const leakageRisk = clamp(T / (T + 1e-4), 0, 1);
  const retentionScore = clamp(1 - leakageRisk, 0, 1);
  let warning = "low leak";
  if (leakageRisk >= 0.66) warning = "high leak";
  else if (leakageRisk >= 0.33) warning = "moderate leak";
  return {
    ...transmission,
    leakageRisk,
    retentionScore,
    warning,
    formula: "leakageRisk = T/(T+1e-4); retentionScore = 1 - leakageRisk",
    honesty:
      "Leakage/retention gauges are analytical model outputs only. Not experimentally validated. Not a product retention rating."
  };
}

/**
 * Convenience aggregate used by the wave view.
 * @param {Partial<TunnelingParams>} raw
 */
export function evaluateTunnelingModel(raw) {
  const wave = generateWavefunctionProfile(raw);
  return {
    ...wave,
    potential: wave.potential,
    wavePoints: wave.points,
    peakXNm: wave.peakXNm,
    peakProb: wave.peakProb,
    model: Math.abs(wave.params.biasVolts) > 1e-12
      ? "1D trapezoidal-barrier Schrödinger scattering"
      : "exact 1D finite rectangular-barrier scattering",
    honesty: wave.honesty
  };
}
