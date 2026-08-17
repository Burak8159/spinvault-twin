/**
 * Concise workspace status copy. Honest about demo vs API / pending solvers.
 */

import { hasBlockingErrors } from "./validation.js";

/** @type {Record<import("./types").SimulationStatus, string>} */
export const STATUS_LABELS = {
  idle: "Idle",
  validating: "Preparing",
  queued: "Queued",
  preparing: "Preparing job",
  checking_environment: "Checking environment",
  generating_solver_input: "Generating solver input",
  running_solver: "Running solver",
  parsing_outputs: "Parsing outputs",
  running: "Running solver",
  complete: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
  not_configured: "Not configured"
};

/** Statuses that mean a remote/local run is still in flight. */
export const BUSY_STATUSES = new Set([
  "validating",
  "queued",
  "preparing",
  "checking_environment",
  "generating_solver_input",
  "running_solver",
  "parsing_outputs",
  "running"
]);

/**
 * @param {import("./types").WorkspaceSnapshot} snapshot
 */
export function resultsPanelMessage(snapshot) {
  if (snapshot.result) return null;
  const solver = snapshot.state.solverTarget;

  if (snapshot.status === "not_configured") {
    return {
      kind: "warning",
      title: "Solver not configured",
      body:
        snapshot.error?.message ??
        `${solver} is not configured on the backend. No physical execution was performed.`
    };
  }

  if (BUSY_STATUSES.has(snapshot.status)) {
    return {
      kind: "busy",
      title: STATUS_LABELS[snapshot.status] ?? snapshot.status,
      body:
        solver === "demo"
          ? "Demo workflow in progress. No physics solver is executing."
          : solver === "python_micromagnetic"
            ? "Waiting on the local Python mesh LLGS solver."
            : solver === "python_llg"
              ? "Waiting on the local Python LLG twin."
              : `Waiting on the local solver (${solver}).`
    };
  }

  if (snapshot.status === "failed" || snapshot.error) {
    return {
      kind: "error",
      title: "Run failed",
      body: snapshot.error?.message ?? "The run stopped before a result was available."
    };
  }

  if (snapshot.status === "cancelled") {
    return {
      kind: "warning",
      title: "Run cancelled",
      body: "No result was kept. Adjust inputs and run again when ready."
    };
  }

  if (hasBlockingErrors(snapshot.state.validation)) {
    return {
      kind: "error",
      title: "Validation blocked",
      body: "Fix the listed input errors before submitting a run."
    };
  }

  return {
    kind: "empty",
    title: "No result yet",
    body:
      snapshot.state.solverTarget === "python_micromagnetic"
        ? "Run the Python mesh LLGS solver. Spatial maps appear only from returned mesh frames. Not MuMax3."
        : "Run the Python LLG twin. The spin view plays the returned m(t). Not MuMax3."
  };
}

/**
 * Remaining limitations visible in Settings.
 */
export const REMAINING_LIMITATIONS = [
  "Python mesh LLGS is a local 64×32×1 finite-difference solve with Newell FFT demagnetization. nz=1: no through-thickness domains. Spatial maps appear only from returned mesh frames.",
  "The Python LLG option is a uniform free-layer macrospin. That is not a spatial mesh.",
  "Write current is Slonczewski spin-transfer torque. The zero-temperature threshold is Jc0 = 4 e α K_eff t / (ħ η). Coherent rotation overestimates real nucleation Jc; values below Jc0 will not reverse the bit.",
  "Temperature enters the integrator as a Brown thermal field. T = 0 is deterministic; T > 0 is stochastic Heun with independent noise in every magnetic cell on the mesh.",
  "Quantum Wave is an analytical 1D finite-barrier Schrödinger model. Its barrier and bias also set the Tsu-Esaki leakage current, and the solved magnetization angle sets the Julliere resistance, so both views read one chain.",
  "Retention is a macrospin Néel-Arrhenius estimate from K_eff = K_u1 - mu_0 M_s^2/2, the free-layer volume, and temperature. The 1 ns attempt time is assumed, and it is not a product retention rating.",
  "Barrier height, tunneling effective mass, and the lead Fermi level are placeholders until replaced with reviewed values.",
  "MuMax3 is not used. Mesh maps are Python NPZ frames, not OVF/CUDA/RTX.",
  "Kwant and surrogate adapters remain not_configured.",
  "Local demo adapter remains available as a no-network fallback.",
  "Material presets are example or review-needed labels, not verified constants."
];
