import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { overlaySeriesPaths, seriesToPath } from "../lib/charts.js";
import { buildFramePlaybackView, formatFrameMetadata } from "../lib/frameView.js";
import {
  extractProvenanceFields,
  metricIsHeuristic,
  partitionMetrics,
  resolveDisplayedRunModelLabel,
  resolveRunModelLabel,
  runModelBannerCopy,
  splitMagnetizationSeries
} from "../lib/resultView.js";
import { createDefaultState } from "../lib/defaults.js";

describe("resultView model labels", () => {
  it("distinguishes demo, smoke, and SpinVault MTJ v0", () => {
    const state = createDefaultState();
    assert.equal(resolveRunModelLabel(state), "spinvault_mtj_free_layer_switching_v1");
    state.solverTarget = "demo";
    assert.equal(resolveRunModelLabel(state), "demo");
    state.solverTarget = "mumax3";
    state.solverDrafts.mumax3.modelKind = "smoke";
    assert.equal(resolveRunModelLabel(state), "mumax3_smoke");
    assert.match(runModelBannerCopy(state).title, /smoke/i);
    state.solverDrafts.mumax3.modelKind = "spinvault_mtj_free_layer_v0";
    assert.equal(resolveRunModelLabel(state), "spinvault_mtj_free_layer_v0");
    assert.match(runModelBannerCopy(state).note, /not calibrated/i);
    assert.doesNotMatch(runModelBannerCopy(state).note, /calibrated digital twin/i);
    state.solverDrafts.mumax3.modelKind = "spinvault_mtj_free_layer_v0_visible";
    assert.equal(resolveRunModelLabel(state), "spinvault_mtj_free_layer_v0_visible");
    assert.match(runModelBannerCopy(state).note, /raw MuMax3 playback/i);
    assert.match(runModelBannerCopy(state).note, /not experimentally validated/i);
  });

  it("labels completed results from job/result even if editor selection changes", () => {
    const state = createDefaultState();
    state.solverTarget = "mumax3";
    state.solverDrafts.mumax3.modelKind = "smoke";
    const result = {
      source: "mumax3",
      isPhysicalSimulation: Boolean(1),
      summary: "ok",
      series: [],
      metrics: [
        {
          id: "model-kind",
          label: "Model kind",
          displayValue: "spinvault_mtj_free_layer_v0",
          unit: "dimensionless",
          note: "Request modelKind used for script generation."
        }
      ],
      provenance: {
        createdAt: "2026-08-15T00:00:00.000Z",
        createdBy: "system",
        solver: "mumax3",
        notes: ["modelKind=spinvault_mtj_free_layer_v0"]
      }
    };
    assert.equal(resolveDisplayedRunModelLabel(state, null, result), "spinvault_mtj_free_layer_v0");
    assert.match(runModelBannerCopy(state, null, result).title, /free-layer v0/i);
  });

  it("features backend metrics without inventing TMR", () => {
    const { featured, rest } = partitionMetrics([
      {
        id: "acceleration",
        label: "Run acceleration label",
        displayValue: "rtx",
        unit: "dimensionless",
        note: "from logs"
      },
      {
        id: "final-mx",
        label: "Final mx",
        displayValue: "0.1",
        unit: "dimensionless",
        note: "Last parsed table sample only."
      },
      {
        id: "ovf-frame-count",
        label: "OVF frames",
        displayValue: "53",
        unit: "count",
        note: "Raw solver frame files archived."
      },
      {
        id: "m-state-heuristic",
        label: "Magnetization state heuristic",
        displayValue: "out_of_plane_positive_z",
        unit: "dimensionless",
        note: "Not validated. Not a switching-success, TMR, or retention claim."
      },
      {
        id: "other",
        label: "Other",
        displayValue: "1",
        unit: "dimensionless",
        note: "x"
      }
    ]);
    assert.equal(featured[0].id, "acceleration");
    assert.ok(featured.some((metric) => metric.id === "final-mx"));
    assert.ok(featured.some((metric) => metric.id === "ovf-frame-count"));
    assert.ok(featured.some((metric) => metric.id === "m-state-heuristic"));
    assert.equal(rest.length, 1);
    assert.equal(metricIsHeuristic(featured.find((metric) => metric.id === "m-state-heuristic")), true);
  });

  it("extracts provenance fields from notes and job metadata", () => {
    const fields = extractProvenanceFields(
      {
        jobId: "job_1",
        scenarioId: "s",
        title: "t",
        requestedSolver: "mumax3",
        status: "complete",
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
        workerId: "worker-ata-1",
        gpu: {
          gpuAvailable: true,
          acceleration: "host_gpu_available",
          details: "host"
        },
        errors: [],
        warnings: [],
        provenance: {
          createdAt: "2026-08-15T00:00:00.000Z",
          createdBy: "system",
          solver: "mumax3",
          notes: ["modelKind=spinvault_mtj_free_layer_v0", "script_hash=abc"]
        }
      },
      {
        source: "mumax3",
        isPhysicalSimulation: Boolean(1),
        summary: "ok",
        series: [],
        metrics: [],
        provenance: {
          createdAt: "2026-08-15T00:00:00.000Z",
          createdBy: "system",
          solver: "mumax3",
          notes: ["request_hash=req", "run_acceleration=rtx", "artifacts_dir=/tmp/job"]
        }
      }
    );
    assert.equal(fields.modelKind, "spinvault_mtj_free_layer_v0");
    assert.equal(fields.worker_id, "worker-ata-1");
    assert.equal(fields.run_acceleration, "rtx");
    assert.equal(fields.request_hash, "req");
    assert.equal(fields.script_hash, "abc");
  });
});

describe("charts and magnetization split", () => {
  it("builds overlay paths for mx/my/mz only from provided points", () => {
    const series = [
      {
        id: "mx",
        label: "mx (raw table)",
        xLabel: "time",
        xUnit: "s",
        yLabel: "mx (raw table)",
        yUnit: "dimensionless",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0.2 }
        ]
      },
      {
        id: "mz",
        label: "mz (raw table)",
        xLabel: "time",
        xUnit: "s",
        yLabel: "mz (raw table)",
        yUnit: "dimensionless",
        points: [
          { x: 0, y: 1 },
          { x: 1, y: 0.9 }
        ]
      },
      {
        id: "bx",
        label: "B_extx (unknown column)",
        xLabel: "time",
        xUnit: "s",
        yLabel: "B_extx (unknown column)",
        yUnit: "T",
        points: [
          { x: 0, y: 0.01 },
          { x: 1, y: 0.01 }
        ]
      }
    ];
    const { magnetization, other } = splitMagnetizationSeries(series);
    assert.ok(magnetization.mx);
    assert.ok(magnetization.mz);
    assert.equal(other.length, 1);
    const overlay = overlaySeriesPaths([magnetization.mx, magnetization.my, magnetization.mz]);
    assert.equal(overlay.empty, false);
    assert.equal(overlay.paths.length, 2);
    assert.ok(seriesToPath(series[0]).startsWith("M "));
  });
});

describe("OVF frame display", () => {
  it("shows only attached MuMax3 frame metadata", () => {
    const empty = buildFramePlaybackView(null);
    assert.equal(empty.available, false);
    assert.match(empty.message, /No OVF/);

    const view = buildFramePlaybackView({
      source: "mumax3",
      isPhysicalSimulation: Boolean(1),
      summary: "ok",
      series: [],
      metrics: [],
      provenance: {
        createdAt: "2026-08-15T00:00:00.000Z",
        createdBy: "system",
        solver: "mumax3"
      },
      artifacts: {
        frames: [
          {
            id: "frame-1",
            path: "outputs/m000001.ovf",
            label: "m000001.ovf",
            index: 1,
            bytes: 512,
            format: "ovf",
            metadata: { xnodes: 8, ynodes: 4, znodes: 1, cellCount: 32 }
          }
        ]
      }
    });
    assert.equal(view.available, true);
    assert.equal(view.frames[0].path, "outputs/m000001.ovf");
    assert.match(view.message, /raw MuMax3 OVF/);
    assert.match(view.message, /no fabricated spatial field/i);
    assert.doesNotMatch(view.message, /TMR|switching probability|endurance|retention/i);
    assert.equal(formatFrameMetadata(view.frames[0].metadata), "8 x 4 x 1; 32 cells");
  });

  it("does not invent frames when artifacts omit them", () => {
    const view = buildFramePlaybackView({
      source: "mumax3",
      isPhysicalSimulation: Boolean(1),
      summary: "ok",
      series: [],
      metrics: [],
      provenance: {
        createdAt: "2026-08-15T00:00:00.000Z",
        createdBy: "system",
        solver: "mumax3"
      },
      artifacts: { frames: [] }
    });
    assert.equal(view.available, false);
    assert.equal(view.frames.length, 0);
  });
});
