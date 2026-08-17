const params = new URLSearchParams(window.location.search);
const API_BASE = (params.get("api") || "http://127.0.0.1:8001").replace(/\/+$/, "");
const API = `${API_BASE}/api`;
const LAST_JOB_KEY = "spinvault-matplotlib-twin-last-job";

const form = document.querySelector("#mpt-form");
const runButton = document.querySelector("#mpt-run");
const cancelButton = document.querySelector("#mpt-cancel");
const statusPanel = document.querySelector(".mpt-status");
const statusLabel = document.querySelector("#mpt-status");
const progressLabel = document.querySelector("#mpt-progress");
const jobLabel = document.querySelector("#mpt-job");
const empty = document.querySelector("#mpt-empty");
const reportRoot = document.querySelector("#mpt-report");
const assetRoot = document.querySelector("#mpt-assets");
const summaryRoot = document.querySelector("#mpt-mesh-summary");
const honestyRoot = document.querySelector("#mpt-report-honesty");

let activeJobId = null;
let polling = false;

function quantity(value, unit, source = "user") {
  return { value, unit, source, citation: null };
}

function numberValue(id) {
  return Number(document.querySelector(id).value);
}

function requestPayload() {
  const transition = document.querySelector("#mpt-transition").value;
  const material = document.querySelector("#mpt-material").value;
  const shape = document.querySelector("#mpt-shape").value;
  const durationPs = numberValue("#mpt-duration");
  const currentLog = numberValue("#mpt-current");
  const pulseField = numberValue("#mpt-pulse-field");
  const temperatureK = numberValue("#mpt-temperature");
  const seed = numberValue("#mpt-seed");
  const lengthNm = numberValue("#mpt-length");
  const widthNm = numberValue("#mpt-width");
  const freeThicknessNm = numberValue("#mpt-free-thickness");
  const barrierThicknessNm = numberValue("#mpt-barrier-thickness");
  const msat = numberValue("#mpt-ms") * 1e6;
  const ku1 = numberValue("#mpt-ku") * 1e6;
  const aex = numberValue("#mpt-aex") * 1e-12;
  const alpha = numberValue("#mpt-alpha");
  const polarization = numberValue("#mpt-polarization");
  const durationNs = durationPs * 1e-3;
  const current = 10 ** currentLog;
  const towardP = transition !== "transition_1_to_0";
  const startsP = transition === "transition_1_to_0" || transition === "state_1_p";

  return {
    scenarioId: "matplotlib-python-micromagnetic",
    title: "NumPy + matplotlib Python micromagnetic Twin",
    requestedSolver: "python_micromagnetic",
    geometry: {
      freeLayerThickness: quantity(freeThicknessNm, "nm"),
      freeLayerLength: quantity(lengthNm, "nm"),
      freeLayerWidth: quantity(widthNm, "nm"),
      barrierThickness: quantity(barrierThicknessNm, "nm"),
      referenceLayerThickness: quantity(2.4, "nm", "preset"),
      cellShape: shape
    },
    materials: {
      freeLayerId: `${material}-unvalidated`,
      referenceLayerId: "cofeb-example",
      barrierId: "mgo-example"
    },
    controls: {
      mode: "time_domain",
      recordTimeline: true,
      pauseOnWarning: false,
      duration: quantity(durationNs, "ns"),
      temperature: quantity(temperatureK, "K"),
      currentDirection: towardP ? "positive_z" : "negative_z",
      selectedRegion: "free",
      viewportZoom: 1
    },
    torque: {
      mechanism: "stt",
      enabled: transition.startsWith("transition"),
      currentDensity: quantity(current, "A/m^2"),
      polarization: quantity(polarization, "dimensionless"),
      notes: "Signed Slonczewski STT integrated by the Python mesh LLGS solver."
    },
    initialMagnetization: {
      mode: "uniform",
      vector: { x: 0, y: 0, z: startsP ? 1 : -1 },
      seed,
      notes: "Uniform P/AP initial condition; spatial evolution is solved, not prescribed."
    },
    externalField: {
      x: quantity(0, "T", "preset"),
      y: quantity(0, "T", "preset"),
      z: quantity(0, "T", "preset")
    },
    solverDrafts: {
      mumax3: {
        modelKind: "spinvault_mtj_free_layer_switching_v1",
        meshCellSize: {
          x: quantity(lengthNm / 64, "nm"),
          y: quantity(widthNm / 32, "nm"),
          z: quantity(freeThicknessNm, "nm")
        },
        gridSize: { nx: 64, ny: 32, nz: 1 },
        saturationMagnetization: quantity(msat, "A/m"),
        exchangeStiffness: quantity(aex, "J/m"),
        dampingAlpha: quantity(alpha, "dimensionless"),
        anisotropyAxis: { x: 0, y: 0, z: 1 },
        anisotropyConstant: quantity(ku1, "J/m^3"),
        pinnedDirection: { x: 0, y: 0, z: 1 },
        statePreset: transition,
        fieldPulseAmplitude: quantity(pulseField, "T"),
        fieldPulseDuration: quantity(Math.min(2, Math.max(0.2, durationPs * 0.2)), "ps", "preset"),
        switchingThreshold: 0.8,
        externalField: null,
        currentDensity: quantity(current, "A/m^2"),
        simulationTime: quantity(durationNs, "ns"),
        timeStepHint: quantity(1, "ps", "preset"),
        sttLambda: quantity(1, "dimensionless", "preset"),
        fieldLikeRatio: quantity(0, "dimensionless", "preset")
      },
      kwant: {
        latticeModel: "placeholder_1d",
        hoppingEnergy: quantity(1, "eV", "unvalidated_default"),
        onsiteEnergy: quantity(0, "eV", "unvalidated_default"),
        spinOrbitCoupling: quantity(0, "eV", "unvalidated_default"),
        leadConfiguration: "two_terminal",
        temperature: quantity(temperatureK, "K")
      },
      surrogate: {
        connectionStatus: "not_connected",
        modelId: null,
        modelVersion: null,
        notes: "No surrogate is used."
      }
    },
    matplotlibReport: {
      barrierHeightEv: numberValue("#mpt-barrier-height"),
      effectiveMassRatio: numberValue("#mpt-effective-mass"),
      fermiEv: numberValue("#mpt-fermi"),
      readBiasVolts: numberValue("#mpt-read-bias"),
      retentionWindowYears: 10
    },
    provenance: {
      createdAt: new Date().toISOString(),
      createdBy: "user",
      solver: "none",
      solverVersion: null,
      inputHash: null,
      notes: [
        "Submitted by matplotlib-twin.html.",
        "Spatial panels must come only from returned python_micromagnetic mesh frames."
      ]
    }
  };
}

const MATERIAL_PRESETS = {
  "cofeb": { ms: 1.00, ku: 0.80, aex: 10, alpha: 0.010, polarization: 0.60 },
  "low-ms": { ms: 0.80, ku: 0.65, aex: 13, alpha: 0.015, polarization: 0.52 },
  "high-ku": { ms: 1.05, ku: 1.20, aex: 15, alpha: 0.020, polarization: 0.65 }
};

document.querySelector("#mpt-material").addEventListener("change", (event) => {
  const values = MATERIAL_PRESETS[event.target.value];
  if (!values) return;
  document.querySelector("#mpt-ms").value = values.ms;
  document.querySelector("#mpt-ku").value = values.ku;
  document.querySelector("#mpt-aex").value = values.aex;
  document.querySelector("#mpt-alpha").value = values.alpha;
  document.querySelector("#mpt-polarization").value = values.polarization;
});

for (const id of ["#mpt-ms", "#mpt-ku", "#mpt-aex", "#mpt-alpha", "#mpt-polarization"]) {
  document.querySelector(id).addEventListener("input", () => {
    document.querySelector("#mpt-material").value = "custom";
  });
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    const message = typeof detail === "string" ? detail : detail?.message || JSON.stringify(detail || body);
    throw new Error(message || `HTTP ${response.status}`);
  }
  return body;
}

function setState(state, label, progress = "") {
  statusPanel.dataset.state = state;
  statusLabel.textContent = label;
  progressLabel.textContent = progress;
  runButton.disabled = state === "running";
  cancelButton.hidden = state !== "running";
}

function errorText(job) {
  return (job.errors || []).map((item) => item.message).filter(Boolean).join(" · ");
}

function renderReport(jobId, report) {
  empty.hidden = true;
  reportRoot.hidden = false;
  honestyRoot.textContent = report.honesty;
  const mesh = report.mesh || {};
  const durationPs = ((report.timeRangeS?.[1] || 0) - (report.timeRangeS?.[0] || 0)) * 1e12;
  summaryRoot.innerHTML = [
    ["mesh", `${mesh.nx}×${mesh.ny}×${mesh.nz}`],
    ["frames", String(mesh.frames)],
    ["duration", `${durationPs.toFixed(3)} ps`],
    ["format", report.format]
  ]
    .map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`)
    .join("");

  assetRoot.innerHTML = "";
  for (const asset of report.assets || []) {
    const figure = document.createElement("figure");
    figure.className = "mpt-asset";
    const imageUrl = `${API}/simulations/${encodeURIComponent(jobId)}/matplotlib/${encodeURIComponent(asset.path)}`;
    figure.innerHTML = `
      <img src="${imageUrl}" alt="${asset.label}" loading="lazy" />
      <figcaption><strong>${asset.label}</strong><span>${asset.note}</span></figcaption>
    `;
    assetRoot.append(figure);
  }
}

async function loadReport(jobId) {
  const payload = await apiFetch(`/simulations/${encodeURIComponent(jobId)}/matplotlib`);
  renderReport(jobId, payload.report);
  setState("complete", "Complete", "NumPy trajectory and matplotlib report are ready.");
}

async function poll(jobId) {
  if (polling) return;
  polling = true;
  try {
    while (activeJobId === jobId) {
      const job = await apiFetch(`/simulations/${encodeURIComponent(jobId)}`);
      const phase = job.progressPhase || job.status;
      const notes = job.provenance?.notes || [];
      const progress = notes.findLast?.((note) => /python_micromagnetic \d+\/\d+/.test(note));
      setState("running", phase.replaceAll("_", " "), progress || "Queued on the local Python worker.");
      if (job.status === "complete") {
        await loadReport(jobId);
        return;
      }
      if (["failed", "cancelled", "not_configured"].includes(job.status)) {
        setState("failed", job.status, errorText(job) || "The job did not complete.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  } catch (error) {
    setState("failed", "Error", error instanceof Error ? error.message : String(error));
  } finally {
    polling = false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  reportRoot.hidden = true;
  empty.hidden = false;
  setState("running", "Submitting", "Validating the 64×32×1 local solver request.");
  try {
    const payload = await apiFetch("/simulations", {
      method: "POST",
      body: JSON.stringify(requestPayload())
    });
    activeJobId = payload.job.jobId;
    localStorage.setItem(LAST_JOB_KEY, activeJobId);
    jobLabel.textContent = activeJobId;
    poll(activeJobId);
  } catch (error) {
    setState("failed", "Submission failed", error instanceof Error ? error.message : String(error));
  }
});

cancelButton.addEventListener("click", async () => {
  if (!activeJobId) return;
  try {
    await apiFetch(`/simulations/${encodeURIComponent(activeJobId)}/cancel`, { method: "POST" });
    setState("failed", "Cancelled", "Cancellation requested.");
  } catch (error) {
    setState("failed", "Cancel failed", error instanceof Error ? error.message : String(error));
  }
});

async function restoreLastJob() {
  const jobId = params.get("job") || localStorage.getItem(LAST_JOB_KEY);
  if (!jobId) return;
  activeJobId = jobId;
  jobLabel.textContent = jobId;
  try {
    const job = await apiFetch(`/simulations/${encodeURIComponent(jobId)}`);
    if (job.status === "complete") {
      await loadReport(jobId);
    } else if (!["failed", "cancelled", "not_configured"].includes(job.status)) {
      poll(jobId);
    }
  } catch {
    localStorage.removeItem(LAST_JOB_KEY);
    activeJobId = null;
    jobLabel.textContent = "";
  }
}

restoreLastJob();
