/**
 * Twin API client boundary.
 * - Demo can run locally (fallback) or via the FastAPI demo executor.
 * - MuMax3 / Kwant / surrogate always go through the backend (honest not_configured today).
 */

import { getDemoExecutionMode } from "./config.js";
import { submitDemoSimulation } from "./demoClient.js";
import { serializeSimulationRequest } from "./serialize.js";
import {
  ApiClientError,
  cancelSimulation,
  getOvfFrame,
  getSimulationJob,
  getSimulationResult,
  getSolversStatus,
  pollSimulationJob,
  submitSimulationJob
} from "./remoteClient.js";
import { jobRecordToSimulationResponse } from "./jobMapper.js";

export {
  cancelSimulation,
  getOvfFrame,
  getSimulationJob,
  getSimulationResult,
  getSolversStatus,
  pollSimulationJob,
  submitSimulationJob,
  ApiClientError
};
export { submitDemoSimulation };
export { serializeSimulationRequest };
export { DEFAULT_API_URL, getApiBaseUrl, setApiBaseUrl, getDemoExecutionMode, setDemoExecutionMode } from "./config.js";

/**
 * @param {import("../simulator/lib/types").SolverTarget} solver
 * @param {{ forceRemote?: boolean, forceLocalDemo?: boolean }} [options]
 * @returns {"local_demo" | "remote"}
 */
export function resolveExecutionPath(solver, options = {}) {
  if (options.forceLocalDemo) return "local_demo";
  if (options.forceRemote) return "remote";
  if (solver === "demo" && getDemoExecutionMode() === "local") return "local_demo";
  return "remote";
}

/**
 * Submit a scenario using the configured execution path.
 *
 * @param {import("../simulator/lib/types").SimulationRequest} request
 * @param {{
 *   signal?: AbortSignal,
 *   isPaused?: () => boolean,
 *   onStatus?: (status: import("../simulator/lib/types").SimulationStatus, detail?: { job?: import("../simulator/lib/types").JobRecord, warnings?: string[] }) => void | Promise<void>,
 *   delays?: { validating?: number, queued?: number, running?: number },
 *   forceRemote?: boolean,
 *   forceLocalDemo?: boolean,
 *   pollIntervalMs?: number
 * }} [options]
 * @returns {Promise<import("../simulator/lib/types").SimulationResponse>}
 */
export async function submitSimulation(request, options = {}) {
  const path = resolveExecutionPath(request.requestedSolver, options);
  if (path === "local_demo") {
    return submitDemoSimulation(request, options);
  }

  const { payload, warnings } = serializeSimulationRequest(request.scenario, request.requestedSolver);
  if (warnings.length) {
    await options.onStatus?.("validating", { warnings });
  } else {
    await options.onStatus?.("validating", { warnings });
  }

  let job;
  try {
    job = await submitSimulationJob(payload, { signal: options.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ApiClientError) {
      return {
        jobId: `local-error-${Date.now()}`,
        status: "failed",
        error: { code: error.code, message: error.message },
        provenance: {
          createdAt: new Date().toISOString(),
          createdBy: "system",
          solver: "none",
          notes: ["API submission failed before a job record was stored."]
        },
        warnings: warnings.map((message) => ({ code: "serialize_warning", message }))
      };
    }
    throw error;
  }

  await options.onStatus?.(job.status, { job, warnings });

  if (job.status !== "complete" && job.status !== "failed" && job.status !== "cancelled" && job.status !== "not_configured") {
    job = await pollSimulationJob(job.jobId, {
      signal: options.signal,
      intervalMs: options.pollIntervalMs,
      onUpdate: async (next) => {
        await options.onStatus?.(next.status, { job: next, warnings });
      }
    });
  }

  if (job.status === "complete" && !job.result) {
    try {
      const resultResponse = await getSimulationResult(job.jobId, { signal: options.signal });
      job = {
        ...job,
        result: resultResponse.result,
        provenance: resultResponse.provenance ?? job.provenance,
        errors: resultResponse.errors?.length ? resultResponse.errors : job.errors
      };
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "result_not_ready") {
        // keep job as-is
      } else if (!(error instanceof DOMException && error.name === "AbortError")) {
        throw error;
      } else {
        throw error;
      }
    }
  }

  const response = jobRecordToSimulationResponse(job);
  if (warnings.length) {
    response.warnings = [
      ...(response.warnings ?? []),
      ...warnings.map((message) => ({ code: "serialize_warning", message }))
    ];
  }
  return response;
}
