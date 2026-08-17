import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildArtifactView, jobRecordToSimulationResponse } from "../../api/jobMapper.js";
import { createMockResult } from "../lib/mockResults.js";
import { createDefaultState } from "../lib/defaults.js";
import { resultsPanelMessage } from "../lib/statusCopy.js";

describe("demo vs physical labeling", () => {
  it("keeps demo fixture labels on mapped job results", () => {
    const result = createMockResult(createDefaultState());
    const response = jobRecordToSimulationResponse({
      jobId: "job_demo",
      scenarioId: "mtj",
      title: "t",
      requestedSolver: "demo",
      status: "complete",
      createdAt: result.provenance.createdAt,
      updatedAt: result.provenance.createdAt,
      errors: [],
      warnings: [],
      provenance: result.provenance,
      result
    });
    assert.equal(response.result?.source, "demo_fixture");
    assert.equal(response.result?.isPhysicalSimulation, false);
  });

  it("surfaces not_configured without inventing a result", () => {
    const response = jobRecordToSimulationResponse({
      jobId: "job_mx",
      scenarioId: "mtj",
      title: "t",
      requestedSolver: "mumax3",
      status: "not_configured",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      errors: [{ code: "solver_not_configured", message: "MuMax3 is not configured." }],
      warnings: [],
      provenance: {
        createdAt: "2026-08-14T00:00:00.000Z",
        createdBy: "system",
        solver: "mumax3",
        notes: ["MuMax3 adapter present but not configured."]
      },
      result: null
    });
    assert.equal(response.status, "not_configured");
    assert.equal(response.result, undefined);
    assert.equal(response.error?.code, "solver_not_configured");
    const artifacts = buildArtifactView({
      jobId: "job_mx",
      scenarioId: "mtj",
      title: "t",
      requestedSolver: "mumax3",
      status: "not_configured",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      errors: [{ code: "solver_not_configured", message: "MuMax3 is not configured." }],
      warnings: [],
      provenance: {
        createdAt: "2026-08-14T00:00:00.000Z",
        createdBy: "system",
        solver: "mumax3",
        notes: ["MuMax3 adapter present but not configured."]
      },
      result: null
    });
    assert.equal(artifacts.available, false);
    assert.match(artifacts.message, /not configured/i);
  });

  it("includes exact rejected field paths on failed job errors", () => {
    const response = jobRecordToSimulationResponse({
      jobId: "job_fail",
      scenarioId: "mtj",
      title: "t",
      requestedSolver: "mumax3",
      status: "failed",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      errors: [
        {
          code: "mumax3-anisotropy-constant-missing",
          field: "solverDrafts.mumax3.anisotropyConstant",
          message: "anisotropyConstant (Ku1) is required for switching_v1."
        }
      ],
      warnings: [],
      provenance: {
        createdAt: "2026-08-14T00:00:00.000Z",
        createdBy: "system",
        solver: "mumax3",
        notes: ["validation failed"]
      },
      result: null
    });
    assert.equal(response.error?.code, "demo_job_failed");
    assert.match(
      response.error?.message ?? "",
      /solverDrafts\.mumax3\.anisotropyConstant: anisotropyConstant \(Ku1\) is required/
    );
  });

  it("explains not_configured in the results panel", () => {
    const message = resultsPanelMessage({
      state: createDefaultState(),
      status: "not_configured",
      result: null,
      error: { code: "solver_not_configured", message: "MuMax3 is not configured on the backend." },
      logs: [],
      timeline: [],
      jobId: "job_mx",
      paused: false,
      lastJob: null
    });
    assert.equal(message?.kind, "warning");
    assert.match(message?.title ?? "", /not configured/i);
  });

  it("labels mumax artifacts with modelKind when present", () => {
    const artifacts = buildArtifactView({
      jobId: "job_v0",
      scenarioId: "mtj",
      title: "t",
      requestedSolver: "mumax3",
      status: "complete",
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      errors: [],
      warnings: [
        {
          code: "model_unvalidated",
          message: "SpinVault MTJ free-layer v0 is not calibrated or experimentally validated."
        }
      ],
      provenance: {
        createdAt: "2026-08-15T00:00:00.000Z",
        createdBy: "system",
        solver: "mumax3",
        notes: ["modelKind=spinvault_mtj_free_layer_v0"]
      },
      request: {
        scenarioId: "mtj",
        title: "t",
        geometry: /** @type {any} */ ({}),
        materials: /** @type {any} */ ({}),
        controls: /** @type {any} */ ({}),
        requestedSolver: "mumax3",
        solverDrafts: {
          mumax3: { modelKind: "spinvault_mtj_free_layer_v0" }
        }
      },
      result: {
        source: "mumax3",
        isPhysicalSimulation: Boolean(1),
        summary: "MuMax3 completed",
        series: [
          {
            id: "mx",
            label: "mx (raw table)",
            xLabel: "t",
            xUnit: "s",
            yLabel: "mx (raw table)",
            yUnit: "dimensionless",
            points: [
              { x: 0, y: 0 },
              { x: 1e-9, y: 0.1 }
            ]
          }
        ],
        metrics: [
          {
            id: "model-kind",
            label: "Model kind",
            displayValue: "spinvault_mtj_free_layer_v0",
            unit: "dimensionless",
            note: "Requested MuMax3 model."
          },
          {
            id: "final-mx",
            label: "Final mx",
            displayValue: "0.1",
            unit: "dimensionless",
            note: "Last parsed table sample only."
          }
        ],
        provenance: {
          createdAt: "2026-08-15T00:00:00.000Z",
          createdBy: "system",
          solver: "mumax3",
          solverVersion: "3.12",
          notes: ["modelKind=spinvault_mtj_free_layer_v0", "run_acceleration=rtx"]
        },
        artifacts: {
          scriptPreview: "SetGridSize(4,4,1)\n",
          stdout: "CUDA Device 0",
          stderr: "",
          manifest: {
            files: [
              { path: "generated.mx3", label: "generated.mx3" },
              { path: "table.txt", label: "table.txt" },
              { path: "stdout.log", label: "stdout.log" }
            ]
          }
        }
      }
    });
    assert.equal(artifacts.available, true);
    assert.match(artifacts.message, /spinvault_mtj_free_layer_v0/);
    assert.match(artifacts.message, /Not a calibrated/);
    assert.ok(artifacts.items.some((item) => item.id === "script"));
    assert.ok(artifacts.items.some((item) => item.id === "table-ref"));
    assert.ok(artifacts.items.some((item) => item.label.includes("generated.mx3")));
  });
});
