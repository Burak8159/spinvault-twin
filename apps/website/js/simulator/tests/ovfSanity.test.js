import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertOvfIndexOrder,
  compareTableAndOvfAverages,
  summarizeOvfVectors
} from "../lib/ovfSanity.js";

describe("OVF display sanity", () => {
  it("computes active-cell averages and |m|≈1", () => {
    const summary = summarizeOvfVectors([
      { index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: 1, magnitude: 1 },
      { index: 1, x: 1, y: 0, z: 0, mx: 0, my: 0, mz: 0, magnitude: 0 }
    ]);
    assert.equal(summary.activeCellCount, 1);
    assert.equal(summary.meanMz, 1);
    assert.equal(summary.normOk, true);
  });

  it("flags a table vs OVF average mismatch", () => {
    const comparison = compareTableAndOvfAverages({ mx: 0, my: 0, mz: 1 }, { meanMx: 0, meanMy: 0, meanMz: 0.7 });
    assert.equal(comparison.ok, false);
    assert.deepEqual(comparison.mismatched, ["mz"]);
  });

  it("accepts x-fastest OVF indexing", () => {
    const vectors = [
      { index: 0, x: 0, y: 0, z: 0, mx: 1, my: 0, mz: 0, magnitude: 1 },
      { index: 1, x: 1, y: 0, z: 0, mx: 1, my: 0, mz: 0, magnitude: 1 },
      { index: 2, x: 0, y: 1, z: 0, mx: 1, my: 0, mz: 0, magnitude: 1 }
    ];
    assert.equal(assertOvfIndexOrder(vectors, { xnodes: 2, ynodes: 2 }), true);
  });
});
