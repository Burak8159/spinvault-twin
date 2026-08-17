/**
 * Map backend JobRecord / result payloads into the Twin UI SimulationResponse shape.
 */

/**
 * Prefer exact rejected field paths when the backend supplies them.
 * @param {{ field?: string | null, message?: string | null } | null | undefined} entry
 * @param {string} fallback
 */
function formatJobErrorMessage(entry, fallback) {
  const message = entry?.message?.trim() || fallback;
  const field = entry?.field?.trim();
  return field ? `${field}: ${message}` : message;
}

/**
 * @param {import("../simulator/lib/types").JobRecord} job
 * @returns {import("../simulator/lib/types").SimulationResponse}
 */
export function jobRecordToSimulationResponse(job) {
  /** @type {import("../simulator/lib/types").SimulationError | undefined} */
  let error;
  if (job.status === "not_configured") {
    const first = job.errors?.[0];
    error = {
      code: "solver_not_configured",
      message: formatJobErrorMessage(
        first,
        `${job.requestedSolver} is not configured on the backend. No solver execution was performed.`
      )
    };
  } else if (job.status === "failed") {
    const first = job.errors?.[0];
    error = {
      code: first?.code === "validation_failed" || /valid/i.test(first?.code ?? "")
        ? "validation_failed"
        : "demo_job_failed",
      message: formatJobErrorMessage(first, "Backend job failed.")
    };
  } else if (job.status === "cancelled") {
    error = {
      code: "cancelled",
      message: "Backend job was cancelled."
    };
  }

  /** @type {import("../simulator/lib/types").SimulationResult | undefined} */
  let result;
  if (job.result) {
    result = {
      source: job.result.source,
      isPhysicalSimulation: Boolean(job.result.isPhysicalSimulation),
      executionGpu: job.gpu ?? null,
      summary: job.result.summary,
      series: job.result.series ?? [],
      metrics: job.result.metrics ?? [],
      provenance: job.result.provenance,
      artifacts: job.result.artifacts
    };
  }

  return {
    jobId: job.jobId,
    status: job.status,
    result,
    error,
    provenance: job.provenance,
    job,
    warnings: job.warnings ?? []
  };
}

/**
 * @param {unknown} manifest
 * @returns {string[]}
 */
function manifestPaths(manifest) {
  if (!manifest || typeof manifest !== "object") return [];
  const files = /** @type {{ files?: Array<{ path?: string, label?: string }> }} */ (manifest).files;
  if (!Array.isArray(files)) return [];
  return files
    .map((file) => file.path || file.label)
    .filter(/** @type {(value: string | undefined) => value is string} */ ((value) => typeof value === "string" && value.length > 0));
}

/**
 * Build a concise artifacts view model from a job (backend may not ship artifacts yet).
 *
 * @param {import("../simulator/lib/types").JobRecord | null | undefined} job
 * @returns {import("../simulator/lib/types").ArtifactView}
 */
export function buildArtifactView(job) {
  if (!job) {
    return {
      available: false,
      message: "No job yet. Submit a run to inspect backend artifacts.",
      items: []
    };
  }

  /** @type {import("../simulator/lib/types").ArtifactItem[]} */
  const items = [];
  const artifacts = job.result?.artifacts;
  const modelKind =
    job.request?.solverDrafts?.mumax3?.modelKind ||
    job.result?.metrics?.find((metric) => metric.id === "model-kind")?.displayValue ||
    null;

  if (artifacts?.scriptPreview) {
    items.push({
      id: "script",
      kind: "script",
      label: "generated.mx3 (script preview)",
      content: artifacts.scriptPreview,
      downloadName: `${job.jobId}-generated.mx3`
    });
  }
  if (artifacts?.stdout) {
    items.push({ id: "stdout", kind: "log", label: "stdout.log", content: artifacts.stdout });
  }
  if (artifacts?.stderr) {
    items.push({ id: "stderr", kind: "log", label: "stderr.log", content: artifacts.stderr });
  }
  if (artifacts?.manifest) {
    const paths = manifestPaths(artifacts.manifest);
    items.push({
      id: "manifest",
      kind: "manifest",
      label: "Artifact manifest (raw)",
      content: JSON.stringify(artifacts.manifest, null, 2)
    });
    if (paths.some((path) => /table\.txt$/i.test(path))) {
      items.push({
        id: "table-ref",
        kind: "manifest",
        label: "table.txt reference",
        content: paths.filter((path) => /table\.txt$/i.test(path)).join("\n")
      });
    }
    if (paths.some((path) => /references\.bib$/i.test(path))) {
      items.push({
        id: "bib-ref",
        kind: "manifest",
        label: "references.bib reference",
        content: paths.filter((path) => /references\.bib$/i.test(path)).join("\n")
      });
    }
  }
  if (Array.isArray(artifacts?.frames) && artifacts.frames.length) {
    items.push({
      id: "ovf-frames",
      kind: "frame",
      label: "OVF magnetization frames",
      content: JSON.stringify(artifacts.frames, null, 2),
      downloadName: `${job.jobId}-ovf-frames.json`
    });
  }
  if (job.result) {
    items.push({
      id: "result-json",
      kind: "json",
      label: "Result JSON",
      content: JSON.stringify(job.result, null, 2),
      downloadName: `${job.jobId}-result.json`
    });
  }
  items.push({
    id: "job-json",
    kind: "json",
    label: "Job record JSON",
    content: JSON.stringify(
      {
        jobId: job.jobId,
        status: job.status,
        requestedSolver: job.requestedSolver,
        modelKind,
        workerId: job.workerId ?? null,
        gpu: job.gpu ?? null,
        errors: job.errors,
        warnings: job.warnings,
        provenance: job.provenance,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      },
      null,
      2
    ),
    downloadName: `${job.jobId}-job.json`
  });

  if (job.status === "not_configured") {
    return {
      available: false,
      message:
        `${job.requestedSolver} is not configured. No MuMax3 script, stdout/stderr, or solver artifacts were generated.`,
      items,
      guidance:
        "Keep using Demo for fixture charts, or configure MUMAX3_BINARY on the API host for smoke / SpinVault MTJ v0 runs."
    };
  }

  if (!artifacts && job.status === "complete" && job.result?.source === "demo_fixture") {
    return {
      available: true,
      message: "Demo fixture result only. No MuMax3 artifacts are attached.",
      items
    };
  }

  if (!artifacts) {
    return {
      available: false,
      message: "No solver artifact bundle is attached to this job yet.",
      items
    };
  }

  return {
    available: true,
    message: modelKind
      ? `Raw solver artifacts for modelKind=${modelKind}. Not a calibrated result package.`
      : "Raw solver artifact bundle from the backend job.",
    items
  };
}
