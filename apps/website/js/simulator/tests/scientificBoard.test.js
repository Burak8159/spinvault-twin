import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDynamicsDiagnostics,
  buildScientificBoardModel,
  buildSnapshotSlots,
  buildSweepBoardModel,
  selectSnapshotIndices
} from "../lib/scientificBoardModel.js";
import { buildQuantumTransportView } from "../lib/quantumTransportView.js";
import {
  ScientificBoardController,
  DEFAULT_SCIENTIFIC_BOARD_OPEN,
  renderQuantumPanel,
  renderSnapshotMap,
  renderSweepPanel,
  renderTracePanel
} from "../components/scientificBoard.js";

class FakeNode {
  /**
   * @param {string} name
   */
  constructor(name) {
    this.name = name;
    this.tagName = name.toUpperCase();
    this.attributes = new Map();
    /** @type {FakeNode[]} */
    this.children = [];
    this.textContent = "";
    this.classList = {
      /** @param {string} token */
      add: (token) => {
        const current = this.attributes.get("class") ?? "";
        const next = new Set(current.split(/\s+/).filter(Boolean));
        next.add(token);
        this.attributes.set("class", [...next].join(" "));
      }
    };
    /** @type {string} */
    this._html = "";
  }

  /**
   * @param {string} name
   * @param {string | number} value
   */
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  /**
   * @param {string} name
   */
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  get className() {
    return this.attributes.get("class") ?? "";
  }

  set className(value) {
    this.attributes.set("class", String(value));
  }

  addEventListener() {}

  /**
   * @param {...FakeNode} children
   */
  append(...children) {
    this.children.push(...children);
  }

  /**
   * @param {...FakeNode} children
   */
  replaceChildren(...children) {
    this.children = children;
    this._html = "";
  }

  get innerHTML() {
    return this._html;
  }

  set innerHTML(html) {
    this._html = String(html);
    this.children = parseFlatDataNodes(this._html);
  }

  /**
   * @param {string} selector
   */
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /**
   * @param {string} selector
   * @returns {FakeNode[]}
   */
  querySelectorAll(selector) {
    return [this, ...this.children].filter((node) => matches(node, selector));
  }

  all() {
    return [this, ...this.children.flatMap((child) => child.all?.() ?? [child])];
  }
}

/**
 * Capture figures / empty hosts that carry data-* attrs (sufficient for board panel tests).
 * @param {string} html
 * @returns {FakeNode[]}
 */
function parseFlatDataNodes(html) {
  /** @type {FakeNode[]} */
  const nodes = [];
  const re =
    /<(figure|div|svg|figcaption)([^>]*data-[^>]*)>([\s\S]*?)<\/\1>|<(figure|div|svg)([^>]*data-[^>]*)\s*\/>/gi;
  let match;
  while ((match = re.exec(html))) {
    const name = match[1] ?? match[4];
    const attrs = match[2] ?? match[5] ?? "";
    const inner = match[3] ?? "";
    const node = new FakeNode(name);
    for (const am of attrs.matchAll(/([a-zA-Z0-9:_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      node.setAttribute(am[1], am[2] ?? am[3] ?? am[4] ?? "");
    }
    node._html = inner;
    if (/<svg[\s>]/i.test(inner)) {
      const svg = new FakeNode("svg");
      node.children.push(svg);
    }
    if (/<figcaption[\s>]/i.test(inner)) {
      const cap = new FakeNode("figcaption");
      const capText = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
      if (capText) cap.textContent = capText[1].replace(/<[^>]+>/g, "").trim();
      node.children.push(cap);
    }
    nodes.push(node);
  }
  return nodes;
}

/**
 * @param {FakeNode} node
 * @param {string} selector
 */
function matches(node, selector) {
  if (selector === "svg") return node.name === "svg";
  if (selector === "figcaption") return node.name === "figcaption";
  if (selector.startsWith(".")) {
    return node.className.split(/\s+/).includes(selector.slice(1));
  }
  const attrMatch = selector.match(/^\[([^=\]]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]$/);
  if (attrMatch) {
    const name = attrMatch[1];
    const expected = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4];
    const actual = node.getAttribute(name);
    if (expected == null) return actual != null || node.attributes.has(name);
    return actual === expected;
  }
  return node.name === selector;
}

/**
 * @param {() => void | Promise<void>} run
 */
async function withFakeDom(run) {
  const previous = globalThis.document;
  globalThis.document = {
    createElementNS(_ns, name) {
      return new FakeNode(name);
    },
    createElement(name) {
      return new FakeNode(name);
    }
  };
  try {
    await run();
  } finally {
    globalThis.document = previous;
  }
}

/**
 * @returns {import("../lib/types").SimulationResult}
 */
function mumaxResultFixture() {
  return {
    source: "mumax3",
    isPhysicalSimulation: Boolean(1),
    summary: "MuMax3 free-layer fixture for board tests.",
    series: [
      {
        id: "mx",
        label: "mx",
        xLabel: "Time",
        xUnit: "s",
        yLabel: "mx",
        yUnit: "dimensionless",
        points: [
          { x: 0, y: 0.02 },
          { x: 1e-9, y: 0.1 },
          { x: 2e-9, y: 0.05 }
        ]
      },
      {
        id: "my",
        label: "my",
        xLabel: "Time",
        xUnit: "s",
        yLabel: "my",
        yUnit: "dimensionless",
        points: [
          { x: 0, y: 0 },
          { x: 1e-9, y: 0.02 },
          { x: 2e-9, y: 0 }
        ]
      },
      {
        id: "mz",
        label: "mz",
        xLabel: "Time",
        xUnit: "s",
        yLabel: "mz",
        yUnit: "dimensionless",
        points: [
          { x: 0, y: -0.95 },
          { x: 1e-9, y: 0.1 },
          { x: 2e-9, y: 0.92 }
        ]
      }
    ],
    metrics: [
      { id: "final-mx", label: "final mx", displayValue: "0.05", unit: "dimensionless", note: "" },
      { id: "final-my", label: "final my", displayValue: "0", unit: "dimensionless", note: "" },
      { id: "final-mz", label: "final mz", displayValue: "0.92", unit: "dimensionless", note: "" },
      { id: "raw-max-component-delta", label: "delta", displayValue: "0.12", unit: "dimensionless", note: "" },
      { id: "ovf-frame-count", label: "frames", displayValue: "11", unit: "dimensionless", note: "" },
      {
        id: "final-pinned-alignment",
        label: "align",
        displayValue: "0.92",
        unit: "dimensionless",
        note: "P/AP threshold is ±0.8."
      },
      {
        id: "final-alignment-state",
        label: "state",
        displayValue: "P",
        unit: "dimensionless",
        note: ""
      },
      {
        id: "switching-occurred",
        label: "switching",
        displayValue: "yes",
        unit: "dimensionless",
        note: ""
      }
    ],
    provenance: {
      createdAt: "2026-08-16T00:00:00.000Z",
      createdBy: "test",
      solver: "mumax3",
      solverVersion: "mumax3 3.10 test",
      notes: []
    },
    artifacts: {
      frames: Array.from({ length: 11 }, (_, index) => ({
        id: `f${index}`,
        path: `outputs/m${String(index).padStart(6, "0")}.ovf`,
        label: `m${String(index).padStart(6, "0")}.ovf`,
        index,
        bytes: 128,
        format: "ovf",
        metadata: { time: index * 2e-10, xnodes: 4, ynodes: 2, znodes: 1 }
      }))
    }
  };
}

/**
 * @param {import("../lib/types").SimulationResult} result
 */
function boardModelFrom(result) {
  return buildScientificBoardModel({
    result,
    magnetization: {
      mx: result.series[0],
      my: result.series[1],
      mz: result.series[2]
    }
  });
}

describe("scientific board model", () => {
  it("selects six raw snapshot indices without inventing frames", () => {
    assert.deepEqual(selectSnapshotIndices(11), [0, 1, 2, 4, 6, 10]);
    assert.deepEqual(selectSnapshotIndices(1), [0]);
    assert.deepEqual(selectSnapshotIndices(0), []);
  });

  it("builds snapshot slots from attached OVF frames only", () => {
    const result = mumaxResultFixture();
    const slots = buildSnapshotSlots(result.artifacts.frames, { mzSeries: result.series[2] });
    assert.equal(slots.length, 6);
    assert.equal(slots[0].arrayIndex, 0);
    assert.equal(slots.at(-1)?.arrayIndex, 10);
    assert.match(slots[0].caption, /t =/);
  });

  it("uses actual parsed mz series for the magnetization trace model", () => {
    const result = mumaxResultFixture();
    const model = boardModelFrom(result);
    assert.equal(model.hasMagnetizationTrace, true);
    assert.equal(model.magnetization.mz?.points.length, 3);
    assert.equal(model.magnetization.mz?.points[0].y, -0.95);
    assert.equal(model.magnetization.mz?.points.at(-1)?.y, 0.92);
  });

  it("shows empty sweep state without fabricating curves", () => {
    const sweep = buildSweepBoardModel(mumaxResultFixture());
    assert.equal(sweep.available, false);
    assert.equal(sweep.message, "No sweep data yet.");
    assert.equal(sweep.series.length, 0);
  });

  it("does not treat ordinary mx/my/mz series as sweep curves", () => {
    const result = mumaxResultFixture();
    result.series.push({
      id: "extra-metric",
      label: "random metric",
      xLabel: "x",
      xUnit: "1",
      yLabel: "y",
      yUnit: "1",
      points: [
        { x: 0, y: 1 },
        { x: 1, y: 2 }
      ]
    });
    const sweep = buildSweepBoardModel(result);
    assert.equal(sweep.available, false);
    assert.equal(sweep.series.length, 0);
  });

  it("keeps diagnostics honest for switching outcome", () => {
    const diagnostics = buildDynamicsDiagnostics(mumaxResultFixture());
    assert.equal(diagnostics.switchingOutcome, "success");
    assert.equal(diagnostics.finalState, "P");
    assert.equal(diagnostics.switchingThreshold, 0.8);
  });
});

describe("scientific board render", () => {
  it("renders snapshot panel placeholders for completed MuMax3 frames", async () => {
    await withFakeDom(() => {
      const host = new FakeNode("div");
      const model = boardModelFrom(mumaxResultFixture());
      const board = new ScientificBoardController({
        root: /** @type {any} */ (new FakeNode("section")),
        jobId: null
      });
      board.renderSnapshotPlaceholders(/** @type {any} */ (host), model);
      const slots = host.querySelectorAll("[data-snapshot-slot]");
      assert.ok(slots.length >= 3);
      assert.equal(slots[0].getAttribute("data-snapshot-slot"), "0");
      assert.match(host.innerHTML, /data-snapshot-slot="0"/);
      assert.match(host.innerHTML, /t =/);
    });
  });

  it("plots mean m_z from actual parsed series points", async () => {
    await withFakeDom(() => {
      const host = new FakeNode("div");
      const model = boardModelFrom(mumaxResultFixture());
      renderTracePanel(/** @type {any} */ (host), model);
      assert.match(host.innerHTML, /data-series="mz"/);
      assert.match(host.innerHTML, /data-board-trace-plot="true"/);
      assert.match(host.innerHTML, /Mean magnetization versus time|mean m/);
      assert.match(host.innerHTML, /final state: <strong>P<\/strong>/);
      assert.match(host.innerHTML, /<path d="M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+"/);
    });
  });

  it("shows empty sweep board and never draws fake sweep curves", async () => {
    await withFakeDom(() => {
      const host = new FakeNode("div");
      const model = boardModelFrom(mumaxResultFixture());
      renderSweepPanel(/** @type {any} */ (host), model);
      assert.match(host.innerHTML, /No sweep data yet/);
      assert.match(host.innerHTML, /No fabricated curves are drawn/);
      assert.doesNotMatch(host.innerHTML, /<path d="M/);
      assert.match(host.innerHTML, /data-board-empty="sweep"/);
    });
  });

  it("renders transport as UNAVAILABLE without decorative waves", async () => {
    await withFakeDom(() => {
      const host = new FakeNode("div");
      const result = mumaxResultFixture();
      const tunneling = buildQuantumTransportView({
        result,
        analyticalParams: {
          barrierThicknessNm: 1,
          barrierHeightEv: 1.2,
          electronEnergyEv: 0.25,
          effectiveMassRatio: 0.4,
          biasVolts: 0,
          temperatureK: 300,
          cellAreaNm2: 3200,
          spinState: /** @type {0 | 1} */ (0),
          spinPolarization: 0.4
        }
      });
      const model = buildScientificBoardModel({
        result,
        magnetization: { mz: result.series[2] },
        tunneling
      });
      assert.equal(model.tunneling, null);
      renderQuantumPanel(/** @type {any} */ (host), model);
      assert.match(host.innerHTML, /data-transport-unavailable="true"/);
      assert.match(host.innerHTML, /UNAVAILABLE/);
      assert.doesNotMatch(host.innerHTML, /data-spin-layer/);
      assert.doesNotMatch(host.innerHTML, /data-spin-arrow|class="[^"]*spin-arrow/);
      assert.doesNotMatch(host.innerHTML, /<path d="M/);
    });
  });

  it("renders snapshot maps from raw OVF vectors", async () => {
    await withFakeDom(() => {
      const svg = new FakeNode("svg");
      renderSnapshotMap(
        /** @type {any} */ (svg),
        {
          path: "outputs/m000000.ovf",
          label: "m000000.ovf",
          index: 0,
          bytes: 64,
          format: "ovf",
          metadata: { xnodes: 2, ynodes: 1, znodes: 1 },
          warnings: [],
          vectors: [
            { index: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: -1, magnitude: 1 },
            { index: 1, x: 1, y: 0, z: 0, mx: 0.2, my: 0, mz: 1, magnitude: 1 }
          ]
        },
        { caption: "frame 0" }
      );
      assert.match(svg.getAttribute("aria-label") ?? "", /MuMax3 OVF snapshot/);
      assert.ok(svg.children.some((child) => child.getAttribute("data-source") === "mumax3-ovf"));
      assert.equal(
        svg.all().filter((node) => node.attributes.get("data-magnetization-arrow") === "true").length,
        2
      );
    });
  });

  it("keeps the scientific board collapsed by default", () => {
    assert.equal(DEFAULT_SCIENTIFIC_BOARD_OPEN, false);
  });
});
