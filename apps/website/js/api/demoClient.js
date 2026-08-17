/**
 * Local demo adapter for the UI workflow.
 * This is not a network client and does not call MuMax3, Kwant, or a surrogate.
 */

import { createMockResult } from "../simulator/lib/mockResults.js";
import { hasBlockingErrors } from "../simulator/lib/validation.js";

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @param {() => boolean} [isPaused]
 */
async function wait(ms, signal, isPaused) {
  if (ms <= 0) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return;
  }
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    while (isPaused?.()) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
}

/**
 * @returns {string}
 */
function createJobId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `demo-${Date.now()}`;
}

/**
 * Demo-only job runner. Status changes are UI choreography, not solver progress.
 *
 * @param {import("../simulator/lib/types").SimulationRequest} request
 * @param {{
 *   signal?: AbortSignal,
 *   isPaused?: () => boolean,
 *   onStatus?: (status: import("../simulator/lib/types").SimulationStatus) => void | Promise<void>,
 *   delays?: { validating?: number, queued?: number, running?: number }
 * }} [options]
 * @returns {Promise<import("../simulator/lib/types").SimulationResponse>}
 */
export async function submitDemoSimulation(request, options = {}) {
  const jobId = createJobId();
  const onStatus = options.onStatus ?? (() => {});
  const signal = options.signal;
  const isPaused = options.isPaused;
  const delays = {
    validating: options.delays?.validating ?? 160,
    queued: options.delays?.queued ?? 220,
    running: options.delays?.running ?? 720
  };

  await onStatus("validating");
  await wait(delays.validating, signal, isPaused);

  if (hasBlockingErrors(request.scenario.validation)) {
    return {
      jobId,
      status: "failed",
      error: {
        code: "validation_failed",
        message: "Scenario has blocking validation errors. Demo run was not started."
      },
      provenance: {
        createdAt: new Date().toISOString(),
        createdBy: "system",
        solver: "none",
        notes: ["Validation failed before the demo fixture was assembled."]
      }
    };
  }

  if (request.requestedSolver !== "demo") {
    return {
      jobId,
      status: "failed",
      error: {
        code: "solver_not_connected",
        message: `${request.requestedSolver} is not connected in this UI shell.`
      },
      provenance: {
        createdAt: new Date().toISOString(),
        createdBy: "system",
        solver: request.requestedSolver,
        notes: ["Requested solver is a draft target only."]
      }
    };
  }

  await onStatus("queued");
  await wait(delays.queued, signal, isPaused);
  await onStatus("running");
  await wait(delays.running, signal, isPaused);

  const result = createMockResult(request.scenario);
  return {
    jobId,
    status: "complete",
    result,
    provenance: result.provenance
  };
}
