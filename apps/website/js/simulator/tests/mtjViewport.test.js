import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateGlyphSizing,
  createScientificSpinLayout,
  layerSlot,
  projectMagnetizationArrow
} from "../components/mtjViewportLayout.js";
import { probabilityPeakPoint, renderSpinView, updateSpinView } from "../components/spinView.js";
import { downsampleOvfVectors, pickOvfDisplayLattice, renderOvfFrameViewport } from "../components/viewport.js";
import {
  SPIN_TRAJECTORY_DISPLAY_SECONDS,
  SPIN_TRAJECTORY_MAX_DISPLAY_SECONDS,
  TwinViewportController,
  magnetizationPathDegrees,
  mumaxPatchFromSpinControls,
  spinDisplaySecondsForSamples,
  twinControlsFromStatePreset
} from "../components/twinViewport.js";
import { renderWaveView } from "../components/waveView.js";
import { createDefaultState } from "../lib/defaults.js";
import { buildSpinCellField } from "../lib/spinCellModel.js";
import { evaluateTunnelingModel } from "../lib/tunnelingModel.js";

class FakeNode {
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

  get innerHTML() {
    return this._html ?? "";
  }

  set innerHTML(html) {
    this._html = String(html);
  }

  all() {
    return [this, ...this.children.flatMap((child) => child.all?.() ?? [])];
  }

  querySelector(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    return this.all().find((node) =>
      className
        ? node.attributes.get("class")?.split(/\s+/).includes(className)
        : false
    ) ?? null;
  }
}

function withFakeSvg(run) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS(_namespace, name) {
      return new FakeNode(name);
    }
  };
  try {
    run(new FakeNode("svg"));
  } finally {
    globalThis.document = previousDocument;
  }
}

function textContent(svg) {
  return svg.all().map((node) => node.textContent).filter(Boolean).join(" ");
}

function nodesWithAttribute(svg, name, value) {
  return svg.all().filter((node) => node.attributes.get(name) === value);
}

function arrowShaft(svg) {
  const shaft = nodesWithAttribute(svg, "data-magnetization-arrow", "true")[0];
  assert.ok(shaft, "expected an in-plane magnetization arrow shaft");
  return shaft;
}

describe("partitioned MTJ viewport", () => {
  it("maps every Spin state toggle to the MuMax3 switching model", () => {
    assert.deepEqual(mumaxPatchFromSpinControls({ bit: 0, transition: "none" }), {
      modelKind: "spinvault_mtj_free_layer_switching_v1",
      statePreset: "state_0_ap"
    });
    assert.equal(
      mumaxPatchFromSpinControls({ bit: 1, transition: "none" }).statePreset,
      "state_1_p"
    );
    assert.equal(
      mumaxPatchFromSpinControls({ bit: 0, transition: "0_to_1" }).statePreset,
      "transition_0_to_1"
    );
    assert.equal(
      mumaxPatchFromSpinControls({ bit: 1, transition: "1_to_0" }).statePreset,
      "transition_1_to_0"
    );
    assert.deepEqual(twinControlsFromStatePreset("transition_1_to_0"), {
      bit: 1,
      transition: "1_to_0"
    });
  });
  it("switches one shared SVG from Spin to Wave without sibling viewports", () => {
    withFakeSvg((svg) => {
      const spin = buildSpinCellField({ bit: 0 });
      renderSpinView(svg, spin);
      assert.ok(svg.querySelector(".sv-spin-field"));
      assert.equal(svg.querySelector(".sv-wave-field"), null);

      renderWaveView(svg, evaluateTunnelingModel({}));
      assert.equal(svg.querySelector(".sv-spin-field"), null);
      assert.ok(svg.querySelector(".sv-wave-field"));
      assert.equal(svg.children.filter((child) => child.attributes?.get("class") === "sv-wave-field").length, 1);
    });
  });

  it("animates the solved wave phase while keeping probability density stationary", () => {
    withFakeSvg((svg) => {
      const model = evaluateTunnelingModel({});
      renderWaveView(svg, model, { phaseRad: 0 });
      const waveAtZero = nodesWithAttribute(svg, "data-curve", "wavefunction")[0].attributes.get("d");
      const densityAtZero = nodesWithAttribute(svg, "data-curve", "probability-density")[0].attributes.get("d");
      renderWaveView(svg, model, { phaseRad: Math.PI / 2 });
      const waveAtQuarterCycle = nodesWithAttribute(svg, "data-curve", "wavefunction")[0].attributes.get("d");
      const densityAtQuarterCycle = nodesWithAttribute(svg, "data-curve", "probability-density")[0].attributes.get("d");
      assert.notEqual(waveAtQuarterCycle, waveAtZero);
      assert.equal(densityAtQuarterCycle, densityAtZero);
      // |psi|^2 and the |psi| envelope are the stationary curves.
      assert.equal(nodesWithAttribute(svg, "data-stationary", "true").length, 2);
    });
  });

  it("keeps both animated viewports free of embedded text", () => {
    withFakeSvg((svg) => {
      renderSpinView(svg, buildSpinCellField({ bit: 1 }));
      assert.equal(textContent(svg), "");
      assert.equal(svg.all().some((node) => node.name === "text"), false);
      assert.match(svg.attributes.get("aria-label"), /spin map/i);
    });
    withFakeSvg((svg) => {
      renderWaveView(svg, evaluateTunnelingModel({}));
      assert.equal(textContent(svg), "");
      assert.equal(svg.all().some((node) => node.name === "text"), false);
      assert.match(svg.attributes.get("aria-label"), /finite-barrier/i);
    });
  });

  it("draws P as up arrows and AP as down arrows, never circled-dot glyphs", () => {
    withFakeSvg((svg) => {
      renderSpinView(svg, buildSpinCellField({ bit: 1, disorder: 0, nx: 4, freeRows: 2, referenceRows: 2 }));
      const free = svg.querySelector(".sv-free-spin-glyphs");
      assert.ok(free);
      assert.ok(nodesWithAttribute(free, "data-spin-glyph", "arrow").length > 0);
      assert.ok(nodesWithAttribute(free, "data-magnetization-arrow", "true").length > 0);
      assert.ok(nodesWithAttribute(free, "data-arrowhead", "true").length > 0);
      assert.equal(free.all().filter((node) => node.name === "circle").length, 0);
      const shaft = free.all().find((node) => node.attributes.get("data-magnetization-arrow") === "true");
      assert.ok(Number(shaft.attributes.get("y2")) < Number(shaft.attributes.get("y1")));
    });
    withFakeSvg((svg) => {
      renderSpinView(svg, buildSpinCellField({ bit: 0, disorder: 0, nx: 4, freeRows: 2, referenceRows: 2 }));
      const free = svg.querySelector(".sv-free-spin-glyphs");
      const shaft = free.all().find((node) => node.attributes.get("data-magnetization-arrow") === "true");
      assert.ok(Number(shaft.attributes.get("y2")) > Number(shaft.attributes.get("y1")));
      assert.equal(free.all().filter((node) => node.name === "circle").length, 0);
    });
  });

  it("draws visible free-layer arrows that converge on the probability peak", () => {
    withFakeSvg((svg) => {
      const field = buildSpinCellField({ bit: 1, disorder: 0, nx: 4, freeRows: 2, referenceRows: 2 });
      const layout = createScientificSpinLayout("desktop", null);
      const peak = probabilityPeakPoint(layout, { peakXNm: -0.8, params: { barrierThicknessNm: 1 } });
      renderSpinView(svg, field, { probabilityPeak: peak });

      const free = svg.querySelector(".sv-free-spin-glyphs");
      const shafts = free.all().filter((node) => node.attributes.get("data-magnetization-arrow") === "true");
      assert.equal(shafts.length, 8);
      for (const shaft of shafts) {
        const x1 = Number(shaft.attributes.get("x1"));
        const y1 = Number(shaft.attributes.get("y1"));
        const x2 = Number(shaft.attributes.get("x2"));
        const y2 = Number(shaft.attributes.get("y2"));
        assert.ok(Math.hypot(x2 - x1, y2 - y1) > 1, "arrow must have a visible length");
        const tailDistance = Math.hypot(peak.x - x1, peak.y - y1);
        const tipDistance = Math.hypot(peak.x - x2, peak.y - y2);
        assert.ok(tipDistance <= tailDistance, "arrow tip must aim at the probability peak");
      }
      assert.equal(nodesWithAttribute(svg, "data-probability-peak", "true").length, 1);

      // The pinned reference layer keeps its own magnetization direction.
      const reference = svg.querySelector(".sv-reference-spin-glyphs");
      const pinned = reference.all().find((node) => node.attributes.get("data-magnetization-arrow") === "true");
      assert.ok(Number(pinned.attributes.get("y2")) < Number(pinned.attributes.get("y1")));
    });
  });

  it("clips spin glyphs to the magnetic layers and leaves the barrier empty", () => {
    withFakeSvg((svg) => {
      renderSpinView(svg, buildSpinCellField({ bit: 1 }));
      assert.equal(nodesWithAttribute(svg, "data-spin-layer", "barrier").length, 0);
      assert.equal(nodesWithAttribute(svg, "data-spin-layer", "free").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-spin-layer", "reference").length, 1);
      assert.equal(
        nodesWithAttribute(svg, "clip-path", "url(#sv-spin-free-clip)").length,
        1
      );
      assert.equal(
        nodesWithAttribute(svg, "clip-path", "url(#sv-spin-reference-clip)").length,
        1
      );
      assert.equal(nodesWithAttribute(svg, "data-face", "xy-map").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-context-only", "true").length, 1);
    });
  });

  it("fills the whole free-layer partition with the magnetization map", () => {
    const layout = createScientificSpinLayout("desktop", null);
    assert.equal(layout.free.x, layout.freePartition.x);
    assert.equal(layout.free.y, layout.freePartition.y);
    assert.equal(layout.free.w, layout.freePartition.w);
    assert.equal(layout.free.t, layout.freePartition.t);
    // x and y are scaled independently, so the drawn aspect is recorded explicitly.
    assert.ok(layout.footprint.nmPerPxX > 0);
    assert.ok(layout.footprint.nmPerPxY > 0);
    assert.notEqual(layout.footprint.aspectDrawn, layout.footprint.aspectPhysical);
  });

  it("draws every wave curve on one shared proportional position axis", () => {
    withFakeSvg((svg) => {
      const model = evaluateTunnelingModel({
        barrierThicknessNm: 1,
        barrierHeightEv: 1.2,
        electronEnergyEv: 0.25
      });
      renderWaveView(svg, model);
      const field = svg.querySelector(".sv-wave-field");
      const xMin = Number(field.attributes.get("data-x-min-nm"));
      const xMax = Number(field.attributes.get("data-x-max-nm"));
      assert.equal(xMin, model.potential.xMinNm);
      assert.equal(xMax, model.potential.xMaxNm);

      const barrier = nodesWithAttribute(svg, "data-region-band", "barrier")[0];
      const left = nodesWithAttribute(svg, "data-region-band", "left")[0];
      const right = nodesWithAttribute(svg, "data-region-band", "right")[0];
      const totalWidth =
        Number(left.attributes.get("width")) +
        Number(barrier.attributes.get("width")) +
        Number(right.attributes.get("width"));
      // The barrier occupies its true fraction of the plotted position range.
      const expectedFraction = model.params.barrierThicknessNm / (xMax - xMin);
      const drawnFraction = Number(barrier.attributes.get("width")) / totalWidth;
      assert.ok(Math.abs(drawnFraction - expectedFraction) < 1e-6);

      for (const curve of ["potential-vx", "wavefunction", "probability-density", "electron-energy"]) {
        assert.equal(nodesWithAttribute(svg, "data-curve", curve).length, 1);
      }
      assert.equal(svg.querySelector(".sv-free-spin-glyphs"), null);
      assert.equal(nodesWithAttribute(svg, "data-flow-component", "incident").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-flow-component", "reflected").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-flow-component", "transmitted").length, 1);
      assert.ok(nodesWithAttribute(svg, "data-probability-arrow", "true").length > 3);
      assert.equal(nodesWithAttribute(svg, "data-peak-marker", "true").length, 1);
    });
  });

  it("scales the reflected and transmitted flow arrows by the solved amplitudes", () => {
    withFakeSvg((svg) => {
      const model = evaluateTunnelingModel({
        barrierThicknessNm: 2,
        barrierHeightEv: 1.5,
        electronEnergyEv: 0.2
      });
      renderWaveView(svg, model);
      const reflected = nodesWithAttribute(svg, "data-flow-component", "reflected")[0];
      const transmitted = nodesWithAttribute(svg, "data-flow-component", "transmitted")[0];
      assert.equal(
        Number(reflected.attributes.get("data-amplitude")).toFixed(6),
        Math.sqrt(model.reflection).toFixed(6)
      );
      assert.equal(
        Number(transmitted.attributes.get("data-amplitude")).toFixed(6),
        Math.sqrt(model.transmission).toFixed(6)
      );
      // A thick, high barrier reflects nearly everything, so transmitted << reflected.
      const reflectedLength = Math.abs(
        Number(reflected.attributes.get("x2")) - Number(reflected.attributes.get("x1"))
      );
      const transmittedLength = Math.abs(
        Number(transmitted.attributes.get("x2")) - Number(transmitted.attributes.get("x1"))
      );
      assert.ok(transmittedLength < reflectedLength);
    });
  });

  it("clips raw OVF vectors to the free layer and keeps non-OVF context bands", () => {
    withFakeSvg((svg) => {
      const frame = {
        path: "outputs/m000001.ovf",
        label: "m000001.ovf",
        index: 1,
        bytes: 128,
        format: "ovf",
        metadata: { xnodes: 2, ynodes: 1, znodes: 1 },
        warnings: [],
        vectors: [
          { index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: -1, magnitude: 1 },
          { index: 1, x: 1, y: 0, z: 0, mx: 0, my: 0, mz: -1, magnitude: 1 }
        ]
      };
      renderOvfFrameViewport(svg, frame, {
        meanMx: 0,
        meanMy: 0,
        meanMz: -1,
        maxFrameDelta: 0,
        staticAtPrecision: true,
        switchingOccurred: "no"
      });
      assert.equal(nodesWithAttribute(svg, "data-source", "mumax3-ovf").length, 1);
      assert.equal(nodesWithAttribute(svg, "clip-path", "url(#sv-ovf-free-clip)").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-spin-layer", "barrier").length, 0);
      assert.equal(nodesWithAttribute(svg, "data-spin-layer", "reference-context").length, 0);
      assert.equal(nodesWithAttribute(svg, "data-face", "xy-map").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-composition", "scientific-xy").length >= 1, true);
      assert.equal(textContent(svg), "");
      assert.equal(
        nodesWithAttribute(svg, "data-cell-vector", "0").length +
          nodesWithAttribute(svg, "data-cell-vector", "1").length,
        2
      );
      assert.equal(svg.querySelector(".sv-stack"), null);
    });
  });

  it("bins a raw 64×32 OVF plane into 16×8 display vectors without interpolation", () => {
    const vectors = [];
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        vectors.push({
          index: y * 64 + x,
          x,
          y,
          z: 0,
          mx: x < 32 ? -1 : 1,
          my: 0,
          mz: y < 16 ? -0.5 : 0.5,
          magnitude: 1
        });
      }
    }
    const display = downsampleOvfVectors(vectors, {
      nx: 64,
      ny: 32,
      activeZ: 0,
      targetNx: 16,
      targetNy: 8
    });
    assert.equal(display.nx, 16);
    assert.equal(display.ny, 8);
    assert.equal(display.vectors.length, 128);
    assert.ok(display.vectors.every((vector) => vector.sourceCount === 16));
    assert.deepEqual(new Set(display.vectors.map((vector) => vector.mx)), new Set([-1, 1]));
    assert.deepEqual(new Set(display.vectors.map((vector) => vector.mz)), new Set([-0.5, 0.5]));
  });

  it("draws the chip composition as three equal visual partitions", () => {
    withFakeSvg((svg) => {
      renderSpinView(svg, buildSpinCellField({ bit: 1 }));
      const layout = createScientificSpinLayout("desktop");
      assert.equal(layout.partitions.length, 3);
      assert.ok(
        layout.partitions.every(
          (partition) => Math.abs(partition.t - layout.partitions[0].t) < 1e-9
        )
      );
      assert.equal(nodesWithAttribute(svg, "data-equal-partition", "free").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-equal-partition", "barrier").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-equal-partition", "reference").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-face", "xy-map").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-face", "band").length, 2);
      assert.equal(nodesWithAttribute(svg, "data-render-dimension", "2d").length, 1);
      assert.equal(svg.querySelector(".sv-ground-plane"), null);
      assert.equal(svg.querySelector(".sv-surface-mesh"), null);
      assert.equal(nodesWithAttribute(svg, "data-cell-body", "spin").length, 1);
      const clips = svg.all().filter((node) => node.name === "clipPath");
      assert.equal(clips.length, 3);
      for (const clip of clips) {
        assert.equal(clip.children.length, 1);
        assert.equal(clip.children[0].name, "rect");
      }
    });
  });

  it("keeps free-layer glyphs inside regular non-overlapping 2D slots", () => {
    withFakeSvg((svg) => {
      const field = buildSpinCellField({ bit: 1 });
      renderSpinView(svg, field);
      const layout = createScientificSpinLayout("desktop");
      const free = layout.free;
      const sizing = calculateGlyphSizing({
        width: free.w,
        height: free.t,
        nx: field.nx,
        ny: field.freeRows
      });
      const glyphs = svg.querySelector(".sv-free-spin-glyphs");
      assert.ok(glyphs);
      const shafts = glyphs.all().filter((node) => node.attributes.get("data-magnetization-arrow") === "true");
      assert.ok(shafts.length > 0);
      for (const node of shafts) {
        const x1 = Number(node.attributes.get("x1"));
        const y1 = Number(node.attributes.get("y1"));
        const x2 = Number(node.attributes.get("x2"));
        const y2 = Number(node.attributes.get("y2"));
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        assert.ok(cx >= free.x - sizing.arrowLength && cx <= free.right + sizing.arrowLength);
        assert.ok(cy >= free.y - sizing.arrowLength && cy <= free.bottom + sizing.arrowLength);
      }
      const [firstX, firstY] = layerSlot(free, 0, 0, field.nx, field.freeRows);
      assert.ok(firstX > free.x && firstY > free.y);
      assert.ok(sizing.arrowLength < sizing.slot);
      assert.ok(sizing.arrowLength > sizing.slot * 0.5);
    });
  });

  it("uses a dedicated portrait composition for the compact variant", () => {
    withFakeSvg((svg) => {
      renderSpinView(svg, buildSpinCellField({ bit: 0 }), { variant: "compact" });
      assert.equal(svg.attributes.get("viewBox"), "0 0 420 560");
      assert.equal(nodesWithAttribute(svg, "data-view-variant", "compact").length, 1);
      assert.equal(textContent(svg), "");
      assert.equal(nodesWithAttribute(svg, "data-spin-layer", "free").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-spin-layer", "reference").length, 1);
    });

    withFakeSvg((svg) => {
      renderSpinView(svg, buildSpinCellField({ bit: 0 }));
      assert.equal(svg.attributes.get("viewBox"), "0 0 1280 720");
    });
  });

  it("keeps the wave view on one continuous body in both variants", () => {
    for (const variant of /** @type {const} */ (["desktop", "compact"])) {
      withFakeSvg((svg) => {
        renderWaveView(svg, evaluateTunnelingModel({}), { variant });
        assert.equal(nodesWithAttribute(svg, "data-cell-body", "wave").length, 1);
        for (const band of ["left", "barrier", "right"]) {
          assert.equal(nodesWithAttribute(svg, "data-region-band", band).length, 1);
        }
        assert.equal(svg.querySelector(".sv-free-spin-glyphs"), null);
        assert.equal(nodesWithAttribute(svg, "data-flow-component", "incident").length, 1);
        assert.equal(nodesWithAttribute(svg, "data-flow-component", "reflected").length, 1);
        assert.equal(nodesWithAttribute(svg, "data-flow-component", "transmitted").length, 1);
      });
    }
  });

  it("keeps psi continuous across both interfaces on the shared axis", () => {
    withFakeSvg((svg) => {
      const model = evaluateTunnelingModel({});
      renderWaveView(svg, model);
      const psi = nodesWithAttribute(svg, "data-curve", "wavefunction")[0];
      const commands = psi.attributes.get("d").trim().split(/\s+(?=[ML])/);
      assert.equal(commands.length, model.wavePoints.length);
      const points = commands.map((command) => {
        const [, x, y] = command.split(/\s+/);
        return { x: Number(x), y: Number(y) };
      });
      // Monotonic in x and free of jumps: one function of position, not three plots.
      for (let index = 1; index < points.length; index += 1) {
        assert.ok(points[index].x >= points[index - 1].x);
        assert.ok(Math.abs(points[index].y - points[index - 1].y) < 40);
      }
    });
  });

  it("caps glyphs by the smaller dense-grid slot", () => {
    const sizing = calculateGlyphSizing({ width: 490, height: 92, nx: 64, ny: 32 });
    assert.equal(sizing.slot, 92 / 32);
    assert.ok(sizing.glyphRadius <= sizing.slot * 0.18);
    assert.ok(sizing.arrowLength <= sizing.slot * 0.9);
    assert.ok(sizing.arrowLength < sizing.slot);
    assert.equal(sizing.strokeWidth, Math.min(Math.max(2.4, sizing.slot * 0.12), 6.5));
    assert.equal(sizing.lod, "arrow");
  });
});

describe("scientific OVF map honesty", () => {
  const ellipseGeometry = {
    cellShape: /** @type {const} */ ("ellipse"),
    freeLayerThickness: { value: 1.2, unit: "nm" },
    freeLayerLength: { value: 80, unit: "nm" },
    freeLayerWidth: { value: 40, unit: "nm" },
    barrierThickness: { value: 1, unit: "nm" },
    referenceLayerThickness: { value: 2.4, unit: "nm" }
  };

  it("clips the free layer to an ellipse when the device footprint is elliptical", () => {
    withFakeSvg((svg) => {
      renderOvfFrameViewport(
        svg,
        {
          path: "outputs/m000000.ovf",
          label: "m000000.ovf",
          index: 0,
          bytes: 64,
          format: "ovf",
          metadata: { xnodes: 2, ynodes: 1, znodes: 1 },
          warnings: [],
          vectors: [
            { index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: 1, magnitude: 1 },
            { index: 1, x: 1, y: 0, z: 0, mx: 0, my: 0, mz: 1, magnitude: 1 }
          ]
        },
        { geometry: ellipseGeometry }
      );
      const freeClip = svg.all().find((node) => node.attributes.get("id") === "sv-ovf-free-clip");
      assert.ok(freeClip);
      assert.equal(freeClip.children[0].name, "ellipse");
      assert.equal(textContent(svg), "");
    });
  });

  it("draws +z as an up arrow and -z as a down arrow", () => {
    /** @param {number} mz */
    const renderSingleCell = (mz, run) =>
      withFakeSvg((svg) => {
        renderOvfFrameViewport(svg, {
          path: "outputs/m000000.ovf",
          label: "m000000.ovf",
          index: 0,
          bytes: 64,
          format: "ovf",
          metadata: { xnodes: 1, ynodes: 1, znodes: 1 },
          warnings: [],
          vectors: [{ index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz, magnitude: 1 }]
        });
        run(svg);
      });

    renderSingleCell(1, (svg) => {
      const field = svg.querySelector(".sv-ovf-cell-vectors");
      assert.ok(field);
      assert.equal(nodesWithAttribute(field, "data-spin-glyph", "arrow").length, 1);
      const shaft = field.all().find((node) => node.attributes.get("data-magnetization-arrow") === "true");
      assert.ok(Number(shaft.attributes.get("y2")) < Number(shaft.attributes.get("y1")));
      assert.equal(nodesWithAttribute(field, "data-arrowhead", "true").length, 1);
    });
    renderSingleCell(-1, (svg) => {
      const field = svg.querySelector(".sv-ovf-cell-vectors");
      const shaft = field.all().find((node) => node.attributes.get("data-magnetization-arrow") === "true");
      assert.ok(Number(shaft.attributes.get("y2")) > Number(shaft.attributes.get("y1")));
      assert.equal(nodesWithAttribute(field, "data-arrowhead", "true").length, 1);
    });
  });

  it("projects unit magnetization as x–z arrows", () => {
    const sizing = calculateGlyphSizing({ width: 400, height: 200, nx: 4, ny: 2 });
    const L = sizing.arrowLength;
    const [px, py] = projectMagnetizationArrow({ mx: 0, my: 0, mz: 1 }, L);
    assert.ok(Math.abs(px) < 1e-12);
    assert.equal(py, -L);
    const [ax, ay] = projectMagnetizationArrow({ mx: 0, my: 0, mz: -1 }, L);
    assert.ok(Math.abs(ax) < 1e-12);
    assert.equal(ay, L);
    const [rx, ry] = projectMagnetizationArrow({ mx: 1, my: 0, mz: 0 }, L);
    assert.equal(rx, L);
    assert.ok(Math.abs(ry) < 1e-12);
    const [zx, zy] = projectMagnetizationArrow({ mx: 0, my: 0, mz: 0 }, L);
    assert.ok(Math.abs(zx) < 1e-12);
    assert.ok(Math.abs(zy) < 1e-12);
    const [tx, ty] = projectMagnetizationArrow({ mx: 0.6, my: 0.8, mz: 0 }, L);
    assert.equal(tx, 0.6 * L);
    assert.ok(Math.abs(ty) < 1e-12);
    const [ox, oy] = projectMagnetizationArrow({ mx: 0, my: 1, mz: 0 }, L);
    assert.ok(Math.abs(ox) < 1e-12);
    assert.ok(Math.abs(oy) < 1e-12);
  });

  it("colors uniform +z P red and uniform -z AP blue on the fixed mz scale", () => {
    withFakeSvg((svg) => {
      renderOvfFrameViewport(
        svg,
        {
          path: "outputs/m000000.ovf",
          label: "m000000.ovf",
          index: 0,
          bytes: 64,
          format: "ovf",
          metadata: { xnodes: 1, ynodes: 1, znodes: 1 },
          warnings: [],
          vectors: [{ index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: 1, magnitude: 1 }]
        },
        { meanMz: 1 }
      );
      const shaft = arrowShaft(svg);
      assert.equal(shaft.attributes.get("stroke"), "rgb(220, 38, 38)");
    });
    withFakeSvg((svg) => {
      renderOvfFrameViewport(
        svg,
        {
          path: "outputs/m000001.ovf",
          label: "m000001.ovf",
          index: 1,
          bytes: 64,
          format: "ovf",
          metadata: { xnodes: 1, ynodes: 1, znodes: 1 },
          warnings: [],
          vectors: [{ index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: -1, magnitude: 1 }]
        },
        { meanMz: -1 }
      );
      const shaft = arrowShaft(svg);
      assert.equal(shaft.attributes.get("stroke"), "rgb(37, 99, 235)");
    });
  });

  it("orients +x right and +z up", () => {
    withFakeSvg((svg) => {
      renderOvfFrameViewport(
        svg,
        {
          path: "outputs/m000002.ovf",
          label: "m000002.ovf",
          index: 2,
          bytes: 64,
          format: "ovf",
          metadata: { xnodes: 1, ynodes: 1, znodes: 1 },
          warnings: [],
          vectors: [{ index: 0, x: 0, y: 0, z: 0, mx: 1, my: 0, mz: 0, magnitude: 1 }]
        }
      );
      const arrow = arrowShaft(svg);
      assert.ok(Number(arrow.attributes.get("x2")) > Number(arrow.attributes.get("x1")));
      assert.equal(Number(arrow.attributes.get("y2")), Number(arrow.attributes.get("y1")));
    });
    withFakeSvg((svg) => {
      renderOvfFrameViewport(
        svg,
        {
          path: "outputs/m000003.ovf",
          label: "m000003.ovf",
          index: 3,
          bytes: 64,
          format: "ovf",
          metadata: { xnodes: 1, ynodes: 1, znodes: 1 },
          warnings: [],
          vectors: [{ index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: 1, magnitude: 1 }]
        }
      );
      const arrow = arrowShaft(svg);
      assert.equal(Number(arrow.attributes.get("x2")), Number(arrow.attributes.get("x1")));
      assert.ok(Number(arrow.attributes.get("y2")) < Number(arrow.attributes.get("y1")));
    });
  });

  it("skips inactive |m|<0.05 cells when downsampling for display", () => {
    const display = downsampleOvfVectors(
      [
        { index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: 1, magnitude: 1 },
        { index: 1, x: 1, y: 0, z: 0, mx: 0, my: 0, mz: 0, magnitude: 0 }
      ],
      { nx: 2, ny: 1, activeZ: 0, targetNx: 2, targetNy: 1 }
    );
    assert.equal(display.vectors.length, 1);
    assert.equal(display.vectors[0].mz, 1);
  });

  it("renders a display-downsampled quiver with fewer large non-overlapping arrows than the raw OVF grid", () => {
    const vectors = [];
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        vectors.push({
          index: y * 64 + x,
          x,
          y,
          z: 0,
          mx: 0.4,
          my: 0.2,
          mz: x < 32 ? -0.8 : 0.8,
          magnitude: 1
        });
      }
    }
    withFakeSvg((svg) => {
      renderOvfFrameViewport(
        svg,
        {
          path: "outputs/m000010.ovf",
          label: "m000010.ovf",
          index: 10,
          bytes: 2048,
          format: "ovf",
          metadata: { xnodes: 64, ynodes: 32, znodes: 1 },
          warnings: [],
          vectors
        }
      );
      const field = svg.querySelector(".sv-ovf-cell-vectors");
      assert.ok(field);
      assert.equal(field.attributes.get("data-display-downsampled"), "true");
      const displayNx = Number(field.attributes.get("data-display-nx"));
      const displayNy = Number(field.attributes.get("data-display-ny"));
      const rawCount = 64 * 32;
      const displayCount = Number(field.attributes.get("data-display-vector-count"));
      assert.ok(displayCount <= 160);
      assert.ok(displayCount < rawCount / 8);
      assert.equal(nodesWithAttribute(svg, "data-in-plane-vector", "0").length >= 1, true);
      assert.ok(nodesWithAttribute(svg, "data-arrowhead", "true").length >= displayCount);
      const layout = createScientificSpinLayout("desktop");
      const sizing = calculateGlyphSizing({
        width: layout.free.w,
        height: layout.free.t,
        nx: displayNx,
        ny: displayNy
      });
      assert.ok(sizing.arrowLength < sizing.slot);
      assert.ok(sizing.arrowLength >= 20);
      assert.equal(textContent(svg), "");
    });
  });

  it("picks a sparse display lattice from viewport size", () => {
    assert.deepEqual(pickOvfDisplayLattice("compact", 400, 240), { nx: 8, ny: 4 });
    assert.deepEqual(pickOvfDisplayLattice("desktop", 700, 320), { nx: 12, ny: 6 });
    assert.deepEqual(pickOvfDisplayLattice("desktop", 1000, 500), { nx: 16, ny: 8 });
  });
});

describe("TwinViewport quantum wave mode", () => {
  it("renders waves and incident/reflected/transmitted arrows on both sides of the barrier", () => {
    withFakeSvg((svg) => {
      const metricsRoot = new FakeNode("div");
      const controller = new TwinViewportController({
        svg,
        controlsRoot: new FakeNode("div"),
        modeRoot: new FakeNode("div"),
        metricsRoot,
        getState: () => createDefaultState(),
        getResult: () => null
      });
      controller.mounted = true;
      controller.controls.viewMode = "quantum_wave";
      controller.render();
      assert.ok(svg.querySelector(".sv-wave-field"));
      assert.equal(nodesWithAttribute(svg, "data-region-band", "left").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-region-band", "barrier").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-region-band", "right").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-flow-component", "incident").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-flow-component", "reflected").length, 1);
      assert.equal(nodesWithAttribute(svg, "data-flow-component", "transmitted").length, 1);
      assert.equal(textContent(svg), "");
      assert.doesNotMatch(metricsRoot.innerHTML, /MuMax3 computes tunneling/i);
      assert.match(metricsRoot.innerHTML, /data-class="MODEL"/);
    });
  });
});

/** Fake node supporting the class, attribute, and descendant selectors updateSpinView uses. */
class SelectorNode {
  constructor(name) {
    this.name = name;
    this.attributes = new Map();
    this.children = [];
    this.parent = null;
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  all() {
    return [this, ...this.children.flatMap((child) => child.all())];
  }

  matchesPart(part) {
    if (part.startsWith(".")) {
      return (this.attributes.get("class") ?? "").split(/\s+/).includes(part.slice(1));
    }
    const attr = /^\[([^=\]]+)=['"]?([^'"\]]*)['"]?\]$/.exec(part);
    if (!attr) return false;
    return this.attributes.get(attr[1]) === attr[2];
  }

  querySelector(selector) {
    const parts = selector.trim().split(/\s+/);
    const target = parts[parts.length - 1];
    const ancestors = parts.slice(0, -1).reverse();
    return (
      this.all().find((node) => {
        if (node === this || !node.matchesPart(target)) return false;
        let cursor = node.parent;
        for (const part of ancestors) {
          while (cursor && !cursor.matchesPart(part)) cursor = cursor.parent;
          if (!cursor) return false;
          cursor = cursor.parent;
        }
        return true;
      }) ?? null
    );
  }
}

function withSelectorSvg(run) {
  const previousDocument = globalThis.document;
  const previousSvgElement = globalThis.SVGElement;
  globalThis.document = {
    createElementNS(_namespace, name) {
      return new SelectorNode(name);
    }
  };
  globalThis.SVGElement = SelectorNode;
  try {
    run(new SelectorNode("svg"));
  } finally {
    globalThis.document = previousDocument;
    globalThis.SVGElement = previousSvgElement;
  }
}

describe("spin viewport playback stability", () => {
  /** @param {{x: number, y: number, z: number}} freeMagnetization */
  const fieldFor = (freeMagnetization) =>
    buildSpinCellField({
      nx: 8,
      freeRows: 3,
      referenceRows: 2,
      bit: 1,
      seed: 42,
      temperature: 0,
      disorder: 0,
      freeMagnetization
    });

  it("keeps arrow nodes when the projection collapses so playback never rebuilds the SVG", () => {
    withSelectorSvg((svg) => {
      renderSpinView(svg, fieldFor({ x: 0, y: 0, z: 1 }));
      const rootBefore = svg.querySelector(".sv-spin-field");
      const glyphBefore = svg.querySelector('[data-spin-layer="free"] [data-cell="0,0"]');
      assert.ok(rootBefore);
      assert.ok(glyphBefore);

      // m along +y projects to zero screen length in the x-z view.
      updateSpinView(svg, fieldFor({ x: 0, y: 1, z: 0 }));
      assert.equal(svg.querySelector(".sv-spin-field"), rootBefore, "SVG was rebuilt");
      const glyphDegenerate = svg.querySelector('[data-spin-layer="free"] [data-cell="0,0"]');
      assert.equal(glyphDegenerate, glyphBefore, "free-layer glyph node was replaced");
      assert.equal(glyphDegenerate.getAttribute("visibility"), "hidden");
      assert.ok(glyphDegenerate.querySelector("[data-magnetization-arrow='true']"));

      updateSpinView(svg, fieldFor({ x: 0, y: 0, z: -1 }));
      assert.equal(svg.querySelector(".sv-spin-field"), rootBefore, "SVG was rebuilt");
      const glyphAfter = svg.querySelector('[data-spin-layer="free"] [data-cell="0,0"]');
      assert.equal(glyphAfter, glyphBefore, "free-layer glyph node was replaced");
      assert.equal(glyphAfter.getAttribute("visibility"), "visible");
      const shaft = glyphAfter.querySelector("[data-magnetization-arrow='true']");
      assert.ok(Number(shaft.getAttribute("y2")) > Number(shaft.getAttribute("y1")));
    });
  });

  it("stretches the loop so a precessing trajectory stays under the readable angular rate", () => {
    /** @param {number} turns */
    const precession = (turns, count) =>
      Array.from({ length: count }, (_, index) => {
        const phase = (index / (count - 1)) * turns * 2 * Math.PI;
        return { time: index * 1e-12, mx: Math.cos(phase), my: Math.sin(phase), mz: 0 };
      });

    const oneTurn = precession(1, 400);
    assert.ok(Math.abs(magnetizationPathDegrees(oneTurn) - 360) < 1);
    // A single turn is slow enough to keep the floor duration.
    assert.equal(spinDisplaySecondsForSamples(oneTurn), SPIN_TRAJECTORY_DISPLAY_SECONDS);

    const manyTurns = precession(12, 4000);
    const seconds = spinDisplaySecondsForSamples(manyTurns);
    assert.ok(seconds > SPIN_TRAJECTORY_DISPLAY_SECONDS, "loop was not stretched");
    assert.ok(seconds <= SPIN_TRAJECTORY_MAX_DISPLAY_SECONDS);
    const degPerFrame = magnetizationPathDegrees(manyTurns) / (seconds * 60);
    assert.ok(degPerFrame < 6, `expected a readable rate, got ${degPerFrame} deg/frame`);

    const extreme = precession(400, 20000);
    assert.equal(spinDisplaySecondsForSamples(extreme), SPIN_TRAJECTORY_MAX_DISPLAY_SECONDS);
    assert.equal(spinDisplaySecondsForSamples([]), SPIN_TRAJECTORY_DISPLAY_SECONDS);
  });

  it("emits a hidden shaft for cells whose magnetization lies along y", () => {
    withSelectorSvg((svg) => {
      renderSpinView(svg, fieldFor({ x: 0, y: 1, z: 0 }));
      const glyph = svg.querySelector('[data-spin-layer="free"] [data-cell="1,1"]');
      assert.ok(glyph);
      assert.equal(glyph.getAttribute("visibility"), "hidden");
      assert.ok(glyph.querySelector("[data-magnetization-arrow='true']"));
    });
  });
});
