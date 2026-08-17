import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMagnetizationPlayback,
  sampleMagnetizationAtProgress,
  shouldDisablePlaybackAutoplay
} from "../lib/playback.js";

/**
 * @param {"mx" | "my" | "mz"} id
 * @param {number[]} values
 * @returns {import("../lib/types").ResultSeries}
 */
function rawSeries(id, values) {
  return {
    id,
    label: `${id} (raw table)`,
    xLabel: "time",
    xUnit: "s",
    yLabel: `${id} (raw table)`,
    yUnit: "dimensionless",
    points: values.map((y, index) => ({ x: index * 1e-12, y }))
  };
}

describe("raw MuMax3 playback", () => {
  it("uses parsed mx/my/mz samples without generating values", () => {
    const playback = buildMagnetizationPlayback({
      mx: rawSeries("mx", [0.1, 0.2]),
      my: rawSeries("my", [0, 0.05]),
      mz: rawSeries("mz", [0.995, 0.97])
    });
    assert.equal(playback.samples.length, 2);
    assert.deepEqual(playback.samples[1], {
      time: 1e-12,
      mx: 0.2,
      my: 0.05,
      mz: 0.97
    });
    const mid = sampleMagnetizationAtProgress(playback.samples, 0.5);
    assert.ok(mid);
    assert.equal(mid.time, 0.5e-12);
    assert.ok(Math.abs(mid.mx - 0.15) < 1e-12);
    assert.equal(playback.flat, false);
    assert.match(playback.message, /raw MuMax3/i);
    assert.match(playback.message, /Not calibrated/i);
    assert.doesNotMatch(playback.message, /TMR|switching probability|endurance|retention/i);
  });

  it("reports an honest flat completed trajectory", () => {
    const playback = buildMagnetizationPlayback({
      mx: rawSeries("mx", [0, 0]),
      my: rawSeries("my", [0, 0]),
      mz: rawSeries("mz", [1, 1])
    });
    assert.equal(playback.flat, true);
    assert.match(playback.message, /flat/i);
  });

  it("does not create playback when a raw component is missing", () => {
    const playback = buildMagnetizationPlayback({
      mx: rawSeries("mx", [0.1]),
      mz: rawSeries("mz", [0.995])
    });
    assert.equal(playback.samples.length, 0);
    assert.match(playback.message, /No complete/i);
  });

  it("disables autoplay when reduced motion is preferred", () => {
    assert.equal(shouldDisablePlaybackAutoplay({ matches: true }), true);
    assert.equal(shouldDisablePlaybackAutoplay({ matches: false }), false);
    assert.equal(shouldDisablePlaybackAutoplay(null), false);
  });
});
