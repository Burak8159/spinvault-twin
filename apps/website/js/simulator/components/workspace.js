import {
  cancelSimulation,
  getApiBaseUrl,
  getDemoExecutionMode,
  getOvfFrame,
  getSolversStatus,
  DEFAULT_API_URL,
  setApiBaseUrl,
  setDemoExecutionMode,
  submitSimulation
} from "../../api/client.js";
import { buildArtifactView } from "../../api/jobMapper.js";
import {
  MATERIAL_PRESETS,
  MUMAX_MODEL_KINDS,
  SCENARIO_PRESETS,
  SOLVER_TARGETS,
  applySwitchingV1Preset,
  applyVisibleDynamicsPreset,
  getMaterialPreset,
  getScenarioPreset,
  hydrateSavedState,
  stateFromPreset
} from "../lib/defaults.js";
import { SCIENTIFIC_FIELD_METADATA } from "../lib/fieldMetadata.js";
import { hasBlockingErrors } from "../lib/validation.js";
import { UNITS_BY_CATEGORY, parseNumericInput } from "../lib/units.js";
import { overlaySeriesPaths, seriesToPath } from "../lib/charts.js";
import { buildMagnetizationPlayback, formatPlaybackSample, shouldDisablePlaybackAutoplay } from "../lib/playback.js";
import { getPath, setPath, viewportSignature } from "../lib/paths.js";
import {
  BUSY_STATUSES,
  REMAINING_LIMITATIONS,
  STATUS_LABELS,
  resultsPanelMessage
} from "../lib/statusCopy.js";
import {
  extractProvenanceFields,
  metricIsHeuristic,
  partitionMetrics,
  resolveDisplayedRunModelLabel,
  runModelBannerCopy,
  splitMagnetizationSeries
} from "../lib/resultView.js";
import {
  renderOvfFrameErrorViewport,
  renderPlaybackVector
} from "./viewport.js";
import {
  claimMumax3FrameViewport,
  MuMax3FrameAnimator,
  shouldUseMumax3FrameAnimator,
  ovfFramesFromResult
} from "./mumax3FrameAnimator.js";
import {
  DEFAULT_SCIENTIFIC_BOARD_OPEN,
  ScientificBoardController,
  buildScientificBoardModel,
  renderSnapshotMap
} from "./scientificBoard.js";
import { TwinViewportController, mumaxPatchFromSpinControls } from "./twinViewport.js";

const STORAGE_KEY = "spinvault-twin-scenario-scientific-v1";
const LEGACY_STORAGE_KEYS = [
  "spinvault-twin-scenario-1c",
  "spinvault-twin-scenario-1a",
  "spinvault-twin-scenario-1b"
];
const SCENARIO_STORAGE_KEYS = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function requireEl(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

/**
 * @returns {string}
 */
function nowStamp() {
  return new Date().toISOString();
}

/**
 * @param {string} prefix
 */
function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

/**
 * @param {ReturnType<import("../lib/store").createSimulatorStore>} store
 */
export function mountSimulatorWorkspace(store) {
  const root = requireEl("sv-workspace");
  const svg = /** @type {SVGSVGElement} */ (/** @type {unknown} */ (requireEl("sv-viewport-svg")));
  const inspectReadout = document.getElementById("sv-inspect-readout");
  svg.addEventListener("pointermove", (event) => {
    if (!(inspectReadout instanceof HTMLElement)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest("[data-cell-vector], [data-in-plane-vector]");
    const title = cell?.getAttribute("title");
    if (!title) return;
    inspectReadout.hidden = false;
    inspectReadout.textContent = title;
  });
  const titleInput = /** @type {HTMLInputElement} */ (requireEl("sv-title"));
  const scenarioSelect = /** @type {HTMLSelectElement} */ (requireEl("sv-scenario"));
  const solverSelect = /** @type {HTMLSelectElement} */ (requireEl("sv-solver"));
  const mumaxModelSelect = /** @type {HTMLSelectElement} */ (requireEl("sv-mumax-model"));
  const mumaxModelNote = requireEl("sv-mumax-model-note");
  const shapeSelect = /** @type {HTMLSelectElement} */ (requireEl("sv-shape"));
  const freeMaterial = /** @type {HTMLSelectElement} */ (requireEl("sv-material-free"));
  const referenceMaterial = /** @type {HTMLSelectElement} */ (requireEl("sv-material-reference"));
  const barrierMaterial = /** @type {HTMLSelectElement} */ (requireEl("sv-material-barrier"));
  const materialDetails = requireEl("sv-material-details");
  const scenarioProvenance = requireEl("sv-scenario-provenance");
  const modeGroup = requireEl("sv-mode");
  const recordTimeline = /** @type {HTMLInputElement} */ (requireEl("sv-record-timeline"));
  const pauseOnWarning = /** @type {HTMLInputElement} */ (requireEl("sv-pause-warning"));
  const currentDirection = /** @type {HTMLSelectElement} */ (requireEl("sv-current-direction"));
  const selectedRegion = /** @type {HTMLSelectElement} */ (requireEl("sv-selected-region"));
  const statusLabel = requireEl("sv-status-label");
  const solverNote = requireEl("sv-solver-note");
  const validationList = requireEl("sv-validation-list");
  const resultsPanel = requireEl("sv-results-body");
  const mumaxPlaybackRoot = requireEl("sv-mumax-playback");
  const snapshotStrip = requireEl("sv-snapshot-strip");
  const logsPanel = requireEl("sv-logs-body");
  const artifactsPanel = requireEl("sv-artifacts-body");
  const provenancePanel = requireEl("sv-provenance-body");
  const timeline = requireEl("sv-timeline");
  const runButton = /** @type {HTMLButtonElement} */ (requireEl("sv-run"));
  const exitFullscreenButton = /** @type {HTMLButtonElement} */ (requireEl("sv-exit-fullscreen"));
  const pauseButton = /** @type {HTMLButtonElement} */ (requireEl("sv-pause"));
  const cancelButton = /** @type {HTMLButtonElement} */ (requireEl("sv-cancel"));
  const zoomValue = requireEl("sv-zoom-value");
  const settingsDialog = /** @type {HTMLDialogElement} */ (requireEl("sv-settings"));
  const apiUrlInput = /** @type {HTMLInputElement} */ (requireEl("sv-api-url"));
  const demoModeSelect = /** @type {HTMLSelectElement} */ (requireEl("sv-demo-mode"));
  const settingsStatus = requireEl("sv-settings-status");
  const banner = requireEl("sv-honesty-banner");
  const twinControlsRoot = requireEl("sv-twin-controls");
  const twinModeRoot = requireEl("sv-viewport-modes");
  const twinMetricsRoot = requireEl("sv-twin-metrics");
  const limitationsList = document.getElementById("sv-limitations");
  if (limitationsList) {
    limitationsList.replaceChildren(
      ...REMAINING_LIMITATIONS.map((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      })
    );
  }

  apiUrlInput.value = getApiBaseUrl();
  demoModeSelect.value = getDemoExecutionMode();

  /** @type {AbortController | null} */
  let jobController = null;
  let paused = false;
  /** @type {number | null} */
  let playbackFrame = null;
  /** @type {MuMax3FrameAnimator | null} */
  let frameAnimator = null;
  /** @type {ScientificBoardController | null} */
  let scientificBoard = null;
  let selectedOvfFrameIndex = 0;
  let snapshotStripJobId = "";
  let snapshotStripToken = 0;
  const twinViewport = new TwinViewportController({
    svg,
    controlsRoot: twinControlsRoot,
    modeRoot: twinModeRoot,
    metricsRoot: twinMetricsRoot,
    getState: () => store.get().state,
    getResult: () => store.get().result,
    canOwnViewport: (mode) =>
      mode === "quantum_wave" || !shouldUseMumax3FrameAnimator(store.get().result),
    onControlsChange: (controls) => {
      const mumaxPatch = mumaxPatchFromSpinControls(controls);
      const currentMumax = store.get().state.solverDrafts.mumax3;
      const presetChanged =
        currentMumax.statePreset !== mumaxPatch.statePreset ||
        currentMumax.modelKind !== mumaxPatch.modelKind;
      const writeCurrent = 10 ** (Number(controls.currentDensityLog10) || 0);
      store.updateState((state) => ({
        ...state,
        solverTarget: "python_micromagnetic",
        controls: {
          ...state.controls,
          temperature: {
            value: Number(controls.temperature) || 0,
            unit: "K",
            source: "user"
          }
        },
        geometry: {
          ...state.geometry,
          barrierThickness: {
            ...state.geometry.barrierThickness,
            value: Number(controls.barrierThicknessNm) || state.geometry.barrierThickness.value,
            unit: "nm",
            source: "user"
          }
        },
        torque: {
          ...state.torque,
          mechanism: "stt",
          enabled: true,
          currentDensity: {
            value: writeCurrent,
            unit: "A/m^2",
            source: "user"
          },
          polarization: {
            value: Number(controls.spinPolarization) || 0,
            unit: "dimensionless",
            source: "user"
          }
        },
        solverDrafts: {
          ...state.solverDrafts,
          mumax3: {
            ...state.solverDrafts.mumax3,
            ...mumaxPatch
          }
        }
      }));
      solverSelect.value = "python_micromagnetic";
      mumaxModelSelect.value = mumaxPatch.modelKind;
      root.dataset.mumaxModelKind = mumaxPatch.modelKind;
      root.dataset.mumaxStatePreset = mumaxPatch.statePreset;
      if (presetChanged) {
        log(
          "info",
          `Spin control configured Python LLGS statePreset=${mumaxPatch.statePreset}.`
        );
      }
    },
    onRunRequested: () => {
      if (!runButton.disabled) runButton.click();
    },
    onViewModeChange: (mode) => {
      if (mode === "quantum_wave") {
        frameAnimator?.pause();
        return;
      }
      if (!shouldUseMumax3FrameAnimator(store.get().result)) return;
      const frames = ovfFramesFromResult(store.get().result);
      claimMumax3FrameViewport(
        svg,
        frames[selectedOvfFrameIndex] ?? frames[0] ?? null,
        store.get().state.geometry
      );
      frameAnimator?.showSelected();
    },
    onVariantChange: () => {
      if (!shouldUseMumax3FrameAnimator(store.get().result)) return;
      if (twinViewport.controls.viewMode !== "particle_spin") return;
      frameAnimator?.showSelected();
    }
  });
  twinViewport.mount();

  const stageRoot = requireEl("sv-device");
  // Safari still ships the prefixed Fullscreen API, which the DOM lib does not type.
  const fullscreenDoc = /** @type {any} */ (document);
  const fullscreenStage = /** @type {any} */ (stageRoot);

  function nativeFullscreenElement() {
    return fullscreenDoc.fullscreenElement ?? fullscreenDoc.webkitFullscreenElement ?? null;
  }

  function refreshSimLayout() {
    twinViewport.render();
  }

  /** @param {boolean} active */
  function setSimFullscreenUi(active) {
    root.dataset.simFullscreen = active ? "true" : "false";
    exitFullscreenButton.hidden = !active;
    refreshSimLayout();
  }

  async function enterSimFullscreen() {
    setSimFullscreenUi(true);
    const request =
      fullscreenStage.requestFullscreen?.bind(stageRoot) ??
      fullscreenStage.webkitRequestFullscreen?.bind(stageRoot);
    if (!request) return;
    try {
      await request();
    } catch {
      /* Browser may deny Fullscreen API outside a user gesture; CSS theater mode still fills the workspace. */
    }
    refreshSimLayout();
  }

  async function exitSimFullscreen() {
    setSimFullscreenUi(false);
    if (nativeFullscreenElement() === stageRoot) {
      const exit =
        fullscreenDoc.exitFullscreen?.bind(document) ?? fullscreenDoc.webkitExitFullscreen?.bind(document);
      try {
        await exit?.();
      } catch {
        /* Ignore if the document is already out of native fullscreen. */
      }
    }
    refreshSimLayout();
  }

  for (const eventName of ["fullscreenchange", "webkitfullscreenchange"]) {
    document.addEventListener(eventName, () => {
      if (!nativeFullscreenElement() && root.dataset.simFullscreen === "true") {
        setSimFullscreenUi(false);
      }
    });
  }
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || root.dataset.simFullscreen !== "true") return;
    event.preventDefault();
    void exitSimFullscreen();
  });
  exitFullscreenButton.addEventListener("click", () => {
    void exitSimFullscreen();
  });

  /** @type {Array<[string, string, import("../lib/types").UnitCategory]>} */
  const quantityBindings = [
    ["sv-free-thickness", "geometry.freeLayerThickness", "length"],
    ["sv-free-length", "geometry.freeLayerLength", "length"],
    ["sv-free-width", "geometry.freeLayerWidth", "length"],
    ["sv-barrier-thickness", "geometry.barrierThickness", "length"],
    ["sv-reference-thickness", "geometry.referenceLayerThickness", "length"],
    ["sv-duration", "controls.duration", "time"],
    ["sv-temperature", "controls.temperature", "temperature"],
    ["sv-current-density", "torque.currentDensity", "currentDensity"],
    ["sv-torque-polarization", "torque.polarization", "dimensionless"],
    ["sv-msat", "solverDrafts.mumax3.saturationMagnetization", "magnetization"],
    ["sv-exchange", "solverDrafts.mumax3.exchangeStiffness", "exchange"],
    ["sv-damping", "solverDrafts.mumax3.dampingAlpha", "dimensionless"],
    ["sv-ku1", "solverDrafts.mumax3.anisotropyConstant", "anisotropy"],
    ["sv-pulse-amplitude", "solverDrafts.mumax3.fieldPulseAmplitude", "field"],
    ["sv-pulse-duration", "solverDrafts.mumax3.fieldPulseDuration", "time"],
    ["sv-hopping", "solverDrafts.kwant.hoppingEnergy", "energy"],
    ["sv-onsite", "solverDrafts.kwant.onsiteEnergy", "energy"],
    ["sv-soc", "solverDrafts.kwant.spinOrbitCoupling", "energy"]
  ];

  /**
   * @param {HTMLSelectElement} select
   * @param {Array<{ value: string, label: string, note?: string }>} options
   * @param {string} [selected]
   */
  function fillSelect(select, options, selected) {
    select.replaceChildren(
      ...options.map((option) => {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        if (option.note) node.title = option.note;
        node.selected = option.value === selected;
        return node;
      })
    );
  }

  fillSelect(
    scenarioSelect,
    SCENARIO_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
    store.get().state.scenarioId
  );
  fillSelect(
    solverSelect,
    Object.entries(SOLVER_TARGETS)
      .filter(([value]) => value === "python_micromagnetic" || value === "python_llg" || value === "demo")
      .map(([value, meta]) => ({
        value,
        label: meta.label,
        note: meta.note
      })),
    store.get().state.solverTarget
  );

  const magneticOptions = MATERIAL_PRESETS.filter((preset) => preset.layerRole === "magnetic").map((preset) => ({
    value: preset.id,
    label: `${preset.label} · ${preset.presetStatus.replaceAll("_", " ")}`
  }));
  const barrierOptions = MATERIAL_PRESETS.filter((preset) => preset.layerRole === "barrier").map((preset) => ({
    value: preset.id,
    label: `${preset.label} · ${preset.presetStatus.replaceAll("_", " ")}`
  }));
  fillSelect(freeMaterial, [{ value: "", label: "Select material" }, ...magneticOptions], store.get().state.materials.freeLayerId);
  fillSelect(referenceMaterial, [{ value: "", label: "Select material" }, ...magneticOptions], store.get().state.materials.referenceLayerId);
  fillSelect(barrierMaterial, [{ value: "", label: "Select material" }, ...barrierOptions], store.get().state.materials.barrierId);

  for (const [inputId, _path, category] of quantityBindings) {
    const unitSelect = /** @type {HTMLSelectElement} */ (requireEl(`${inputId}-unit`));
    fillSelect(
      unitSelect,
      UNITS_BY_CATEGORY[/** @type {import("../lib/types").UnitCategory} */ (category)].map((unit) => ({
        value: unit,
        label: unit
      })),
      ""
    );
  }

  for (const [key, metadata] of Object.entries(SCIENTIFIC_FIELD_METADATA)) {
    root.querySelectorAll(`[id*="${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}"]`).forEach((node) => {
      if (node instanceof HTMLElement && !node.title) node.title = metadata.help;
    });
  }

  /**
   * @param {import("../lib/types").LogEntry["level"]} level
   * @param {string} message
   */
  function log(level, message) {
    store.appendLog({ id: uid("log"), at: nowStamp(), level, message });
  }

  /**
   * @param {import("../lib/types").SimulationStatus} status
   */
  function markTimeline(status) {
    const solver = store.get().state.solverTarget;
    store.appendTimeline({
      id: uid("tl"),
      status,
      at: nowStamp(),
      label: STATUS_LABELS[status] ?? status,
      connected: solver !== "demo" || getDemoExecutionMode() === "backend"
    });
  }

  /**
   * @param {HTMLElement} field
   * @param {string | null} message
   */
  function setFieldError(field, message) {
    const control = field.querySelector("input, select, textarea");
    const existing = field.querySelector(".sv-field-error");
    /** @type {HTMLElement} */
    let error;
    if (existing instanceof HTMLElement) {
      error = existing;
    } else {
      error = document.createElement("p");
      error.className = "sv-field-error";
      field.append(error);
    }
    if (!error.id) {
      error.id = `${field.dataset.field?.replaceAll(".", "-") || "sv-field"}-error`;
    }
    if (control instanceof HTMLElement) {
      control.setAttribute("aria-invalid", message ? "true" : "false");
      const describedBy = new Set((control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      describedBy.add(error.id);
      control.setAttribute("aria-describedby", Array.from(describedBy).join(" "));
    }
    error.hidden = !message;
    error.textContent = message ?? "";
  }

  /**
   * @param {import("../lib/types").WorkspaceSnapshot} snapshot
   */
  function syncForm(snapshot) {
    const { state } = snapshot;
    if (document.activeElement !== titleInput) titleInput.value = state.title;
    scenarioSelect.value = state.scenarioId;
    solverSelect.value = state.solverTarget;
    mumaxModelSelect.value = state.solverDrafts.mumax3.modelKind || "smoke";
    const modelMeta = MUMAX_MODEL_KINDS[/** @type {keyof typeof MUMAX_MODEL_KINDS} */ (mumaxModelSelect.value)];
    mumaxModelNote.textContent = modelMeta?.note ?? mumaxModelNote.textContent;
    shapeSelect.value = state.geometry.cellShape;
    freeMaterial.value = state.materials.freeLayerId;
    referenceMaterial.value = state.materials.referenceLayerId;
    barrierMaterial.value = state.materials.barrierId;
    /** @type {HTMLSelectElement} */ (requireEl("sv-torque-mechanism")).value = state.torque.mechanism;
    /** @type {HTMLInputElement} */ (requireEl("sv-torque-enabled")).checked = state.torque.enabled;
    /** @type {HTMLSelectElement} */ (requireEl("sv-initial-mode")).value = state.initialMagnetization.mode;
    /** @type {HTMLInputElement} */ (requireEl("sv-initial-seed")).value = String(state.initialMagnetization.seed ?? "");
    /** @type {HTMLSelectElement} */ (requireEl("sv-kwant-lattice")).value = state.solverDrafts.kwant.latticeModel;
    /** @type {HTMLSelectElement} */ (requireEl("sv-kwant-leads")).value = state.solverDrafts.kwant.leadConfiguration ?? "two_terminal";
    recordTimeline.checked = state.controls.recordTimeline;
    pauseOnWarning.checked = state.controls.pauseOnWarning;
    currentDirection.value = state.controls.currentDirection;
    selectedRegion.value = state.controls.selectedRegion;
    zoomValue.textContent = `${state.controls.viewportZoom.toFixed(2)}×`;

    modeGroup.querySelectorAll("[data-mode]").forEach((button) => {
      const active = button.getAttribute("data-mode") === state.controls.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    for (const [inputId, path] of quantityBindings) {
      const quantity = /** @type {import("../lib/types").Quantity | undefined} */ (getPath(state, path));
      if (!quantity) continue;
      const input = /** @type {HTMLInputElement} */ (requireEl(inputId));
      const unit = /** @type {HTMLSelectElement} */ (requireEl(`${inputId}-unit`));
      if (document.activeElement !== input) input.value = String(quantity.value);
      unit.value = quantity.unit;
    }

    const scalarBindings = {
      "sv-field-x": state.externalField.x.value,
      "sv-field-y": state.externalField.y.value,
      "sv-field-z": state.externalField.z.value,
      "sv-initial-x": state.initialMagnetization.vector?.x ?? 0,
      "sv-initial-y": state.initialMagnetization.vector?.y ?? 0,
      "sv-initial-z": state.initialMagnetization.vector?.z ?? 1,
      "sv-mesh-x": state.solverDrafts.mumax3.meshCellSize.x.value,
      "sv-mesh-y": state.solverDrafts.mumax3.meshCellSize.y.value,
      "sv-mesh-z": state.solverDrafts.mumax3.meshCellSize.z.value,
      "sv-axis-x": state.solverDrafts.mumax3.anisotropyAxis?.x ?? 0,
      "sv-axis-y": state.solverDrafts.mumax3.anisotropyAxis?.y ?? 0,
      "sv-axis-z": state.solverDrafts.mumax3.anisotropyAxis?.z ?? 1,
      "sv-switching-threshold": state.solverDrafts.mumax3.switchingThreshold ?? 0.8
    };
    for (const [id, value] of Object.entries(scalarBindings)) {
      const input = /** @type {HTMLInputElement} */ (requireEl(id));
      if (document.activeElement !== input) input.value = String(value);
    }

    const selectedMaterials = [
      ["Free", getMaterialPreset(state.materials.freeLayerId)],
      ["Reference", getMaterialPreset(state.materials.referenceLayerId)],
      ["Barrier", getMaterialPreset(state.materials.barrierId)]
    ];
    materialDetails.innerHTML = selectedMaterials.map(([role, preset]) => {
      if (!preset || typeof preset === "string") return `<span><strong>${role}:</strong> unselected</span>`;
      const scientific = preset.layerRole === "magnetic"
        ? `Ms ${preset.saturationMagnetization?.value ?? "n/a"} ${preset.saturationMagnetization?.unit ?? ""}; Aex ${preset.exchangeStiffness?.value ?? "n/a"} ${preset.exchangeStiffness?.unit ?? ""}; α ${preset.dampingAlpha?.value ?? "n/a"}`
        : "No transport constants asserted";
      return `<span><strong>${role}:</strong> ${preset.label} · ${preset.presetStatus}<br>${scientific}</span>`;
    }).join("");
    scenarioProvenance.innerHTML = `
      <span><strong>Created by:</strong> ${state.provenance.createdBy}</span>
      <span><strong>Solver:</strong> ${state.provenance.solver}</span>
      <span><strong>Review notes:</strong> ${(state.provenance.notes ?? []).join(" · ") || "none"}</span>
    `;

    const errorByField = Object.fromEntries(
      state.validation.filter((issue) => issue.severity === "error").map((issue) => [issue.field, issue.message])
    );
    root.querySelectorAll("[data-field]").forEach((node) => {
      if (node instanceof HTMLElement) {
        setFieldError(node, errorByField[node.dataset.field ?? ""] ?? null);
      }
    });
  }

  /**
   * @param {ReturnType<typeof buildMagnetizationPlayback>} playback
   */
  function bindPlayback(playback, viewportOwnedByFrameAnimator = false) {
    const slider = resultsPanel.querySelector("[data-playback-slider]");
    const toggle = resultsPanel.querySelector("[data-playback-toggle]");
    const current = resultsPanel.querySelector("[data-playback-current]");
    if (!(slider instanceof HTMLInputElement) || !(toggle instanceof HTMLButtonElement) || !current) {
      if (!viewportOwnedByFrameAnimator) renderPlaybackVector(svg, null);
      return;
    }
    let playing = false;
    let lastAdvance = 0;
    /** @param {number} index */
    const show = (index) => {
      const sample = playback.samples[index];
      if (!sample) return;
      slider.value = String(index);
      const formatted = formatPlaybackSample(sample);
      current.innerHTML = `<strong>${formatted.time}</strong><span>mx ${formatted.mx}</span><span>my ${formatted.my}</span><span>mz ${formatted.mz}</span>`;
      if (!viewportOwnedByFrameAnimator) renderPlaybackVector(svg, sample);
    };
    const stop = () => {
      playing = false;
      toggle.textContent = "Play";
      toggle.setAttribute("aria-pressed", "false");
      if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
      playbackFrame = null;
    };
    /** @param {number} stamp */
    const tick = (stamp) => {
      if (!playing) return;
      if (stamp - lastAdvance >= 80) {
        lastAdvance = stamp;
        const next = Number(slider.value) + 1;
        if (next >= playback.samples.length) {
          stop();
          return;
        }
        show(next);
      }
      if (playing) playbackFrame = requestAnimationFrame(tick);
    };
    const reduceMotion = shouldDisablePlaybackAutoplay(
      typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null
    );
    if (reduceMotion) {
      toggle.hidden = true;
      toggle.disabled = true;
      toggle.title = "Autoplay disabled when reduced motion is preferred. Use the slider.";
    }
    slider.addEventListener("input", () => {
      stop();
      show(Number(slider.value));
    });
    toggle.addEventListener("click", () => {
      if (reduceMotion) return;
      if (playing) {
        stop();
        return;
      }
      if (Number(slider.value) >= playback.samples.length - 1) show(0);
      playing = true;
      toggle.textContent = "Pause";
      toggle.setAttribute("aria-pressed", "true");
      lastAdvance = performance.now();
      playbackFrame = requestAnimationFrame(tick);
    });
    show(0);
  }

  /**
   * Compact representative-frame strip above the map. Clicking a slot seeks OVF playback.
   * @param {string | null | undefined} jobId
   * @param {ReturnType<typeof buildScientificBoardModel> | null} boardModel
   */
  function renderSnapshotStrip(jobId, boardModel) {
    const snapshots = boardModel?.snapshots ?? [];
    if (!jobId || !snapshots.length) {
      snapshotStrip.replaceChildren();
      snapshotStripJobId = "";
      return;
    }
    snapshotStrip.querySelectorAll("[data-frame-index]").forEach((node) => {
      node.classList.toggle(
        "is-active",
        Number(node.getAttribute("data-frame-index")) === selectedOvfFrameIndex
      );
    });
    if (snapshotStripJobId === jobId && snapshotStrip.querySelector("[data-frame-index]")) return;
    snapshotStripJobId = jobId;
    const token = ++snapshotStripToken;
    const even = snapshots.every((slot) => slot.evenSpacing);
    snapshotStrip.innerHTML = `${
      even ? `<p class="sv-snapshot-legend">Evenly spaced frames · event times not resolved</p>` : ""
    }${snapshots
      .map(
        (slot) => `
      <figure class="sv-board-snapshot" data-snapshot-slot="${slot.slot}" data-frame-index="${slot.arrayIndex}" tabindex="0" role="button">
        <svg viewBox="0 0 120 138" role="img" aria-label="Loading mesh snapshot ${slot.caption}"></svg>
        <figcaption>${slot.caption}</figcaption>
      </figure>`
      )
      .join("")}`;
    snapshotStrip.querySelectorAll("[data-frame-index]").forEach((node) => {
      const seek = () => {
        const index = Number(node.getAttribute("data-frame-index"));
        selectedOvfFrameIndex = index;
        frameAnimator?.pause();
        void frameAnimator?.seek(index);
        snapshotStrip.querySelectorAll("[data-frame-index]").forEach((item) => {
          item.classList.toggle("is-active", item === node);
        });
      };
      node.addEventListener("click", seek);
      node.addEventListener("keydown", (event) => {
        if (event instanceof KeyboardEvent && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          seek();
        }
      });
    });
    void Promise.all(
      snapshots.map(async (slot) => {
        try {
          const response = await getOvfFrame(jobId, slot.arrayIndex);
          if (token !== snapshotStripToken) return;
          if (!response.frame?.vectors?.length) throw new Error("empty frame");
          const figure = snapshotStrip.querySelector(`[data-snapshot-slot="${slot.slot}"]`);
          const svgNode = figure?.querySelector("svg");
          if (svgNode instanceof SVGSVGElement) {
            renderSnapshotMap(svgNode, response.frame, { caption: slot.caption });
          }
        } catch {
          if (token !== snapshotStripToken) return;
          const figure = snapshotStrip.querySelector(`[data-snapshot-slot="${slot.slot}"]`);
          const caption = figure?.querySelector("figcaption");
          if (caption) caption.textContent = `${slot.caption} · unavailable`;
        }
      })
    );
  }

  /**
   * @param {import("../lib/types").WorkspaceSnapshot} snapshot
   */
  function renderAnalysis(snapshot) {
    if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
    playbackFrame = null;
    validationList.replaceChildren();
    if (!snapshot.state.validation.length) {
      const empty = document.createElement("li");
      empty.className = "sv-empty";
      empty.textContent = "No UI validation issues.";
      validationList.append(empty);
    } else {
      for (const issue of snapshot.state.validation) {
        const item = document.createElement("li");
        item.className = `sv-issue sv-issue-${issue.severity}`;
        item.innerHTML = `<span>${issue.severity}</span><strong>${issue.field}</strong><p>${issue.message}</p>`;
        validationList.append(item);
      }
    }

    logsPanel.replaceChildren();
    if (!snapshot.logs.length) {
      const empty = document.createElement("p");
      empty.className = "sv-empty";
      empty.textContent = "No log entries yet.";
      logsPanel.append(empty);
    } else {
      const list = document.createElement("ol");
      list.className = "sv-log-list";
      for (const entry of snapshot.logs.slice().reverse()) {
        const item = document.createElement("li");
        item.className = `sv-log sv-log-${entry.level}`;
        item.innerHTML = `<time datetime="${entry.at}">${entry.at.slice(11, 19)}</time><span>${entry.level}</span><p>${entry.message}</p>`;
        list.append(item);
      }
      logsPanel.append(list);
    }

    timeline.replaceChildren();
    if (!snapshot.timeline.length) {
      const empty = document.createElement("p");
      empty.className = "sv-empty";
      empty.textContent = "No run yet.";
      timeline.append(empty);
    } else {
      for (const event of snapshot.timeline) {
        const item = document.createElement("li");
        item.className = `sv-tl sv-tl-${event.status}`;
        item.innerHTML = `<span>${event.label}</span><small>${event.at.slice(11, 19)} · ${
          event.connected ? "backend job" : "local demo"
        }</small>`;
        timeline.append(item);
      }
    }

    if (!snapshot.result) {
      frameAnimator?.destroy();
      frameAnimator = null;
      scientificBoard?.destroy();
      scientificBoard = null;
      selectedOvfFrameIndex = 0;
      mumaxPlaybackRoot.replaceChildren();
      renderSnapshotStrip(null, null);
      const message = resultsPanelMessage(snapshot);
      resultsPanel.innerHTML = `<div class="sv-state sv-state-${message?.kind ?? "empty"}" role="status">
        <strong>${message?.title ?? "No result yet"}</strong>
        <p>${message?.body ?? ""}</p>
      </div>`;
    } else {
      const result = snapshot.result;
      const modelLabel = resolveDisplayedRunModelLabel(snapshot.state, snapshot.lastJob, result);
      const modelCopy = runModelBannerCopy(snapshot.state, snapshot.lastJob, result);
      const isDemo = result.source === "demo_fixture" || !result.isPhysicalSimulation;
      const bannerKind =
        modelLabel.startsWith("spinvault_mtj_free_layer_v0")
          ? "twin-v0"
          : isDemo
            ? "demo"
            : "physical";
      const bannerText = `${modelCopy.title} · ${result.source}`;
      const { featured, rest } = partitionMetrics(result.metrics ?? []);
      const { magnetization, other } = splitMagnetizationSeries(result.series ?? []);
      const playback = buildMagnetizationPlayback(magnetization);
      const useFrameAnimator = shouldUseMumax3FrameAnimator(result);
      const ovfFrames = ovfFramesFromResult(result);
      const overlay = overlaySeriesPaths([magnetization.mx, magnetization.my, magnetization.mz], {
        width: 320,
        height: 140
      });
      const strokeById = {
        [magnetization.mx?.id ?? "mx"]: "var(--sv-chart-mx, #0b6e4f)",
        [magnetization.my?.id ?? "my"]: "var(--sv-chart-my, #1d4e89)",
        [magnetization.mz?.id ?? "mz"]: "var(--sv-chart-mz, #9a3412)"
      };
      const trajChart = overlay.empty
        ? `<div class="sv-state sv-state-empty" role="status"><strong>No magnetization trajectory</strong><p>No mx/my/mz series were returned for this run.</p></div>`
        : `<figure class="sv-chart sv-chart-overlay">
            <figcaption>Magnetization trajectory<small>mx / my / mz vs time from returned table series</small></figcaption>
            <svg viewBox="0 0 320 140" role="img" aria-label="mx my mz trajectory">
              <rect x="1" y="1" width="318" height="138" fill="transparent" stroke="currentColor" stroke-opacity="0.2"></rect>
              ${overlay.paths
                .map(
                  (path, index) =>
                    `<path d="${path.d}" fill="none" stroke="${
                      strokeById[path.id] ?? "currentColor"
                    }" stroke-width="2" data-series="${index}"></path>`
                )
                .join("")}
            </svg>
            <ul class="sv-chart-legend">
              ${magnetization.mx ? `<li data-series="mx">mx</li>` : ""}
              ${magnetization.my ? `<li data-series="my">my</li>` : ""}
              ${magnetization.mz ? `<li data-series="mz">mz</li>` : ""}
            </ul>
          </figure>`;
      const otherCharts = other
        .map((series) => {
          const path = seriesToPath(series);
          return `<figure class="sv-chart">
            <figcaption>${series.label}<small>${series.xLabel} (${series.xUnit}) vs ${series.yLabel} (${series.yUnit})</small></figcaption>
            <svg viewBox="0 0 276 96" role="img" aria-label="${series.label} chart">
              <rect x="1" y="1" width="274" height="94" fill="transparent" stroke="currentColor" stroke-opacity="0.2"></rect>
              <path d="${path}" fill="none" stroke="currentColor" stroke-width="2"></path>
            </svg>
          </figure>`;
        })
        .join("");
      /** @param {import("../lib/types").SimulationResult["metrics"][number]} metric */
      const renderMetric = (metric) => {
        const heuristic = metricIsHeuristic(metric);
        return `<article class="${heuristic ? "sv-metric-heuristic" : ""}" data-metric="${metric.id}">
          <span>${metric.label}${heuristic ? " · heuristic" : ""}</span>
          <strong>${metric.displayValue}</strong>
          <p>${metric.note}</p>
        </article>`;
      };
      const featuredHtml = featured.map(renderMetric).join("");
      const restHtml = rest.map(renderMetric).join("");
      const warnings = (snapshot.lastJob?.warnings ?? [])
        .map((warning) => `<li>${warning.message}</li>`)
        .join("");
      const switchingMetric = (result.metrics ?? []).find((metric) => metric.id === "switching-occurred");
      const switchingFailedHtml =
        switchingMetric?.displayValue === "no"
          ? `<div class="sv-state sv-state-empty" role="status" data-switching-outcome="failed"><strong>Switching failed / not achieved</strong><p>The free-layer magnetization did not cross the configured P/AP threshold. Classification only — not TMR or resistance.</p></div>`
          : switchingMetric?.displayValue === "yes"
            ? `<div class="sv-state sv-state-busy" role="status" data-switching-outcome="occurred"><strong>Switching occurred</strong><p>m(t) crossed the configured threshold. Classification only — not a device validation claim.</p></div>`
            : "";
      const showScientificBoard =
        result.source === "python_micromagnetic" ||
        result.source === "mumax3" ||
        result.source === "python_llg_twin" ||
        Boolean(result.artifacts?.frames?.length);
      const finalMx = (result.metrics ?? []).find((metric) => metric.id === "final-mx")?.displayValue ?? "n/a";
      const finalMy = (result.metrics ?? []).find((metric) => metric.id === "final-my")?.displayValue ?? "n/a";
      const finalMz = (result.metrics ?? []).find((metric) => metric.id === "final-mz")?.displayValue ?? "n/a";
      resultsPanel.innerHTML = `
        ${trajChart}
        <div class="sv-result-banner" data-kind="${bannerKind}" title="${modelCopy.note}">${bannerText}</div>
        ${switchingFailedHtml}
        <div class="sv-result-compact-cards">
          <article><span>Status</span><strong>${snapshot.status}</strong></article>
          <article><span>Mesh frames</span><strong>${ovfFrames.length || "none"}</strong></article>
          <article><span>Final mean m</span><strong>${finalMx} / ${finalMy} / ${finalMz}</strong></article>
        </div>
        ${
          showScientificBoard
            ? `<section class="sv-scientific-dashboard" data-scientific-board-root></section>`
            : ""
        }
        <details class="sv-result-details">
          <summary>Metrics and returned series</summary>
          ${warnings ? `<ul class="sv-issue-list">${warnings}</ul>` : ""}
          <div class="sv-metric-grid">${featuredHtml || "<p class='sv-empty'>No featured metrics returned.</p>"}</div>
          ${restHtml ? `<div class="sv-metric-grid">${restHtml}</div>` : ""}
          ${otherCharts}
        </details>
      `;
      const boardRoot = resultsPanel.querySelector("[data-scientific-board-root]");
      if (showScientificBoard && boardRoot instanceof HTMLElement) {
        const tunneling = null;
        const boardModel = buildScientificBoardModel({
          result,
          job: snapshot.lastJob,
          magnetization,
          tunneling
        });
        if (!scientificBoard || scientificBoard.root !== boardRoot) {
          scientificBoard?.destroy();
          scientificBoard = new ScientificBoardController({
            root: boardRoot,
            jobId: snapshot.lastJob?.jobId ?? snapshot.jobId,
            onSnapshotClick: (index) => {
              selectedOvfFrameIndex = index;
              frameAnimator?.pause();
              void frameAnimator?.seek(index);
              snapshotStrip.querySelectorAll("[data-frame-index]").forEach((node) => {
                node.classList.toggle("is-active", Number(node.getAttribute("data-frame-index")) === index);
              });
            }
          });
        }
        scientificBoard.render(boardModel, {
          jobId: snapshot.lastJob?.jobId ?? snapshot.jobId
        });
        renderSnapshotStrip(snapshot.lastJob?.jobId ?? snapshot.jobId, boardModel);
      } else {
        scientificBoard?.destroy();
        scientificBoard = null;
        renderSnapshotStrip(null, null);
      }
      const animatorRoot = mumaxPlaybackRoot;
      const frameJobId = snapshot.lastJob?.jobId ?? snapshot.jobId;
      if (useFrameAnimator && animatorRoot instanceof HTMLElement && frameJobId) {
        if (frameAnimator?.jobId === frameJobId) {
          frameAnimator.geometry = snapshot.state.geometry;
          frameAnimator.runMetrics = result.metrics ?? [];
          frameAnimator.magnetization = magnetization;
          if (frameAnimator.controlsRoot !== animatorRoot) {
            frameAnimator.attach(animatorRoot, selectedOvfFrameIndex);
          } else {
            frameAnimator.showSelected();
          }
        } else {
          frameAnimator?.destroy();
          selectedOvfFrameIndex = 0;
          frameAnimator = new MuMax3FrameAnimator({
            viewport: svg,
            controlsRoot: animatorRoot,
            jobId: frameJobId,
            frames: ovfFrames,
            source: result.source,
            geometry: snapshot.state.geometry,
            runMetrics: result.metrics ?? [],
            magnetization,
            displayMode: /** @type {"vector" | "mz" | "mx" | "my"} */ (
              /** @type {HTMLSelectElement | null} */ (document.getElementById("sv-display-mode"))?.value ?? "vector"
            ),
            isViewportActive: () => twinViewport.controls.viewMode === "particle_spin",
            selectedFrameIndex: selectedOvfFrameIndex,
            onFrameIndexChange: (index) => {
              selectedOvfFrameIndex = index;
              snapshotStrip.querySelectorAll("[data-frame-index]").forEach((node) => {
                node.classList.toggle("is-active", Number(node.getAttribute("data-frame-index")) === index);
              });
            }
          });
          frameAnimator.mount();
        }
      } else if (useFrameAnimator) {
        frameAnimator?.destroy();
        frameAnimator = null;
        mumaxPlaybackRoot.replaceChildren();
        renderOvfFrameErrorViewport(
          svg,
          "The completed result did not include a job ID for its attached mesh frames.",
          snapshot.state.geometry
        );
      } else {
        frameAnimator?.destroy();
        frameAnimator = null;
        mumaxPlaybackRoot.replaceChildren();
        selectedOvfFrameIndex = 0;
      }
    }

    const artifactView = buildArtifactView(snapshot.lastJob);
    artifactsPanel.innerHTML = `
      <div class="sv-state ${artifactView.available ? "sv-state-busy" : "sv-state-empty"}" role="status">
        <strong>${artifactView.available ? "Artifacts" : "No solver artifacts"}</strong>
        <p>${artifactView.message}</p>
        ${artifactView.guidance ? `<p>${artifactView.guidance}</p>` : ""}
      </div>
      ${artifactView.items
        .map(
          (item) => `<article class="sv-artifact-block" data-artifact="${item.id}">
            <strong>${item.label}</strong>
            <pre>${item.content.replaceAll("<", "&lt;")}</pre>
            <div class="sv-artifact-actions">
              <button type="button" class="sv-text-link" data-copy-artifact="${item.id}">Copy</button>
              ${
                item.downloadName
                  ? `<button type="button" class="sv-text-link" data-download-artifact="${item.id}" data-filename="${item.downloadName}">Download</button>`
                  : ""
              }
            </div>
          </article>`
        )
        .join("")}
    `;
    artifactsPanel.querySelectorAll("[data-copy-artifact]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.getAttribute("data-copy-artifact");
        const item = artifactView.items.find((entry) => entry.id === id);
        if (!item) return;
        try {
          await navigator.clipboard.writeText(item.content);
          log("info", `Copied ${item.label}.`);
        } catch {
          log("warning", `Could not copy ${item.label}.`);
        }
      });
    });
    artifactsPanel.querySelectorAll("[data-download-artifact]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-download-artifact");
        const filename = button.getAttribute("data-filename") || "artifact.json";
        const item = artifactView.items.find((entry) => entry.id === id);
        if (!item) return;
        const blob = new Blob([item.content], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      });
    });

    if (snapshot.result) {
      const provenance = snapshot.result.provenance;
      const fields = extractProvenanceFields(snapshot.lastJob, snapshot.result);
      const notes = (provenance.notes ?? []).map((note) => `<li>${note}</li>`).join("");
      provenancePanel.innerHTML = `
        <dl class="sv-prov">
          <div><dt>Model kind</dt><dd>${fields.modelKind ?? snapshot.state.solverDrafts.mumax3.modelKind ?? "n/a"}</dd></div>
          <div><dt>Created</dt><dd>${provenance.createdAt}</dd></div>
          <div><dt>Created by</dt><dd>${provenance.createdBy}</dd></div>
          <div><dt>Solver</dt><dd>${provenance.solver}${
            provenance.solverVersion ? ` · ${provenance.solverVersion}` : ""
          }</dd></div>
          <div><dt>Physical</dt><dd>${String(snapshot.result.isPhysicalSimulation)}</dd></div>
          <div><dt>Worker</dt><dd>${fields.worker_id ?? snapshot.lastJob?.workerId ?? "n/a"}</dd></div>
          <div><dt>Run acceleration</dt><dd>${fields.run_acceleration ?? "n/a"}</dd></div>
          <div><dt>Host GPU label</dt><dd>${fields.host_gpu_label ?? snapshot.lastJob?.gpu?.acceleration ?? "n/a"}</dd></div>
          <div><dt>Request hash</dt><dd>${fields.request_hash ?? provenance.inputHash ?? "none"}</dd></div>
          <div><dt>Script hash</dt><dd>${fields.script_hash ?? "none"}</dd></div>
          <div><dt>Artifacts dir</dt><dd>${fields.artifacts_dir ?? "n/a"}</dd></div>
          <div><dt>Job</dt><dd>${snapshot.jobId ?? "none"}</dd></div>
        </dl>
        <p class="sv-hint">Raw solver provenance notes. Not calibrated / not experimentally validated unless a note says otherwise (and none currently claim validation).</p>
        <ul>${notes}</ul>
      `;
    } else if (snapshot.lastJob?.provenance) {
      const provenance = snapshot.lastJob.provenance;
      const fields = extractProvenanceFields(snapshot.lastJob, null);
      const notes = (provenance.notes ?? []).map((note) => `<li>${note}</li>`).join("");
      const errors = (snapshot.lastJob.errors ?? [])
        .map((entry) => {
          const text = entry.field ? `${entry.field}: ${entry.message}` : entry.message;
          return `<li>${text}</li>`;
        })
        .join("");
      provenancePanel.innerHTML = `
        <dl class="sv-prov">
          <div><dt>Model kind</dt><dd>${fields.modelKind ?? snapshot.state.solverDrafts.mumax3.modelKind ?? "n/a"}</dd></div>
          <div><dt>Created</dt><dd>${provenance.createdAt}</dd></div>
          <div><dt>Created by</dt><dd>${provenance.createdBy}</dd></div>
          <div><dt>Solver</dt><dd>${provenance.solver}</dd></div>
          <div><dt>Status</dt><dd>${snapshot.lastJob.status}</dd></div>
          <div><dt>Worker</dt><dd>${fields.worker_id ?? snapshot.lastJob.workerId ?? "n/a"}</dd></div>
          <div><dt>Job</dt><dd>${snapshot.jobId ?? "none"}</dd></div>
        </dl>
        ${errors ? `<ul>${errors}</ul>` : ""}
        <ul>${notes}</ul>
      `;
    } else if (snapshot.error) {
      provenancePanel.innerHTML = `<div class="sv-state sv-state-error" role="status"><strong>No result provenance</strong><p>${snapshot.error.message}</p></div>`;
    } else {
      provenancePanel.innerHTML = `<div class="sv-state sv-state-empty" role="status"><strong>No provenance yet</strong><p>Provenance appears after a run. Solver archives appear only when the backend attaches them.</p></div>`;
    }

    statusLabel.dataset.status = snapshot.status;
    statusLabel.innerHTML = `<span class="sv-status-dot" aria-hidden="true"></span><span>${
      STATUS_LABELS[snapshot.status] ?? snapshot.status
    }</span>`;
    const solverMeta = SOLVER_TARGETS[snapshot.state.solverTarget];
    const modelCopy = runModelBannerCopy(snapshot.state);
    runButton.textContent =
      snapshot.state.solverTarget === "demo"
        ? "Run demo"
        : snapshot.state.solverTarget === "python_micromagnetic"
          ? "Run Python mesh"
          : snapshot.state.solverTarget === "python_llg"
            ? "Run Python LLG"
            : `Submit ${solverMeta?.label ?? snapshot.state.solverTarget}`;
    runButton.title = modelCopy.note;
    solverNote.textContent = solverMeta?.note ?? "Unknown solver target.";
    if (snapshot.state.solverTarget === "demo") {
      banner.textContent =
        getDemoExecutionMode() === "backend"
          ? `Demo via API (${getApiBaseUrl()}). Fixtures only; not physical.`
          : "Local demo fixtures only. Not a physical simulation.";
    } else if (snapshot.status === "not_configured") {
      banner.textContent = `${modelCopy.title} not configured on the backend.`;
    } else {
      banner.textContent = modelCopy.title;
      banner.title = `${modelCopy.note} API ${getApiBaseUrl()}`;
    }
    const busy = BUSY_STATUSES.has(snapshot.status);
    runButton.disabled = hasBlockingErrors(snapshot.state.validation) || busy;
    pauseButton.disabled =
      snapshot.state.solverTarget !== "demo" ||
      getDemoExecutionMode() !== "local" ||
      (snapshot.status !== "running" && !snapshot.paused);
    pauseButton.setAttribute("aria-pressed", String(snapshot.paused));
    cancelButton.disabled = !busy && !snapshot.paused;
  }

  let lastViewportSignature = "";
  let lastPythonJobId = "";
  store.subscribe((snapshot) => {
    syncForm(snapshot);
    const nextSignature = viewportSignature(snapshot.state);
    const useFrameAnimator = shouldUseMumax3FrameAnimator(snapshot.result);
    root.dataset.ovfPlayback = useFrameAnimator ? "true" : "false";
    twinViewport.syncFromScenarioState();
    if (useFrameAnimator && twinViewport.controls.viewMode === "particle_spin") {
      const frames = ovfFramesFromResult(snapshot.result);
      claimMumax3FrameViewport(
        svg,
        frames[selectedOvfFrameIndex] ?? frames[0] ?? null,
        snapshot.state.geometry
      );
      const evaluated = twinViewport.evaluate();
      twinViewport.renderMetrics(
        evaluated.spin,
        evaluated.tunnel,
        evaluated.tunnelOther,
        evaluated.transport,
        evaluated.device
      );
    } else {
      // Cell twin owns the first screen; schematic remains available only as a non-default fallback.
      if (nextSignature !== lastViewportSignature) {
        twinViewport.render();
        lastViewportSignature = nextSignature;
      } else if (
        !svg.querySelector(".sv-spin-field") &&
        !svg.querySelector(".sv-wave-field") &&
        !svg.querySelector(".sv-ovf-field")
      ) {
        twinViewport.render();
      } else {
        const evaluated = twinViewport.evaluate();
        twinViewport.renderMetrics(
          evaluated.spin,
          evaluated.tunnel,
          evaluated.tunnelOther,
          evaluated.transport,
          evaluated.device
        );
      }
    }
    if (
      snapshot.result?.source === "python_llg_twin" &&
      snapshot.result.isPhysicalSimulation &&
      snapshot.jobId &&
      snapshot.jobId !== lastPythonJobId
    ) {
      lastPythonJobId = snapshot.jobId;
      twinViewport.controls.progress = 0;
      if (twinViewport.controls.viewMode === "particle_spin") twinViewport.play();
    }
    renderAnalysis(snapshot);
  });

  titleInput.addEventListener("input", () => {
    store.updateState({ title: titleInput.value });
  });

  scenarioSelect.addEventListener("change", () => {
    const preset = getScenarioPreset(scenarioSelect.value);
    if (!preset) return;
    store.updateState(stateFromPreset(preset));
    log("info", `Loaded scenario preset “${preset.label}”. Example geometry only.`);
  });

  solverSelect.addEventListener("change", () => {
    const target = /** @type {import("../lib/types").SolverTarget} */ (solverSelect.value);
    store.updateState({ solverTarget: target });
    log("warning", SOLVER_TARGETS[target].note);
  });

  mumaxModelSelect.addEventListener("change", () => {
    const kind = /** @type {import("../lib/types").MumaxModelKind} */ (mumaxModelSelect.value);
    store.updateState((state) => {
      if (kind === "spinvault_mtj_free_layer_v0_visible") {
        return applyVisibleDynamicsPreset(state);
      }
      if (kind === "spinvault_mtj_free_layer_switching_v1") {
        return applySwitchingV1Preset(state);
      }
      return {
        ...state,
        solverTarget: "python_micromagnetic",
        controls: kind === "spinvault_mtj_free_layer_v0"
          ? { ...state.controls, duration: { value: 0.1, unit: "ns", source: "user" } }
          : state.controls,
        externalField: kind === "spinvault_mtj_free_layer_v0"
          ? {
              ...state.externalField,
              z: { value: 0.01, unit: "T", source: "user" }
            }
          : state.externalField,
        solverDrafts: {
          ...state.solverDrafts,
          mumax3: {
            ...state.solverDrafts.mumax3,
            modelKind: kind,
            ...(kind === "spinvault_mtj_free_layer_v0"
              ? {
                  gridSize: { nx: 8, ny: 4, nz: 1 },
                  simulationTime: { value: 0.1, unit: "ns", source: "user" }
                }
              : {})
          }
        }
      };
    });
    log("warning", MUMAX_MODEL_KINDS[kind]?.note ?? `MuMax3 modelKind=${kind}`);
  });

  shapeSelect.addEventListener("change", () => {
    store.updateState((state) => ({
      ...state,
      geometry: { ...state.geometry, cellShape: /** @type {import("../lib/types").CellShape} */ (shapeSelect.value) }
    }));
  });

  freeMaterial.addEventListener("change", () => {
    store.updateState((state) => ({ ...state, materials: { ...state.materials, freeLayerId: freeMaterial.value } }));
  });
  referenceMaterial.addEventListener("change", () => {
    store.updateState((state) => ({ ...state, materials: { ...state.materials, referenceLayerId: referenceMaterial.value } }));
  });
  barrierMaterial.addEventListener("change", () => {
    store.updateState((state) => ({ ...state, materials: { ...state.materials, barrierId: barrierMaterial.value } }));
  });

  modeGroup.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      store.updateState((state) => ({
        ...state,
        controls: { ...state.controls, mode: /** @type {import("../lib/types").SimulationMode} */ (button.getAttribute("data-mode")) }
      }));
    });
  });

  recordTimeline.addEventListener("change", () => {
    store.updateState((state) => ({ ...state, controls: { ...state.controls, recordTimeline: recordTimeline.checked } }));
  });
  pauseOnWarning.addEventListener("change", () => {
    store.updateState((state) => ({ ...state, controls: { ...state.controls, pauseOnWarning: pauseOnWarning.checked } }));
  });
  currentDirection.addEventListener("change", () => {
    store.updateState((state) => ({
      ...state,
      controls: { ...state.controls, currentDirection: /** @type {import("../lib/types").CurrentDirection} */ (currentDirection.value) }
    }));
  });
  selectedRegion.addEventListener("change", () => {
    store.updateState((state) => ({
      ...state,
      controls: { ...state.controls, selectedRegion: /** @type {import("../lib/types").DeviceRegion} */ (selectedRegion.value) }
    }));
  });

  for (const [inputId, path] of quantityBindings) {
    const input = /** @type {HTMLInputElement} */ (requireEl(inputId));
    const unit = /** @type {HTMLSelectElement} */ (requireEl(`${inputId}-unit`));
    const apply = () => {
      store.updateState((state) => {
        const previous = /** @type {import("../lib/types").Quantity | undefined} */ (getPath(state, path));
        return setPath(state, path, {
          value: parseNumericInput(input.value),
          unit: /** @type {import("../lib/types").Unit} */ (unit.value),
          source: "user",
          ...(previous?.citation ? { citation: previous.citation } : {})
        });
      });
    };
    input.addEventListener("input", apply);
    unit.addEventListener("change", apply);
    input.addEventListener("focus", () => {
      const region = path.includes("freeLayer")
        ? "free"
        : path.includes("barrier")
          ? "barrier"
          : path.includes("reference")
            ? "reference"
            : store.get().state.controls.selectedRegion;
      store.updateState((state) => ({
        ...state,
        controls: { ...state.controls, selectedRegion: /** @type {import("../lib/types").DeviceRegion} */ (region) }
      }));
    });
  }

  /** @param {string} id @param {string} path */
  function bindSelect(id, path) {
    const select = /** @type {HTMLSelectElement} */ (requireEl(id));
    select.addEventListener("change", () => store.updateState((state) => setPath(state, path, select.value)));
  }

  bindSelect("sv-torque-mechanism", "torque.mechanism");
  bindSelect("sv-initial-mode", "initialMagnetization.mode");
  bindSelect("sv-kwant-lattice", "solverDrafts.kwant.latticeModel");
  bindSelect("sv-kwant-leads", "solverDrafts.kwant.leadConfiguration");

  const torqueEnabled = /** @type {HTMLInputElement} */ (requireEl("sv-torque-enabled"));
  torqueEnabled.addEventListener("change", () => {
    store.updateState((state) => setPath(state, "torque.enabled", torqueEnabled.checked));
  });

  const seedInput = /** @type {HTMLInputElement} */ (requireEl("sv-initial-seed"));
  seedInput.addEventListener("input", () => {
    const value = seedInput.value === "" ? undefined : Math.trunc(parseNumericInput(seedInput.value));
    store.updateState((state) => setPath(state, "initialMagnetization.seed", value));
  });

  const vectorBindings = [
    ["sv-field-x", "externalField.x", "quantity"],
    ["sv-field-y", "externalField.y", "quantity"],
    ["sv-field-z", "externalField.z", "quantity"],
    ["sv-initial-x", "initialMagnetization.vector.x", "number"],
    ["sv-initial-y", "initialMagnetization.vector.y", "number"],
    ["sv-initial-z", "initialMagnetization.vector.z", "number"],
    ["sv-mesh-x", "solverDrafts.mumax3.meshCellSize.x", "length"],
    ["sv-mesh-y", "solverDrafts.mumax3.meshCellSize.y", "length"],
    ["sv-mesh-z", "solverDrafts.mumax3.meshCellSize.z", "length"],
    ["sv-axis-x", "solverDrafts.mumax3.anisotropyAxis.x", "number"],
    ["sv-axis-y", "solverDrafts.mumax3.anisotropyAxis.y", "number"],
    ["sv-axis-z", "solverDrafts.mumax3.anisotropyAxis.z", "number"],
    ["sv-switching-threshold", "solverDrafts.mumax3.switchingThreshold", "number"]
  ];
  for (const [id, path, kind] of vectorBindings) {
    const input = /** @type {HTMLInputElement} */ (requireEl(id));
    input.addEventListener("input", () => {
      const value = parseNumericInput(input.value);
      const nextValue = kind === "quantity"
        ? { value, unit: "T", source: "user" }
        : kind === "length"
          ? { value, unit: "nm", source: "user" }
          : value;
      store.updateState((state) => setPath(state, path, nextValue));
    });
  }

  const zoomIn = document.getElementById("sv-zoom-in");
  const zoomOut = document.getElementById("sv-zoom-out");
  if (zoomIn) {
    zoomIn.addEventListener("click", () => {
      store.updateState((state) => ({
        ...state,
        controls: { ...state.controls, viewportZoom: Math.min(1.8, Number((state.controls.viewportZoom + 0.1).toFixed(2))) }
      }));
    });
  }
  if (zoomOut) {
    zoomOut.addEventListener("click", () => {
      store.updateState((state) => ({
        ...state,
        controls: { ...state.controls, viewportZoom: Math.max(0.7, Number((state.controls.viewportZoom - 0.1).toFixed(2))) }
      }));
    });
  }

  requireEl("sv-reset").addEventListener("click", () => {
    jobController?.abort();
    store.reset();
    log("info", "Workspace reset to the default demo scenario.");
  });

  requireEl("sv-save").addEventListener("click", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.get().state));
    log("info", "Scenario saved locally in this browser. Not uploaded.");
  });

  requireEl("sv-export").addEventListener("click", () => {
    const snapshot = store.get();
    const isDemo =
      !snapshot.result ||
      snapshot.result.source === "demo_fixture" ||
      snapshot.result.isPhysicalSimulation === false;
    const payload = {
      disclaimer: isDemo
        ? "SpinVault Twin UI export. Demo/non-physical output. Do not treat as validated research."
        : "SpinVault Twin UI export. Includes backend job metadata when present.",
      source: snapshot.result?.source ?? "none",
      isPhysicalSimulation: Boolean(snapshot.result?.isPhysicalSimulation),
      apiBaseUrl: getApiBaseUrl(),
      snapshot
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${snapshot.state.scenarioId || "spinvault-twin"}-export.json`;
    link.click();
    URL.revokeObjectURL(url);
    log("info", "Exported workspace JSON.");
  });

  requireEl("sv-settings-open").addEventListener("click", async () => {
    apiUrlInput.value = getApiBaseUrl();
    demoModeSelect.value = getDemoExecutionMode();
    settingsStatus.textContent = "Checking solver configuration…";
    settingsDialog.showModal();
    try {
      const solvers = await getSolversStatus();
      const mumax = solvers?.mumax3;
      settingsStatus.textContent = mumax?.configured
        ? `MuMax3 configured: ${mumax.message || "ready"}`
        : `MuMax3 not configured: ${mumax?.message || "set MUMAX3_BINARY on the API host."}`;
    } catch (error) {
      settingsStatus.textContent =
        error instanceof Error
          ? error.message
          : "Could not reach /api/solvers. Start the backend or update the API URL.";
    }
  });
  requireEl("sv-settings-save").addEventListener("click", () => {
    const url = setApiBaseUrl(apiUrlInput.value);
    const mode = setDemoExecutionMode(/** @type {"local" | "backend"} */ (demoModeSelect.value));
    settingsStatus.textContent = `Saved. API=${url}; demo=${mode}.`;
    log("info", `Connection settings saved. API=${url}; demo execution=${mode}.`);
    store.updateWorkspace({});
  });
  requireEl("sv-settings-close").addEventListener("click", () => settingsDialog.close());

  const tabs = Array.from(root.querySelectorAll("[role='tab'][data-analysis-tab]")).filter(
    (node) => node instanceof HTMLButtonElement
  );
  const panels = Array.from(root.querySelectorAll("[data-analysis-panel]")).filter(
    (node) => node instanceof HTMLElement
  );
  /**
   * @param {string} id
   */
  function activateTab(id) {
    tabs.forEach((tab) => {
      const active = tab.getAttribute("data-analysis-tab") === id;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      const active = panel.getAttribute("data-analysis-panel") === id;
      panel.toggleAttribute("hidden", !active);
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab.getAttribute("data-analysis-tab") ?? "results"));
    tab.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const nextIndex =
        event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      next.focus();
      activateTab(next.getAttribute("data-analysis-tab") ?? "results");
    });
  });
  activateTab("twin");

  const mobileTabs = Array.from(root.querySelectorAll("[data-mobile-panel]"));
  mobileTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.getAttribute("data-mobile-panel");
      root.dataset.mobilePanel = id ?? "device";
      if (id === "results") activateTab("results");
      if (id === "logs") activateTab("logs");
      mobileTabs.forEach((node) => {
        const active = node === tab;
        node.classList.toggle("is-active", active);
        node.setAttribute("aria-selected", String(active));
      });
    });
  });

  pauseButton.addEventListener("click", () => {
    if (frameAnimator) {
      if (frameAnimator.timer === null) frameAnimator.play(1, true);
      else frameAnimator.pause();
      return;
    }
    if (store.get().state.solverTarget !== "demo" || getDemoExecutionMode() !== "local") {
      log("warning", "Pause applies only to the local demo adapter.");
      return;
    }
    if (store.get().status !== "running" && !paused) return;
    paused = !paused;
    store.updateWorkspace({ paused });
    log("info", paused ? "Local demo run paused." : "Local demo run resumed.");
  });

  const stepBack = document.getElementById("sv-step-back");
  const stepForward = document.getElementById("sv-step-forward");
  if (stepBack) stepBack.addEventListener("click", () => frameAnimator?.step(-1));
  if (stepForward) stepForward.addEventListener("click", () => frameAnimator?.step(1));
  const displayMode = document.getElementById("sv-display-mode");
  if (displayMode instanceof HTMLSelectElement) {
    displayMode.addEventListener("change", () => {
      if (frameAnimator) {
        const mode = displayMode.value;
        if (mode === "vector" || mode === "mz" || mode === "mx" || mode === "my") {
          frameAnimator.setDisplayMode(mode);
        }
      }
    });
  }

  requireEl("sv-cancel").addEventListener("click", async () => {
    const jobId = store.get().jobId;
    const usingRemote =
      store.get().state.solverTarget !== "demo" || getDemoExecutionMode() === "backend";
    jobController?.abort();
    if (usingRemote && jobId) {
      try {
        const job = await cancelSimulation(jobId);
        store.updateWorkspace({
          status: job.status,
          lastJob: job,
          result: job.result ?? null,
          error:
            job.status === "cancelled"
              ? { code: "cancelled", message: "Backend job cancelled." }
              : store.get().error
        });
        markTimeline(/** @type {import("../lib/types").SimulationStatus} */ (job.status));
        log("warning", `Cancel requested for ${jobId}; status=${job.status}.`);
      } catch (error) {
        log(
          "error",
          error instanceof Error ? error.message : "Cancel failed against the backend."
        );
      }
    }
  });

  runButton.addEventListener("click", async () => {
    const snapshot = store.get();
    if (hasBlockingErrors(snapshot.state.validation)) {
      activateTab("validation");
      log("error", "Run blocked by UI validation errors.");
      return;
    }
    if (snapshot.state.solverTarget === "python_llg" || snapshot.state.solverTarget === "python_micromagnetic") {
      void enterSimFullscreen();
    }
    jobController = new AbortController();
    paused = false;
    const solver = snapshot.state.solverTarget;
    const pathLabel =
      solver === "demo" && getDemoExecutionMode() === "local"
        ? "local demo adapter"
        : `API ${getApiBaseUrl()}`;
    store.updateWorkspace({
      status: "idle",
      result: null,
      error: null,
      paused: false,
      timeline: [],
      lastJob: null,
      jobId: null
    });
    log("info", `Starting run via ${pathLabel}. requestedSolver=${solver}.`);

    /** @type {Set<string>} */
    const seenStatuses = new Set();

    try {
      const response = await submitSimulation(
        { scenario: store.get().state, requestedSolver: store.get().state.solverTarget },
        {
          signal: jobController.signal,
          isPaused: () => paused,
          onStatus: (status, detail) => {
            if (!seenStatuses.has(status)) {
              seenStatuses.add(status);
              markTimeline(/** @type {import("../lib/types").SimulationStatus} */ (status));
              log("info", `Status → ${STATUS_LABELS[/** @type {import("../lib/types").SimulationStatus} */ (status)] ?? status}`);
            }
            store.updateWorkspace({
              status: /** @type {import("../lib/types").SimulationStatus} */ (status),
              paused,
              jobId: detail?.job?.jobId ?? store.get().jobId,
              lastJob: detail?.job ?? store.get().lastJob
            });
            if (detail?.warnings?.length) {
              for (const warning of detail.warnings) {
                log("warning", warning);
              }
            }
          }
        }
      );

      store.updateWorkspace({
        status: /** @type {import("../lib/types").SimulationStatus} */ (response.status),
        result: response.result ?? null,
        error: response.error ?? null,
        jobId: response.jobId,
        lastJob: response.job ?? store.get().lastJob,
        paused: false
      });
      if (!seenStatuses.has(response.status)) {
        markTimeline(/** @type {import("../lib/types").SimulationStatus} */ (response.status));
      }
      for (const warning of response.warnings ?? []) {
        log("warning", warning.message);
      }
      if (response.result) {
        activateTab("results");
        log(
          response.result.isPhysicalSimulation ? "info" : "warning",
          response.result.isPhysicalSimulation
            ? `Result loaded from ${response.result.source}.`
            : `Non-physical result loaded. source=${response.result.source}; isPhysicalSimulation=false.`
        );
      } else if (response.status === "not_configured") {
        activateTab("artifacts");
        log("warning", response.error?.message ?? "Solver not configured on the backend.");
      } else if (response.error) {
        activateTab("logs");
        log("error", response.error.message);
      }
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      store.updateWorkspace({
        status: cancelled ? "cancelled" : "failed",
        paused: false,
        error: {
          code: cancelled ? "cancelled" : "demo_job_failed",
          message: cancelled
            ? "Run cancelled."
            : error instanceof Error
              ? error.message
              : "Run failed before a result was available."
        }
      });
      markTimeline(cancelled ? "cancelled" : "failed");
      log(cancelled ? "warning" : "error", cancelled ? "Run cancelled." : "Run failed.");
    } finally {
      jobController = null;
      paused = false;
    }
  });

  const launchParams = new URLSearchParams(window.location.search);
  const resetSavedScenario = launchParams.has("reset");
  if (resetSavedScenario) {
    SCENARIO_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    if (!launchParams.get("api")) {
      setApiBaseUrl(DEFAULT_API_URL);
    }
    log("warning", "Cleared saved scenario from this browser and loaded defaults.");
  }
  const saved = resetSavedScenario
    ? null
    : localStorage.getItem(STORAGE_KEY) ||
      LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) ||
      null;
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object" && parsed.geometry && parsed.materials) {
        store.updateState(hydrateSavedState(parsed));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store.get().state));
        log("info", "Restored locally saved scenario. Still a demo shell.");
      }
    } catch {
      log("warning", "Saved scenario could not be parsed and was ignored.");
    }
  } else {
    log("info", "Workspace ready. Python mesh LLGS is the magnetization solver. Quantum Wave stays analytical Schrödinger.");
  }
  if (resetSavedScenario && launchParams.has("api")) {
    log("info", "API launch URL detected; the Python mesh solver will use the configured backend.");
  }
}
