/**
 * Remote FastAPI client for Twin simulation jobs.
 * Does not invent physics results; surfaces backend statuses honestly.
 */

import { getApiBaseUrl } from "./config.js";

export const POLL_INTERVAL_MS = 1500;

/** @type {ReadonlySet<import("../simulator/lib/types").JobStatus>} */
export const TERMINAL_JOB_STATUSES = new Set([
  "complete",
  "failed",
  "cancelled",
  "not_configured"
]);

export class ApiClientError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: import("../simulator/lib/types").SimulationError["code"], status?: number, details?: unknown }} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = "ApiClientError";
    this.code = meta.code ?? "backend_unreachable";
    this.status = meta.status;
    this.details = meta.details;
  }
}

/**
 * @param {unknown} data
 * @param {string} fallback
 */
function backendMessage(data, fallback) {
  const detail =
    data && typeof data === "object" && "detail" in data
      ? /** @type {{ detail?: unknown }} */ (data).detail
      : data;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return (
      detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "msg" in item) {
            const typed = /** @type {{ msg: unknown, loc?: unknown }} */ (item);
            const path = Array.isArray(typed.loc)
              ? typed.loc
                  .filter((part) => part !== "body")
                  .map(String)
                  .join(".")
              : "";
            return path ? `${path}: ${String(typed.msg)}` : String(typed.msg);
          }
          return "";
        })
        .filter(Boolean)
        .join("; ") || fallback
    );
  }
  if (detail && typeof detail === "object" && "message" in detail) {
    return String(/** @type {{ message: unknown }} */ (detail).message);
  }
  return fallback;
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(resolve, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal, baseUrl?: string }} [options]
 */
async function apiFetch(path, options = {}) {
  const baseUrl = (options.baseUrl ?? getApiBaseUrl()).replace(/\/$/, "");
  const url = `${baseUrl}${path}`;
  /** @type {RequestInit} */
  const init = {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Accept: "application/json"
    }
  };
  if (options.body !== undefined) {
    init.headers = {
      .../** @type {Record<string, string>} */ (init.headers),
      "Content-Type": "application/json"
    };
    init.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiClientError(
      `Backend unreachable at ${baseUrl}. Start the FastAPI server or update the API URL in Settings.`,
      { code: "backend_unreachable" }
    );
  }

  const text = await response.text();
  /** @type {unknown} */
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new ApiClientError("Job not found on the backend.", {
        code: "job_not_found",
        status: 404,
        details: data
      });
    }
    if (response.status === 409) {
      throw new ApiClientError("Result is not available yet.", {
        code: "result_not_ready",
        status: 409,
        details: data
      });
    }
    if (response.status === 422) {
      throw new ApiClientError(`Backend rejected the request: ${backendMessage(data, "validation failed")}`, {
        code: "validation_failed",
        status: 422,
        details: data
      });
    }
    const detail =
      data && typeof data === "object" && "detail" in data
        ? /** @type {{ detail?: unknown }} */ (data).detail
        : data;
    const message =
      typeof detail === "string"
        ? detail
        : detail && typeof detail === "object" && detail !== null && "message" in detail
          ? String(/** @type {{ message: unknown }} */ (detail).message)
          : `Backend request failed (${response.status}).`;
    throw new ApiClientError(message, {
      code: "demo_job_failed",
      status: response.status,
      details: data
    });
  }

  return data;
}

/**
 * @param {import("../simulator/lib/types").BackendSimulationRequest} request
 * @param {{ signal?: AbortSignal, baseUrl?: string }} [options]
 * @returns {Promise<import("../simulator/lib/types").JobRecord>}
 */
export async function submitSimulationJob(request, options = {}) {
  // Never change the requested physical model after a validation/API failure.
  // A 422 must be shown to the user, not retried as a different experiment.
  return postSimulationJob(request, options);
}

/**
 * @param {import("../simulator/lib/types").BackendSimulationRequest} request
 * @param {{ signal?: AbortSignal, baseUrl?: string }} [options]
 */
async function postSimulationJob(request, options = {}) {
  const data = /** @type {{ job: import("../simulator/lib/types").JobRecord }} */ (
    await apiFetch("/api/simulations", {
      method: "POST",
      body: request,
      signal: options.signal,
      baseUrl: options.baseUrl
    })
  );
  if (!data?.job?.jobId) {
    throw new ApiClientError("Backend did not return a job record.", { code: "demo_job_failed" });
  }
  return data.job;
}

/**
 * @param {string} jobId
 * @param {{ signal?: AbortSignal, baseUrl?: string }} [options]
 * @returns {Promise<import("../simulator/lib/types").JobRecord>}
 */
export async function getSimulationJob(jobId, options = {}) {
  const data = await apiFetch(`/api/simulations/${encodeURIComponent(jobId)}`, options);
  if (data && typeof data === "object" && "job" in data) {
    const wrapped = /** @type {{ job?: import("../simulator/lib/types").JobRecord }} */ (data).job;
    if (wrapped && typeof wrapped === "object") return wrapped;
  }
  return /** @type {import("../simulator/lib/types").JobRecord} */ (data);
}

/**
 * @param {string} jobId
 * @param {{ signal?: AbortSignal, baseUrl?: string }} [options]
 * @returns {Promise<import("../simulator/lib/types").JobResultResponse>}
 */
export async function getSimulationResult(jobId, options = {}) {
  return /** @type {Promise<import("../simulator/lib/types").JobResultResponse>} */ (
    apiFetch(`/api/simulations/${encodeURIComponent(jobId)}/result`, options)
  );
}

/**
 * @param {string} jobId
 * @param {number} frameIndex
 * @param {{ signal?: AbortSignal, baseUrl?: string }} [options]
 * @returns {Promise<import("../simulator/lib/types").OvfFrameResponse>}
 */
export async function getOvfFrame(jobId, frameIndex, options = {}) {
  return /** @type {Promise<import("../simulator/lib/types").OvfFrameResponse>} */ (
    apiFetch(`/api/simulations/${encodeURIComponent(jobId)}/frames/${encodeURIComponent(String(frameIndex))}`, options)
  );
}

/**
 * @param {{ signal?: AbortSignal, baseUrl?: string }} [options]
 */
export async function getSolversStatus(options = {}) {
  const data = await apiFetch("/api/solvers", options);
  if (data && typeof data === "object") {
    return /** @type {Record<string, any>} */ (data);
  }
  return {};
}

/**
 * @param {string} jobId
 * @param {{ signal?: AbortSignal, baseUrl?: string }} [options]
 * @returns {Promise<import("../simulator/lib/types").JobRecord>}
 */
export async function cancelSimulation(jobId, options = {}) {
  return /** @type {Promise<import("../simulator/lib/types").JobRecord>} */ (
    apiFetch(`/api/simulations/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      signal: options.signal,
      baseUrl: options.baseUrl
    })
  );
}

/**
 * Poll until the job reaches a terminal status.
 *
 * @param {string} jobId
 * @param {{
 *   signal?: AbortSignal,
 *   baseUrl?: string,
 *   intervalMs?: number,
 *   timeoutMs?: number,
 *   onUpdate?: (job: import("../simulator/lib/types").JobRecord) => void | Promise<void>
 * }} [options]
 * @returns {Promise<import("../simulator/lib/types").JobRecord>}
 */
export async function pollSimulationJob(jobId, options = {}) {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const started = Date.now();
  /** @type {import("../simulator/lib/types").JobRecord | null} */
  let last = null;

  while (true) {
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (Date.now() - started > timeoutMs) {
      throw new ApiClientError("Timed out waiting for the backend job to finish.", {
        code: "timeout"
      });
    }
    last = await getSimulationJob(jobId, {
      signal: options.signal,
      baseUrl: options.baseUrl
    });
    await options.onUpdate?.(last);
    if (TERMINAL_JOB_STATUSES.has(last.status)) return last;
    if (last.status === "queued" && Date.now() - started > 12_000) {
      throw new ApiClientError(
        "The API accepted the job but the worker never started it. Run this repo's FastAPI with SPINVAULT_WORKER_ENABLED=true (in-process worker). A separate `python -m app.workers` process cannot drain uvicorn's queue.",
        { code: "timeout", status: 504, details: last }
      );
    }
    await sleep(intervalMs, options.signal);
  }
}

/**
 * @param {import("../simulator/lib/types").JobStatus | string} status
 */
export function isTerminalJobStatus(status) {
  return TERMINAL_JOB_STATUSES.has(/** @type {import("../simulator/lib/types").JobStatus} */ (status));
}
