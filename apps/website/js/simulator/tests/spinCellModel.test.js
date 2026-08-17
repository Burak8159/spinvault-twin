import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  advanceSpinTransition,
  buildSpinCellField,
  createSeededRng,
  spinTargetsForBit
} from "../lib/spinCellModel.js";

describe("spinCellModel", () => {
  it("defines distinct alignment states for bit 0 and bit 1", () => {
    const zero = spinTargetsForBit(0);
    const one = spinTargetsForBit(1);
    assert.equal(zero.alignment, "AP");
    assert.equal(one.alignment, "P");
    assert.equal(zero.free.z, -1);
    assert.equal(one.free.z, 1);
    assert.equal(zero.reference.z, 1);
    assert.equal(one.reference.z, 1);
  });

  it("builds different free-layer fields for state 0 and state 1", () => {
    const state0 = buildSpinCellField({ bit: 0, seed: 7, disorder: 0.05 });
    const state1 = buildSpinCellField({ bit: 1, seed: 7, disorder: 0.05 });
    assert.ok(state0.spins.length > 20);
    assert.ok(state1.spins.length > 20);
    assert.ok(state0.meanFreeMagnetization.z < 0);
    assert.ok(state1.meanFreeMagnetization.z > 0);
    assert.match(state0.honesty, /Not experimentally validated/i);
    assert.doesNotMatch(state0.honesty, /calibrated digital twin/i);
  });

  it("ends transition 0→1 near state 1", () => {
    const field = buildSpinCellField({
      bit: 0,
      fromBit: 0,
      toBit: 1,
      progress: 1,
      seed: 3,
      disorder: 0.02,
      damping: 0.02,
      torqueStrength: 1
    });
    assert.ok(field.meanFreeMagnetization.z > 0.7);
    assert.ok(field.metrics.switchingProgress >= 0.99);
    assert.equal(field.metrics.alignment, "P");
  });

  it("ends transition 1→0 near state 0", () => {
    const field = buildSpinCellField({
      bit: 1,
      fromBit: 1,
      toBit: 0,
      progress: 1,
      seed: 3,
      disorder: 0.02,
      damping: 0.02,
      torqueStrength: 1
    });
    assert.ok(field.meanFreeMagnetization.z < -0.7);
    assert.ok(field.metrics.switchingProgress >= 0.99);
    assert.equal(field.metrics.alignment, "AP");
  });

  it("rotates only the free layer through a transverse midpoint", () => {
    const field = buildSpinCellField({
      bit: 0,
      fromBit: 0,
      toBit: 1,
      progress: 0.5,
      seed: 5,
      disorder: 0
    });
    const free = field.spins.filter((spin) => spin.layer === "free");
    const reference = field.spins.filter((spin) => spin.layer === "reference");
    assert.ok(free.every((spin) => spin.mx > 0.7));
    assert.ok(reference.every((spin) => spin.mz > 0.99));
  });

  it("keeps seeded spin noise deterministic", () => {
    const a = buildSpinCellField({ bit: 0, seed: 99, disorder: 0.3 });
    const b = buildSpinCellField({ bit: 0, seed: 99, disorder: 0.3 });
    assert.deepEqual(
      a.spins.map((spin) => [spin.mx, spin.my, spin.mz]),
      b.spins.map((spin) => [spin.mx, spin.my, spin.mz])
    );
    const rngA = createSeededRng(123);
    const rngB = createSeededRng(123);
    assert.equal(rngA(), rngB());
    assert.equal(rngA(), rngB());
  });

  it("advances transition progress with damping and torque", () => {
    const slow = advanceSpinTransition({
      progress: 0,
      dt: 0.05,
      speed: 1,
      damping: 0.4,
      torqueStrength: 0.1
    });
    const fast = advanceSpinTransition({
      progress: 0,
      dt: 0.05,
      speed: 1,
      damping: 0.01,
      torqueStrength: 1.5
    });
    assert.ok(fast > slow);
    assert.ok(fast > 0);
    assert.ok(fast <= 1);
  });
});
