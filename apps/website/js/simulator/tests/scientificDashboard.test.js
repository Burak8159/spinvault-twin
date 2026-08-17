import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildScientificBoardModel } from "../lib/scientificBoardModel.js";
import { classifyDeviceObservables } from "../lib/deviceObservables.js";
import { shouldUseMeshFrameAnimator } from "../components/mumax3FrameAnimator.js";
import { renderMrPanel } from "../components/scientificBoard.js";
import { buildFramePlaybackView } from "../lib/frameView.js";

class FakeHost {
  constructor() {
    this._html = "";
    this.attributes = new Map();
    this.children = [];
  }
  set className(value) {
    this.attributes.set("class", String(value));
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  get innerHTML() {
    return this._html;
  }
  set innerHTML(html) {
    this._html = String(html);
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  addEventListener() {}
}

function meshResult() {
  return {
    source: "python_micromagnetic",
    isPhysicalSimulation: Boolean(1),
    summary: "mesh",
    series: [
      {
        id: "mz",
        label: "mz",
        xLabel: "time",
        xUnit: "s",
        yLabel: "mz",
        yUnit: "dimensionless",
        points: [
          { x: 0, y: -1 },
          { x: 1e-9, y: 1 }
        ]
      }
    ],
    metrics: [],
    provenance: { createdAt: "", createdBy: "system", solver: "python_micromagnetic", notes: [] },
    artifacts: {
      frames: [
        {
          id: "frame-0",
          path: "magnetization.npz",
          label: "m[0]",
          index: 0,
          bytes: 10,
          format: "spinvault-magnetization-npz-v1"
        },
        {
          id: "frame-1",
          path: "magnetization.npz",
          label: "m[1]",
          index: 1,
          bytes: 10,
          format: "spinvault-magnetization-npz-v1"
        }
      ]
    }
  };
}

function macrospinResult() {
  return {
    source: "python_llg_twin",
    isPhysicalSimulation: Boolean(1),
    summary: "macrospin",
    series: meshResult().series,
    metrics: [],
    provenance: { createdAt: "", createdBy: "system", solver: "python_llg", notes: [] },
    artifacts: { frames: [] }
  };
}

describe("python micromagnetic dashboard honesty", () => {
  it("requires real mesh frames before spatial panels can animate", () => {
    assert.equal(shouldUseMeshFrameAnimator(meshResult()), true);
    assert.equal(shouldUseMeshFrameAnimator(macrospinResult()), false);
    assert.equal(shouldUseMeshFrameAnimator({ ...meshResult(), artifacts: { frames: [] } }), false);
  });

  it("shares one frame catalog for snapshots and cross-sections", () => {
    const model = buildScientificBoardModel({
      result: meshResult(),
      magnetization: { mz: meshResult().series[0] }
    });
    assert.equal(model.hasOvfFrames, true);
    assert.equal(model.snapshots.length, 2);
    assert.equal(model.snapshots[0].arrayIndex, 0);
    assert.equal(model.snapshots.at(-1)?.arrayIndex, 1);
    assert.match(model.honesty, /SIMULATED mesh maps/);
    assert.match(model.title, /Python mesh LLGS/);
  });

  it("keeps macrospin uniform and never invents a mesh", () => {
    const model = buildScientificBoardModel({
      result: macrospinResult(),
      magnetization: { mz: macrospinResult().series[0] }
    });
    assert.equal(model.hasOvfFrames, false);
    assert.equal(model.snapshots.length, 0);
    const field = classifyDeviceObservables(macrospinResult()).find((row) => row.id === "m-field");
    assert.equal(field?.klass, "UNAVAILABLE");
  });

  it("badges mesh maps SIMULATED and resistance ANALYTICAL MODEL", () => {
    const observables = classifyDeviceObservables(meshResult());
    assert.equal(observables.find((row) => row.id === "m-field")?.klass, "SIMULATED");
    assert.equal(observables.find((row) => row.id === "mean-m")?.klass, "SIMULATED");
    assert.equal(observables.find((row) => row.id === "resistance")?.klass, "MODEL");
  });

  it("never invents OVF paths for a Python mesh result without frames", () => {
    assert.equal(
      shouldUseMeshFrameAnimator({
        ...meshResult(),
        artifacts: { frames: [] },
        metrics: [{ id: "ovf-frame-count", displayValue: "51" }]
      }),
      false
    );
  });

  it("labels Python mesh frames without calling them OVF or MuMax3", () => {
    const view = buildFramePlaybackView(meshResult());
    assert.equal(view.available, true);
    assert.match(view.message, /Python mesh/);
    assert.match(view.message, /Not OVF/);
    assert.match(view.message, /Not MuMax3/);
  });

  it("badges the dashboard MR panel as an analytical model", async () => {
    const previous = globalThis.document;
    globalThis.document = {
      createElementNS(_ns, name) {
        const node = new FakeHost();
        node.name = name;
        return node;
      }
    };
    try {
      const host = new FakeHost();
      const model = buildScientificBoardModel({
        result: meshResult(),
        magnetization: { mz: meshResult().series[0] }
      });
      renderMrPanel(/** @type {any} */ (host), model);
      assert.match(host.innerHTML, /ANALYTICAL MODEL/);
      assert.match(host.innerHTML, /data-board-mr-plot="true"/);
      assert.match(host.innerHTML, /data-series="mr"/);
    } finally {
      globalThis.document = previous;
    }
  });
});
