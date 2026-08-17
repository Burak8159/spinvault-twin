import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultState } from "../lib/defaults.js";
import { createMockResult } from "../lib/mockResults.js";
import { resultsPanelMessage } from "../lib/statusCopy.js";

describe("result provenance", () => {
  it("labels mock results as demo fixtures", () => {
    const result = createMockResult(createDefaultState());
    assert.equal(result.source, "demo_fixture");
    assert.equal(result.isPhysicalSimulation, false);
    assert.equal(result.provenance.createdBy, "demo_fixture");
    assert.equal(result.provenance.solver, "demo");
    assert.ok(result.provenance.notes?.includes("Demo output"));
    assert.ok(result.provenance.notes?.some((note) => /Kwant integration pending/i.test(note)));
    assert.ok(result.provenance.notes?.some((note) => /Surrogate model not connected/i.test(note)));
  });

  it("keeps empty, cancelled, and busy result panel copy honest", () => {
    const base = {
      state: createDefaultState(),
      result: null,
      error: null,
      logs: [],
      timeline: [],
      jobId: null,
      paused: false
    };

    assert.equal(resultsPanelMessage({ ...base, status: "idle" })?.kind, "empty");
    assert.equal(resultsPanelMessage({ ...base, status: "running" })?.kind, "busy");
    assert.equal(resultsPanelMessage({ ...base, status: "cancelled" })?.kind, "warning");
    assert.match(
      resultsPanelMessage({ ...base, status: "running" })?.body ?? "",
      /Python mesh LLGS|Python LLG|No physics solver|Physical/i
    );
    assert.match(resultsPanelMessage({ ...base, status: "idle" })?.body ?? "", /Python mesh|Python LLG/i);
  });
});
