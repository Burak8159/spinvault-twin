import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  claimMumax3FrameViewport,
  formatCompactFrameTime,
  formatPlaybackTimeLabel,
  MuMax3FrameAnimator,
  MuMax3FrameCache,
  shouldUseMumax3FrameAnimator,
  ovfFramesFromResult
} from "../components/mumax3FrameAnimator.js";
import {
  calculateOvfFrameDiagnostics,
  formatOvfFrameTime
} from "../lib/frameView.js";

function resultWithFrames(source = "mumax3", frames = [{ index: 0 }]) {
  return {
    source,
    isPhysicalSimulation: source === "mumax3",
    executionGpu: {
      gpuAvailable: true,
      acceleration: "rtx",
      details: "Confirmed by MuMax3 CUDA execution log."
    },
    artifacts: { frames }
  };
}

class FakeSvgNode {
  constructor(name) {
    this.name = name;
    this.attributes = new Map();
    this.children = [];
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  querySelector(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    for (const child of this.children) {
      if (
        className &&
        child.attributes
          ?.get("class")
          ?.split(/\s+/)
          .includes(className)
      ) {
        return child;
      }
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
}

describe("MuMax3FrameAnimator viewport ownership", () => {
  it("takes the center viewport when a MuMax3 result has attached OVF frames", () => {
    assert.equal(shouldUseMumax3FrameAnimator(resultWithFrames()), true);
  });

  it("replaces an existing schematic with the first explicit OVF loading state", () => {
    const previousDocument = globalThis.document;
    globalThis.document = {
      createElementNS(_namespace, name) {
        return new FakeSvgNode(name);
      }
    };
    try {
      const viewport = new FakeSvgNode("svg");
      const stack = new FakeSvgNode("g");
      stack.setAttribute("class", "sv-stack");
      viewport.append(stack);

      const result = resultWithFrames("mumax3", [
        { index: 7, label: "m000007.ovf", path: "outputs/m000007.ovf" }
      ]);
      assert.equal(shouldUseMumax3FrameAnimator(result), true);
      claimMumax3FrameViewport(viewport, result.artifacts.frames[0]);

      assert.equal(viewport.querySelector(".sv-stack"), null);
      assert.ok(viewport.querySelector(".sv-ovf-loading"));
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it("leaves the schematic fallback for non-MuMax3 results or missing frames", () => {
    assert.equal(shouldUseMumax3FrameAnimator(resultWithFrames("demo_fixture")), false);
    assert.equal(shouldUseMumax3FrameAnimator(resultWithFrames("mumax3", [])), false);
    assert.equal(
      shouldUseMumax3FrameAnimator({
        ...resultWithFrames(),
        executionGpu: { gpuAvailable: true, acceleration: "host_gpu_available", details: "RTX host only" }
      }),
      true
    );
    assert.equal(shouldUseMumax3FrameAnimator(null), false);
  });

  it("animates when the host reports ovf-frame-count without embedding the frames array", () => {
    const result = {
      source: "mumax3",
      isPhysicalSimulation: Boolean(1),
      artifacts: { scriptPreview: "// mx3" },
      metrics: [{ id: "ovf-frame-count", displayValue: "53" }]
    };
    assert.equal(shouldUseMumax3FrameAnimator(result), true);
    const frames = ovfFramesFromResult(result);
    assert.equal(frames.length, 53);
    assert.equal(frames[0].path, "outputs/m000000.ovf");
    assert.equal(frames[12].index, 12);
  });

  it("formats the center playback indicator from raw frame time", () => {
    assert.equal(
      formatCompactFrameTime({
        index: 12,
        metadata: { time: 230e-12 }
      }),
      "t≈230.0 ps"
    );
  });

  it("maps table.txt time onto the header when OVF metadata has no time", () => {
    const magnetization = {
      mz: {
        points: [
          { x: 0, y: 1 },
          { x: 410e-12, y: 0.4 },
          { x: 820e-12, y: -0.2 }
        ]
      }
    };
    const label = formatPlaybackTimeLabel({ index: 21, metadata: {} }, 21, 53, magnetization);
    assert.match(label, /t≈/);
    assert.doesNotMatch(label, /unavailable/i);
    assert.equal(
      formatPlaybackTimeLabel({ index: 0, metadata: { time: 12e-12 } }, 0, 53, magnetization),
      "t≈12.0 ps"
    );
  });
});

describe("MuMax3FrameCache", () => {
  it("deduplicates frame loads and preserves raw vectors unchanged", async () => {
    let calls = 0;
    const rawVector = { x: 2, y: 1, z: 0, mx: 0.25, my: -0.5, mz: 0.75, magnitude: 0.935 };
    const cache = new MuMax3FrameCache(async (jobId, frameIndex) => {
      calls += 1;
      assert.equal(jobId, "job-raw");
      assert.equal(frameIndex, 3);
      return {
        jobId,
        note: "raw",
        frame: {
          path: "outputs/m000003.ovf",
          label: "m000003.ovf",
          index: frameIndex,
          bytes: 128,
          format: "ovf",
          metadata: {},
          warnings: [],
          vectors: [rawVector]
        }
      };
    });

    const [first, second] = await Promise.all([
      cache.load("job-raw", 3),
      cache.load("job-raw", 3)
    ]);

    assert.equal(calls, 1);
    assert.equal(first, second);
    assert.equal(first.vectors[0], rawVector);
  });

  it("does not cache a failed parse/fetch response", async () => {
    let calls = 0;
    const cache = new MuMax3FrameCache(async () => {
      calls += 1;
      throw new Error("invalid OVF");
    });

    await assert.rejects(cache.load("job-bad", 0), /invalid OVF/);
    await assert.rejects(cache.load("job-bad", 0), /invalid OVF/);
    assert.equal(calls, 2);
  });
});

describe("raw OVF playback diagnostics", () => {
  /**
   * @param {string} path
   * @param {import("../lib/types").OvfFrameVector[]} vectors
   * @param {number} time
   * @returns {import("../lib/types").OvfFrameData}
   */
  const frame = (path, vectors, time) => ({
    path,
    label: path,
    index: Number(path.match(/\d+/)?.[0] ?? 0),
    bytes: 128,
    format: "ovf",
    metadata: { xnodes: vectors.length, ynodes: 1, znodes: 1, time },
    warnings: [],
    vectors
  });

  it("reports raw means and maximum frame-to-frame vector delta", () => {
    const first = frame(
      "m000000.ovf",
      [
        { index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: 1, magnitude: 1 },
        { index: 1, x: 1, y: 0, z: 0, mx: 0, my: 1, mz: 0, magnitude: 1 }
      ],
      0
    );
    const second = frame(
      "m000001.ovf",
      [
        { index: 0, x: 0, y: 0, z: 0, mx: 1, my: 0, mz: 0, magnitude: 1 },
        { index: 1, x: 1, y: 0, z: 0, mx: 0, my: 1, mz: 0, magnitude: 1 }
      ],
      2e-11
    );
    const diagnostics = calculateOvfFrameDiagnostics(second, first);
    assert.equal(diagnostics.vectorCount, 2);
    assert.equal(diagnostics.meanMx, 0.5);
    assert.equal(diagnostics.meanMy, 0.5);
    assert.equal(diagnostics.meanMz, 0);
    assert.equal(diagnostics.maxFrameDelta, Math.sqrt(2));
    assert.equal(diagnostics.staticAtPrecision, false);
    assert.equal(formatOvfFrameTime(second), "2.0000e-11 s");
  });

  it("explicitly reports a static raw frame comparison", () => {
    const first = frame(
      "m000000.ovf",
      [{ index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: 1, magnitude: 1 }],
      0
    );
    const second = frame("m000001.ovf", structuredClone(first.vectors), 1e-11);
    assert.equal(calculateOvfFrameDiagnostics(second, first).staticAtPrecision, true);
  });
});

describe("MuMax3FrameAnimator scrubber", () => {
  class FakeEl {
    constructor(name) {
      this.name = name;
      this.attributes = new Map();
      this.children = [];
      this.textContent = "";
      this.hidden = false;
      this.disabled = false;
      this.value = "";
      this.type = "";
      this.min = "";
      this.max = "";
      this.step = "";
      this.title = "";
      this.dataset = {};
      this.classList = { add() {}, remove() {} };
    }
    set className(value) {
      this.attributes.set("class", String(value));
    }
    get className() {
      return this.attributes.get("class") ?? "";
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children = children;
    }
    addEventListener() {}
    querySelector(selector) {
      const attr = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
      const walk = (node) => {
        if (attr && node.attributes?.get(attr[1]) === attr[2]) return node;
        if (selector.startsWith(".") && node.className.split(/\s+/).includes(selector.slice(1))) {
          return node;
        }
        for (const child of node.children ?? []) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    }
  }

  it("advances the frame scrubber and indicator when seek() is called", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = {
      createElement(name) {
        return new FakeEl(name);
      },
      createElementNS(_ns, name) {
        return new FakeEl(name);
      }
    };
    try {
      const frames = [
        { index: 0, label: "m000000.ovf", path: "outputs/m000000.ovf" },
        { index: 1, label: "m000001.ovf", path: "outputs/m000001.ovf" },
        { index: 2, label: "m000002.ovf", path: "outputs/m000002.ovf" }
      ];
      const animator = new MuMax3FrameAnimator({
        viewport: new FakeEl("svg"),
        controlsRoot: new FakeEl("div"),
        jobId: "job-scrub",
        frames,
        reducedMotion: true,
        isViewportActive: () => true,
        fetchFrame: async (_jobId, index) => ({
          jobId: "job-scrub",
          note: "raw",
          frame: {
            path: frames[index].path,
            label: frames[index].label,
            index,
            bytes: 64,
            format: "ovf",
            metadata: { xnodes: 1, ynodes: 1, znodes: 1, time: index * 1e-11 },
            warnings: [],
            vectors: [{ index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: index === 0 ? -1 : 1, magnitude: 1 }]
          }
        })
      });
      animator.mount();
      await animator.seek(0);
      await animator.seek(2);
      assert.equal(animator.selectedFrameIndex, 2);
      assert.equal(animator.slider?.value, "2");
      assert.match(animator.indicator?.textContent ?? "", /3 \/ 3/);
    } finally {
      globalThis.document = previousDocument;
    }
  });
});
