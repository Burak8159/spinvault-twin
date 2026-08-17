import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { submitDemoSimulation } from "../../api/demoClient.js";
import { createDefaultState } from "../lib/defaults.js";
import { validateScenario } from "../lib/validation.js";

const FAST = { validating: 0, queued: 0, running: 0 };

describe("submitDemoSimulation", () => {
  it("returns a complete demo response with provenance", async () => {
    const scenario = createDefaultState();
    scenario.validation = validateScenario(scenario);
    /** @type {string[]} */
    const statuses = [];
    const response = await submitDemoSimulation(
      { scenario, requestedSolver: "demo" },
      {
        delays: FAST,
        onStatus: (status) => {
          statuses.push(status);
        }
      }
    );

    assert.equal(response.status, "complete");
    assert.ok(response.jobId);
    assert.ok(response.result);
    assert.equal(response.result?.source, "demo_fixture");
    assert.equal(response.result?.isPhysicalSimulation, false);
    assert.equal(response.provenance.solver, "demo");
    assert.deepEqual(statuses, ["validating", "queued", "running"]);
  });

  it("fails closed when a non-demo solver is requested", async () => {
    const scenario = createDefaultState();
    scenario.validation = validateScenario(scenario);
    const response = await submitDemoSimulation(
      { scenario, requestedSolver: "mumax3" },
      { delays: FAST }
    );
    assert.equal(response.status, "failed");
    assert.equal(response.error?.code, "solver_not_connected");
    assert.ok(response.provenance.notes?.length);
  });

  it("fails on blocking validation before assembling a fixture", async () => {
    const scenario = createDefaultState();
    scenario.title = "";
    scenario.validation = validateScenario(scenario);
    const response = await submitDemoSimulation(
      { scenario, requestedSolver: "demo" },
      { delays: FAST }
    );
    assert.equal(response.status, "failed");
    assert.equal(response.error?.code, "validation_failed");
    assert.equal(response.result, undefined);
  });
});
