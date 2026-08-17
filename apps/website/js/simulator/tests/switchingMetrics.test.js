import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifySwitching, representativeFrameIndices } from "../lib/switchingMetrics.js";

/**
 * @param {number[]} mz
 */
function trajectory(mz) {
  return mz.map((value, index) => ({ t: index * 1e-9, mx: 0, my: 0, mz: value }));
}

describe("switching metrics", () => {
  it("classifies P/AP relative to the pinned +z reference and keeps intermediate unresolved", () => {
    assert.equal(classifySwitching(trajectory([0.95])).finalState, "P");
    assert.equal(classifySwitching(trajectory([-0.95])).finalState, "AP");
    assert.equal(classifySwitching(trajectory([0.2])).finalState, "intermediate");
  });

  it("detects onset, mz zero crossing, and completion on a known AP→P trajectory", () => {
    const result = classifySwitching(trajectory([-0.95, -0.6, 0.05, 0.82, 0.96]), {
      statePreset: "transition_0_to_1",
      threshold: 0.8,
      pinnedDirection: { x: 0, y: 0, z: 1 }
    });
    assert.equal(result.switchingOccurred, "yes");
    assert.ok(Math.abs((result.onsetTime ?? NaN) - 1e-9) < 1e-12);
    assert.ok(Math.abs((result.zeroCrossingTime ?? NaN) - 2e-9) < 1e-12);
    assert.ok(Math.abs((result.completionTime ?? NaN) - 3e-9) < 1e-12);
    assert.ok(result.settlingDelta != null);
  });

  it("maps events onto attached frames and falls back to even spacing when events are missing", () => {
    const frames = Array.from({ length: 11 }, (_, index) => ({
      index,
      metadata: { time: index * 2e-10 }
    }));
    const classified = classifySwitching(trajectory([-0.95, 0.1, 0.92]), {
      statePreset: "transition_0_to_1"
    });
    const events = representativeFrameIndices(11, classified, frames);
    assert.ok(events.length >= 3);
    assert.equal(events[0].role, "initial");
    assert.equal(events.at(-1)?.arrayIndex, 10);

    const even = representativeFrameIndices(11, classifySwitching([]), frames);
    assert.equal(even.length, 6);
    assert.ok(even.every((item) => item.source === "even_spacing" || item.role === "only"));
  });
});
