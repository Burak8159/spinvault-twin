import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  ApiClientError,
  isTerminalJobStatus,
  pollSimulationJob,
  submitSimulationJob
} from "../../api/remoteClient.js";

describe("remote API client", () => {
  it("maps network failures to backend_unreachable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    try {
      await assert.rejects(
        () =>
          submitSimulationJob(
            /** @type {any} */ ({
              scenarioId: "x",
              title: "x",
              requestedSolver: "demo"
            }),
            { baseUrl: "http://127.0.0.1:9" }
          ),
        (error) => error instanceof ApiClientError && error.code === "backend_unreachable"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stops polling on terminal statuses", async () => {
    const statuses = ["queued", "running", "not_configured"];
    let index = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => {
      const status = statuses[index];
      index += 1;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            jobId: "job_test",
            scenarioId: "s",
            title: "t",
            requestedSolver: "mumax3",
            status,
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
            errors: [{ code: "solver_not_configured", message: "not configured" }],
            warnings: [],
            provenance: {
              createdAt: "2026-08-14T00:00:00.000Z",
              createdBy: "system",
              solver: "mumax3",
              notes: ["MuMax3 adapter present but not configured."]
            },
            result: null
          });
        }
      };
    });

    try {
      /** @type {string[]} */
      const seen = [];
      const job = await pollSimulationJob("job_test", {
        intervalMs: 1,
        onUpdate: (next) => {
          seen.push(next.status);
        }
      });
      assert.equal(job.status, "not_configured");
      assert.deepEqual(seen, ["queued", "running", "not_configured"]);
      assert.equal(isTerminalJobStatus("not_configured"), true);
      assert.equal(isTerminalJobStatus("running"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("includes exact rejected field paths from FastAPI 422 details", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 422,
      async text() {
        return JSON.stringify({
          detail: [
            {
              type: "missing",
              loc: ["body", "solverDrafts", "mumax3", "anisotropyConstant"],
              msg: "Field required",
              input: null
            }
          ]
        });
      }
    }));
    try {
      await assert.rejects(
        () =>
          submitSimulationJob(
            /** @type {any} */ ({
              scenarioId: "x",
              title: "x",
              requestedSolver: "mumax3"
            }),
            { baseUrl: "http://127.0.0.1:9" }
          ),
        (error) =>
          error instanceof ApiClientError &&
          error.status === 422 &&
          /solverDrafts\.mumax3\.anisotropyConstant: Field required/.test(error.message)
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not change the requested physics model after a 422 response", async () => {
    const originalFetch = globalThis.fetch;
    /** @type {unknown[]} */
    const bodies = [];
    globalThis.fetch = mock.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return {
        ok: false,
        status: 422,
        async text() {
          return JSON.stringify({
            detail: [
              {
                type: "literal_error",
                loc: ["body", "solverDrafts", "mumax3", "modelKind"],
                msg: "Unsupported model kind"
              }
            ]
          });
        }
      };
    });
    try {
      await assert.rejects(
        () =>
          submitSimulationJob(
            /** @type {any} */ ({
              scenarioId: "x",
              title: "x",
              requestedSolver: "mumax3",
              solverDrafts: {
                mumax3: {
                  modelKind: "spinvault_mtj_free_layer_switching_v1",
                  statePreset: "transition_0_to_1",
                  anisotropyConstant: { value: 800000, unit: "J/m^3" },
                  fieldPulseAmplitude: { value: 0.6, unit: "T" }
                }
              }
            }),
            { baseUrl: "http://127.0.0.1:9" }
          ),
        (error) =>
          error instanceof ApiClientError &&
          error.status === 422 &&
          /solverDrafts\.mumax3\.modelKind/.test(error.message)
      );
      assert.equal(bodies.length, 1);
      assert.equal(
        bodies[0].solverDrafts.mumax3.modelKind,
        "spinvault_mtj_free_layer_switching_v1"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
