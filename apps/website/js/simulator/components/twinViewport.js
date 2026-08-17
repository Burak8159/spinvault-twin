import { buildSpinCellField } from "../lib/spinCellModel.js";
import {
  DEFAULT_FERMI_EV,
  SECONDS_PER_YEAR,
  evaluateDevicePhysics,
  julliereTransport
} from "../lib/devicePhysics.js";
import { buildQuantumTransportView } from "../lib/quantumTransportView.js";
import { evaluateTunnelingModel, schrodingerPhaseRad } from "../lib/tunnelingModel.js";
import { buildMagnetizationPlayback, sampleMagnetizationAtProgress } from "../lib/playback.js";
import { splitMagnetizationSeries } from "../lib/resultView.js";
import { mzColor, pickViewportVariant } from "./mtjViewportLayout.js";
import { renderSpinView, updateSpinView } from "./spinView.js";
import { renderWaveView, updateWaveView } from "./waveView.js";

/**
 * @typedef {"particle_spin" | "quantum_wave"} TwinViewMode
 */

// Visible playback maps one wall-clock second to 10 fs of physical time.
// This scale is fixed; changing E therefore changes the animated angular rate E/ħ.
export const WAVE_PHYSICAL_SECONDS_PER_DISPLAY_SECOND = 10e-15;
/** Shortest loop of the Python m(t) table in the spin viewport. */
export const SPIN_TRAJECTORY_DISPLAY_SECONDS = 4;
/** Longest pass, so the final magnetization is reached without a long wait. */
export const SPIN_TRAJECTORY_MAX_DISPLAY_SECONDS = 20;
// The arrow must not outrun the eye. Free-layer precession carries the whole
// trajectory through many turns, so the loop length is taken from the angular
// path of the real m(t) samples instead of a fixed wall-clock duration.
export const SPIN_TRAJECTORY_TARGET_DEG_PER_SECOND = 90;

/**
 * Total angle swept by m(t) in degrees, summed over consecutive solver samples.
 * @param {Array<{ mx: number, my: number, mz: number }>} samples
 */
export function magnetizationPathDegrees(samples) {
  let total = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const a = samples[index - 1];
    const b = samples[index];
    const na = Math.hypot(a.mx, a.my, a.mz);
    const nb = Math.hypot(b.mx, b.my, b.mz);
    if (na < 1e-12 || nb < 1e-12) continue;
    const dot = (a.mx * b.mx + a.my * b.my + a.mz * b.mz) / (na * nb);
    total += Math.acos(Math.min(1, Math.max(-1, dot))) * (180 / Math.PI);
  }
  return total;
}

/**
 * Loop length that plays the swept angle at a readable angular rate.
 * @param {Array<{ mx: number, my: number, mz: number }>} samples
 */
export function spinDisplaySecondsForSamples(samples) {
  if (samples.length < 2) return SPIN_TRAJECTORY_DISPLAY_SECONDS;
  const needed = magnetizationPathDegrees(samples) / SPIN_TRAJECTORY_TARGET_DEG_PER_SECOND;
  return Math.min(
    SPIN_TRAJECTORY_MAX_DISPLAY_SECONDS,
    Math.max(SPIN_TRAJECTORY_DISPLAY_SECONDS, needed)
  );
}

/**
 * @param {import("../lib/types").Quantity | undefined} quantity
 */
function toNm(quantity) {
  if (!quantity) return 1;
  if (quantity.unit === "nm") return quantity.value;
  if (quantity.unit === "um") return quantity.value * 1e3;
  if (quantity.unit === "m") return quantity.value * 1e9;
  return quantity.value;
}

/**
 * @param {import("../lib/types").MumaxStatePreset | undefined} preset
 */
export function twinControlsFromStatePreset(preset) {
  if (preset === "state_1_p") {
    return { bit: /** @type {0 | 1} */ (1), transition: /** @type {const} */ ("none") };
  }
  if (preset === "transition_0_to_1") {
    return { bit: /** @type {0 | 1} */ (0), transition: /** @type {const} */ ("0_to_1") };
  }
  if (preset === "transition_1_to_0") {
    return { bit: /** @type {0 | 1} */ (1), transition: /** @type {const} */ ("1_to_0") };
  }
  return { bit: /** @type {0 | 1} */ (0), transition: /** @type {const} */ ("none") };
}

/**
 * @param {{ bit: 0 | 1, transition: "none" | "0_to_1" | "1_to_0" }} controls
 */
export function mumaxPatchFromSpinControls(controls) {
  const statePreset = /** @type {import("../lib/types").MumaxStatePreset} */ (
    controls.transition === "0_to_1"
      ? "transition_0_to_1"
      : controls.transition === "1_to_0"
        ? "transition_1_to_0"
        : controls.bit === 1
          ? "state_1_p"
          : "state_0_ap"
  );
  return {
    modelKind: /** @type {const} */ ("spinvault_mtj_free_layer_switching_v1"),
    statePreset
  };
}

/**
 * @param {import("../lib/types").SimulatorState} state
 */
export function defaultTwinControlsFromState(state) {
  const lengthNm = toNm(state.geometry.freeLayerLength);
  const widthNm = toNm(state.geometry.freeLayerWidth);
  const freeThicknessNm = toNm(state.geometry.freeLayerThickness);
  const barrierThicknessNm = toNm(state.geometry.barrierThickness);
  const referenceThicknessNm = toNm(state.geometry.referenceLayerThickness);
  const area = Math.max(1, lengthNm * widthNm);
  const preset = twinControlsFromStatePreset(state.solverDrafts.mumax3.statePreset);
  return {
    viewMode: /** @type {TwinViewMode} */ ("particle_spin"),
    ...preset,
    playing: false,
    progress: 0,
    speed: 1,
    disorder: 0,
    damping: state.solverDrafts.mumax3.dampingAlpha?.value ?? 0.02,
    externalFieldZ: state.externalField.z.value ?? 0,
    torqueStrength: 0,
    temperature: state.controls.temperature.value ?? 300,
    freeLengthNm: lengthNm,
    freeWidthNm: widthNm,
    freeThicknessNm,
    barrierThicknessNm,
    referenceThicknessNm,
    materialLabel: state.materials.freeLayerId,
    barrierHeightEv: 1.2,
    electronEnergyEv: 0.25,
    effectiveMassRatio: 0.4,
    // Read-bias operating point. The same bias sets the tilt of V(x) in the
    // Quantum Wave view and the Tsu-Esaki leakage current.
    biasVolts: -0.1,
    spinPolarization: state.torque.polarization?.value ?? 0.4,
    currentDensityLog10: Math.log10(Math.max(1, Number(state.torque.currentDensity?.value) || 2e11)),
    cellAreaNm2: area,
    waveScale: /** @type {"atomic" | "cell" | "energy"} */ ("atomic"),
    wavePhaseRad: 0,
    waveTimeSeconds: 0,
    seed: 42
  };
}

/**
 * Owns Spin and Quantum Wave rendering in the center viewport.
 * Yields the spin map when MuMax3 OVF frames claim it.
 */
export class TwinViewportController {
  /**
   * @param {{
   *   svg: SVGSVGElement,
   *   controlsRoot: HTMLElement,
   *   metricsRoot: HTMLElement,
   *   modeRoot: HTMLElement,
   *   getState: () => import("../lib/types").SimulatorState,
   *   getResult?: () => import("../lib/types").SimulationResult | null,
   *   canOwnViewport?: (mode: TwinViewMode) => boolean,
   *   onControlsChange?: (controls: ReturnType<typeof defaultTwinControlsFromState>) => void,
   *   onViewModeChange?: (mode: TwinViewMode) => void,
   *   onVariantChange?: () => void,
   *   onRunRequested?: () => void
   * }} options
   */
  constructor(options) {
    this.svg = options.svg;
    this.controlsRoot = options.controlsRoot;
    this.metricsRoot = options.metricsRoot;
    this.modeRoot = options.modeRoot;
    this.getState = options.getState;
    this.getResult = options.getResult ?? (() => null);
    this.canOwnViewport = options.canOwnViewport ?? (() => true);
    this.onControlsChange = options.onControlsChange ?? (() => {});
    this.onViewModeChange = options.onViewModeChange ?? (() => {});
    this.onVariantChange = options.onVariantChange ?? (() => {});
    this.onRunRequested = options.onRunRequested ?? (() => {});
    this.controls = defaultTwinControlsFromState(options.getState());
    this.variant = pickViewportVariant();
    /** @type {number | null} */
    this.raf = null;
    this.lastStamp = 0;
    this.waveStartedAt = 0;
    this.mounted = false;
    this.lastMetricsAt = 0;
    /** @type {import("../lib/types").SimulationResult | null} */
    this.trajectoryResult = null;
    /** @type {ReturnType<typeof buildMagnetizationPlayback>["samples"]} */
    this.trajectoryCache = [];
    this.trajectoryDisplaySeconds = SPIN_TRAJECTORY_DISPLAY_SECONDS;
    /** @type {string} */
    this.deviceCacheKey = "";
    /** @type {ReturnType<typeof evaluateDevicePhysics> | null} */
    this.deviceCache = null;
    /** @type {string} */
    this.tunnelCacheKey = "";
    /** @type {ReturnType<typeof evaluateTunnelingModel> | null} */
    this.tunnelCache = null;
    /** @type {ReturnType<typeof evaluateTunnelingModel> | null} */
    this.tunnelOtherCache = null;
    this.handleResize = () => {
      const next = pickViewportVariant();
      if (next === this.variant) return;
      this.variant = next;
      this.render();
      this.onVariantChange();
    };
  }

  mount() {
    this.mounted = true;
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.handleResize);
    }
    this.renderModeSwitch();
    this.renderControls();
    this.render();
  }

  /**
   * @param {Partial<ReturnType<typeof defaultTwinControlsFromState>>} patch
   * @param {{ rebuildControls?: boolean }} [options]
   */
  updateControls(patch, options = {}) {
    const rebuildControls =
      options.rebuildControls ??
      ("viewMode" in patch || "bit" in patch || "transition" in patch || "playing" in patch);
    const viewChanged = "viewMode" in patch && patch.viewMode !== this.controls.viewMode;
    this.controls = { ...this.controls, ...patch };
    this.onControlsChange(this.controls);
    if (rebuildControls) this.renderControls();
    else this.syncSliderReadouts();
    if (viewChanged) {
      this.renderModeSwitch();
      this.onViewModeChange(this.controls.viewMode);
    }
    this.render();
  }

  syncSliderReadouts() {
    this.controlsRoot.querySelectorAll("[data-twin-slider]").forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      const key = input.getAttribute("data-twin-slider");
      if (!key || !(key in this.controls)) return;
      const value = /** @type {Record<string, unknown>} */ (this.controls)[key];
      if (typeof value === "number") {
        input.value = String(value);
        const readout = input.parentElement?.querySelector("span");
        if (readout) readout.textContent = Number(value).toPrecision(4);
      }
    });
  }

  syncFromScenarioState() {
    const defaults = defaultTwinControlsFromState(this.getState());
    this.controls = {
      ...this.controls,
      freeLengthNm: defaults.freeLengthNm,
      freeWidthNm: defaults.freeWidthNm,
      freeThicknessNm: defaults.freeThicknessNm,
      barrierThicknessNm: this.controls.barrierThicknessNm || defaults.barrierThicknessNm,
      referenceThicknessNm: defaults.referenceThicknessNm,
      materialLabel: defaults.materialLabel,
      cellAreaNm2: defaults.cellAreaNm2,
      temperature: defaults.temperature,
      damping: defaults.damping,
      spinPolarization: defaults.spinPolarization,
      currentDensityLog10: defaults.currentDensityLog10
    };
  }

  renderModeSwitch() {
    const c = this.controls;
    this.modeRoot.className = "sv-viewport-modes sv-segmented";
    this.modeRoot.innerHTML = `
      <button type="button" data-view-mode="particle_spin" class="${c.viewMode === "particle_spin" ? "is-active" : ""}" aria-pressed="${c.viewMode === "particle_spin"}" aria-selected="${c.viewMode === "particle_spin"}">Spin</button>
      <button type="button" data-view-mode="quantum_wave" class="${c.viewMode === "quantum_wave" ? "is-active" : ""}" aria-pressed="${c.viewMode === "quantum_wave"}" aria-selected="${c.viewMode === "quantum_wave"}">Quantum Wave</button>
    `;
    this.modeRoot.querySelectorAll("[data-view-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = /** @type {TwinViewMode} */ (button.getAttribute("data-view-mode"));
        if (mode === "quantum_wave") this.play();
        this.updateControls({ viewMode: mode });
      });
    });
  }

  renderControls() {
    const c = this.controls;
    const wave = c.viewMode === "quantum_wave";
    this.controlsRoot.innerHTML = `
      <div class="sv-twin-controls" data-twin-controls>
        ${
          wave
            ? `<fieldset class="sv-twin-fieldset" data-panel="wave">
          <legend>Quantum tunneling</legend>
          <p class="sv-compact-boundary">1D Schrödinger scattering · rectangular at zero bias, trapezoidal under bias · not MuMax3/Kwant</p>
          ${slider("barrierHeightEv", "Barrier V₀ (eV)", c.barrierHeightEv, 0.2, 4, 0.01)}
          ${slider("electronEnergyEv", "Electron E (eV)", c.electronEnergyEv, 0.05, 3, 0.01)}
          ${slider("effectiveMassRatio", "Effective mass m*/mₑ", c.effectiveMassRatio, 0.05, 1.5, 0.01)}
          ${slider("biasVolts", "Right-lead bias (V)", c.biasVolts, -2, 2, 0.01)}
        </fieldset>`
            : `<fieldset class="sv-twin-fieldset" data-panel="spin">
          <legend>Spin state</legend>
          <div class="sv-segmented" role="group" aria-label="Stored bit">
            <button type="button" data-bit="0" class="${c.bit === 0 && c.transition === "none" ? "is-active" : ""}" aria-pressed="${c.bit === 0 && c.transition === "none"}">Run state 0 · AP</button>
            <button type="button" data-bit="1" class="${c.bit === 1 && c.transition === "none" ? "is-active" : ""}" aria-pressed="${c.bit === 1 && c.transition === "none"}">Run state 1 · P</button>
          </div>
          <div class="sv-segmented" role="group" aria-label="Transition">
            <button type="button" data-transition="0_to_1" class="${c.transition === "0_to_1" ? "is-active" : ""}" aria-pressed="${c.transition === "0_to_1"}">Run 0→1</button>
            <button type="button" data-transition="1_to_0" class="${c.transition === "1_to_0" ? "is-active" : ""}" aria-pressed="${c.transition === "1_to_0"}">Run 1→0</button>
          </div>
          ${slider("currentDensityLog10", "Write current log₁₀(J / A m⁻²)", c.currentDensityLog10 ?? 11.3, 9, 13, 0.01)}
          ${slider("temperature", "Temperature (K)", c.temperature, 0, 500, 1)}
        </fieldset>`
        }
        <details class="sv-advanced-parameters">
          <summary>Advanced physical parameters</summary>
          ${slider("barrierThicknessNm", "Barrier thickness (nm)", c.barrierThicknessNm, 0.2, 3, 0.01)}
          ${slider("spinPolarization", "Spin polarization", c.spinPolarization, 0, 1, 0.01)}
        </details>
      </div>
    `;

    this.controlsRoot.querySelectorAll("[data-bit]").forEach((button) => {
      button.addEventListener("click", () => {
        const bit = /** @type {0 | 1} */ (Number(button.getAttribute("data-bit")));
        this.pause();
        this.updateControls({ bit, transition: "none", progress: 0, playing: false });
        this.onRunRequested();
      });
    });
    this.controlsRoot.querySelectorAll("[data-transition]").forEach((button) => {
      button.addEventListener("click", () => {
        const transition = /** @type {"0_to_1" | "1_to_0"} */ (button.getAttribute("data-transition"));
        this.updateControls({
          transition,
          progress: 0,
          bit: transition === "0_to_1" ? 0 : 1,
          playing: false
        });
        this.onRunRequested();
      });
    });
    this.controlsRoot.querySelectorAll("[data-twin-slider]").forEach((input) => {
      input.addEventListener("input", () => {
        if (!(input instanceof HTMLInputElement)) return;
        const key = input.getAttribute("data-twin-slider");
        if (!key) return;
        this.updateControls({ [key]: Number(input.value) }, { rebuildControls: false });
      });
    });
  }

  play() {
    this.controls.playing = true;
    this.onControlsChange(this.controls);
    const startedAt = performance.now() - (this.controls.waveTimeSeconds ?? 0) * 1000;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    const tick = (/** @type {number} */ stamp) => {
      if (!this.controls.playing) return;
      if (this.controls.viewMode === "quantum_wave") {
        const displayElapsedSeconds = Math.max(0, stamp - startedAt) / 1000;
        this.controls.waveTimeSeconds =
          displayElapsedSeconds * WAVE_PHYSICAL_SECONDS_PER_DISPLAY_SECOND;
        this.controls.wavePhaseRad = schrodingerPhaseRad(
          this.controls.electronEnergyEv,
          this.controls.waveTimeSeconds
        );
      } else if (this.pythonTrajectory().length >= 2) {
        const dt = this.lastStamp ? (stamp - this.lastStamp) / 1000 : 0;
        this.controls.progress += dt / this.spinDisplaySeconds();
        // Time runs forward only. Replaying m(t) backwards is not an LLG
        // solution, so the run ends held at its final magnetization.
        if (this.controls.progress >= 1) {
          this.controls.progress = 1;
          this.lastStamp = stamp;
          this.render();
          this.pause();
          return;
        }
      }
      this.lastStamp = stamp;
      this.render();
      this.raf = requestAnimationFrame(tick);
    };
    this.lastStamp = 0;
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    this.controls.playing = false;
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  pythonTrajectory() {
    const result = this.getResult();
    if (result?.source !== "python_llg_twin" || !result.isPhysicalSimulation) {
      this.trajectoryResult = null;
      this.trajectoryCache = [];
      return this.trajectoryCache;
    }
    if (this.trajectoryResult === result) return this.trajectoryCache;
    const { magnetization } = splitMagnetizationSeries(result.series ?? []);
    this.trajectoryResult = result;
    this.trajectoryCache = buildMagnetizationPlayback(magnetization).samples;
    this.trajectoryDisplaySeconds = spinDisplaySecondsForSamples(this.trajectoryCache);
    return this.trajectoryCache;
  }

  /** Loop length for the current trajectory, in wall-clock seconds. */
  spinDisplaySeconds() {
    return this.trajectoryDisplaySeconds || SPIN_TRAJECTORY_DISPLAY_SECONDS;
  }

  /**
   * Retention, leakage, and magnetoresistance for the displayed device state.
   * The energy-resolved leakage integral is cached because only the junction
   * angle changes between animation frames.
   * @param {number} cosTheta
   */
  deviceChain(cosTheta) {
    const c = this.controls;
    const state = this.getState();
    const shape = state?.geometry?.cellShape === "rectangle" ? "rectangle" : "ellipse";
    const footprint = c.freeLengthNm * c.freeWidthNm;
    const mumax = state?.solverDrafts?.mumax3;
    const easyAxis =
      Math.abs(mumax?.anisotropyAxis?.z ?? 1) >= Math.abs(mumax?.anisotropyAxis?.x ?? 0)
        ? /** @type {const} */ ("perpendicular")
        : /** @type {const} */ ("in_plane");
    const params = {
      barrierThicknessNm: c.barrierThicknessNm,
      barrierHeightEv: c.barrierHeightEv,
      effectiveMassRatio: c.effectiveMassRatio,
      biasVolts: c.biasVolts,
      temperatureK: c.temperature,
      junctionAreaNm2: shape === "rectangle" ? footprint : (Math.PI / 4) * footprint,
      anisotropyJPerM3: Number(mumax?.anisotropyConstant?.value) || 0,
      saturationMagnetizationAPerM: Number(mumax?.saturationMagnetization?.value) || 0,
      easyAxis,
      freeLengthNm: c.freeLengthNm,
      freeWidthNm: c.freeWidthNm,
      freeThicknessNm: c.freeThicknessNm,
      shape: /** @type {"ellipse" | "rectangle"} */ (shape),
      spinPolarization: c.spinPolarization,
      fermiEv: DEFAULT_FERMI_EV,
      cosTheta: 1,
      dampingAlpha: Number(mumax?.dampingAlpha?.value) || c.damping || 0.01,
      currentDensityAPerM2: 10 ** (Number(c.currentDensityLog10) || 0)
    };
    const key = JSON.stringify(params);
    if (this.deviceCacheKey !== key || !this.deviceCache) {
      this.deviceCache = evaluateDevicePhysics(params);
      this.deviceCacheKey = key;
    }
    const base = this.deviceCache;
    return {
      ...base,
      transport: julliereTransport({
        conductanceAvgS: base.conductanceAvgS,
        polarizationFree: c.spinPolarization,
        cosTheta
      })
    };
  }

  evaluate() {
    const c = this.controls;
    const fromBit = c.transition === "0_to_1" ? 0 : c.transition === "1_to_0" ? 1 : c.bit;
    const toBit = c.transition === "0_to_1" ? 1 : c.transition === "1_to_0" ? 0 : c.bit;
    const compact = this.variant === "compact";
    const sample = sampleMagnetizationAtProgress(this.pythonTrajectory(), this.controls.progress);
    const spin = buildSpinCellField({
      nx: compact ? 8 : 12,
      freeRows: compact ? 3 : 4,
      referenceRows: compact ? 2 : 3,
      bit: c.bit,
      fromBit: c.transition === "none" ? c.bit : fromBit,
      toBit: c.transition === "none" ? c.bit : toBit,
      progress: c.transition === "none" ? 1 : 0,
      disorder: 0,
      damping: 0.01,
      torqueStrength: 0,
      externalFieldZ: 0,
      temperature: 0,
      seed: c.seed,
      freeLengthNm: c.freeLengthNm,
      freeWidthNm: c.freeWidthNm,
      freeThicknessNm: c.freeThicknessNm,
      barrierThicknessNm: c.barrierThicknessNm,
      referenceThicknessNm: c.referenceThicknessNm,
      materialLabel: c.materialLabel,
      ...(sample ? { freeMagnetization: { x: sample.mx, y: sample.my, z: sample.mz } } : {})
    });
    const tunnelParams = {
      barrierThicknessNm: c.barrierThicknessNm,
      barrierHeightEv: c.barrierHeightEv,
      electronEnergyEv: c.electronEnergyEv,
      effectiveMassRatio: c.effectiveMassRatio,
      biasVolts: c.biasVolts,
      temperatureK: c.temperature,
      cellAreaNm2: c.cellAreaNm2,
      spinState: c.bit,
      spinPolarization: c.spinPolarization,
      materialLabel: c.materialLabel
    };
    const tunnelKey = JSON.stringify(tunnelParams);
    if (this.tunnelCacheKey !== tunnelKey || !this.tunnelCache || !this.tunnelOtherCache) {
      this.tunnelCache = evaluateTunnelingModel(tunnelParams);
      this.tunnelOtherCache = evaluateTunnelingModel({
        ...tunnelParams,
        spinState: c.bit === 0 ? 1 : 0
      });
      this.tunnelCacheKey = tunnelKey;
    }
    const tunnel = this.tunnelCache;
    const tunnelOther = this.tunnelOtherCache;
    const transport = buildQuantumTransportView({
      result: this.getResult(),
      analyticalParams: tunnelParams
    });
    // The reference layer is pinned along +z, so cos(theta) is the displayed
    // free-layer mz. One angle drives the resistance in both views.
    const device = this.deviceChain(spin.meanFreeMagnetization?.z ?? 1);
    return { spin, tunnel, tunnelOther, transport, device };
  }

  render() {
    if (!this.mounted) return;
    const { spin, tunnel, tunnelOther, transport, device } = this.evaluate();
    if (!this.canOwnViewport(this.controls.viewMode)) {
      this.renderMetrics(spin, tunnel, tunnelOther, transport, device);
      return;
    }
    if (this.controls.viewMode === "quantum_wave") {
      const source = "Finite-barrier Schrödinger solution · analytical MODEL";
      const waveOptions = {
        variant: this.variant,
        geometry: this.getState()?.geometry,
        transportSource: source,
        title: "Quantum Wave",
        phaseRad: this.controls.wavePhaseRad,
        physicalTimeSeconds: this.controls.waveTimeSeconds,
        physicalSecondsPerDisplaySecond: WAVE_PHYSICAL_SECONDS_PER_DISPLAY_SECOND
      };
      if (this.svg.querySelector(".sv-wave-field")) updateWaveView(this.svg, tunnel, waveOptions);
      else renderWaveView(this.svg, tunnel, waveOptions);
    } else {
      const geometry = this.getState()?.geometry;
      const spinOptions = {
        variant: this.variant,
        geometry
      };
      if (this.svg.querySelector(".sv-spin-field")) updateSpinView(this.svg, spin, spinOptions);
      else renderSpinView(this.svg, spin, spinOptions);
    }
    this.renderMetrics(spin, tunnel, tunnelOther, transport, device);
  }

  /**
   * @param {ReturnType<typeof buildSpinCellField>} spin
   * @param {ReturnType<typeof evaluateTunnelingModel>} tunnel
   * @param {ReturnType<typeof evaluateTunnelingModel>} tunnelOther
   * @param {ReturnType<typeof buildQuantumTransportView>} transport
   * @param {ReturnType<TwinViewportController["deviceChain"]>} device
   */
  renderMetrics(spin, tunnel, tunnelOther, transport, device) {
    void tunnelOther;
    void transport;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (this.metricsRoot.childElementCount && now - this.lastMetricsAt < 200) return;
    this.lastMetricsAt = now;
    this.metricsRoot.innerHTML =
      this.controls.viewMode === "quantum_wave"
        ? this.waveBoardMarkup(tunnel, device)
        : this.spinBoardMarkup(spin, device);
  }

  /**
   * Retention, leakage, and magnetoresistance rendered identically in both
   * views, because both views read the same evaluation.
   * @param {ReturnType<TwinViewportController["deviceChain"]>} device
   */
  deviceChainMarkup(device) {
    const { stability, retention, leakage, transport, anisotropy, stt } = device;
    const tau = retention.tauSeconds;
    const tauText = !Number.isFinite(tau)
      ? "beyond double precision"
      : tau >= SECONDS_PER_YEAR
        ? `${retention.tauYears.toExponential(3)} yr`
        : `${tau.toExponential(3)} s`;
    const resistance = (/** @type {number} */ ohm) =>
      Number.isFinite(ohm) ? `${ohm.toExponential(3)} Ω` : "open circuit (zero bias)";
    const jc0Text = Number.isFinite(stt.criticalCurrentAPerM2)
      ? stt.criticalCurrentAPerM2.toExponential(3)
      : "∞";
    return `
      <p class="sv-board-eq">Anisotropy · K<sub>eff</sub>=K<sub>u1</sub>−μ₀M<sub>s</sub>²/2=${anisotropy.anisotropyJPerM3.toExponential(3)}−${anisotropy.shapeTermJPerM3.toExponential(3)}=${anisotropy.effectiveJPerM3.toExponential(3)} J/m³${anisotropy.losesPerpendicularEasyAxis ? " · perpendicular easy axis lost to shape anisotropy" : ""} · V=${(device.volumeM3 * 1e27).toFixed(2)} nm³</p>
      <p class="sv-board-eq">STT write · a<sub>J</sub>=ħ η J / (2e M<sub>s</sub> t) · η₀=P/2=${stt.eta0.toFixed(3)} · J=${stt.currentDensityAPerM2.toExponential(3)} A/m² · J<sub>c0</sub>=${jc0Text} A/m² · J/J<sub>c0</sub>=${stt.jOverJc0.toFixed(2)}${stt.belowThreshold ? " · below threshold: coherent rotation cannot reverse" : ""}</p>
      <p class="sv-board-eq">Retention · E<sub>b</sub>=K<sub>eff</sub>V=${stability.energyBarrierEv.toExponential(3)} eV · Δ=E<sub>b</sub>/k<sub>B</sub>T=${Number.isFinite(stability.delta) ? stability.delta.toFixed(1) : "∞"} · τ=τ₀e<sup>Δ</sup>=${tauText} · P<sub>flip</sub>(10 yr)=${retention.flipProbability.toExponential(2)} · 10-year criterion ${retention.meetsTenYearRetention ? "met" : "NOT met"}</p>
      <p class="sv-board-eq">Leakage · Tsu–Esaki over the same T(E) · J=${leakage.currentDensityAPerM2.toExponential(3)} A/m² · I=${leakage.currentA.toExponential(3)} A · barrier ${leakage.barrierAboveFermiEv.toFixed(2)} eV above E<sub>F</sub>=${leakage.fermiEv.toFixed(2)} eV · regime ${leakage.regime}</p>
      <p class="sv-board-eq">Magnetoresistance · Julliere G(θ)=G(1+P²cos θ) · cos θ=m·p̂=${transport.cosTheta.toFixed(4)} · R=${resistance(transport.resistanceOhm)} · R<sub>P</sub>=${resistance(transport.resistanceParallelOhm)} · R<sub>AP</sub>=${resistance(transport.resistanceAntiparallelOhm)} · TMR=${(transport.tmrRatio * 100).toFixed(1)}%</p>
      <p class="sv-compact-boundary">Single chain: LLGS m(t) includes Slonczewski torque and a Brown field at T&gt;0. The same 1D barrier gives ψ(x) and the Tsu–Esaki current; Julliere reads cos θ from m. Macrospin Jc0 overestimates nucleation switching. E<sub>F</sub>, V₀, and m* are placeholders; not calibrated.</p>
    `;
  }

  /**
   * @param {ReturnType<typeof evaluateTunnelingModel>} tunnel
   * @param {ReturnType<TwinViewportController["deviceChain"]>} device
   */
  waveBoardMarkup(tunnel, device) {
    const timeFs = (this.controls.waveTimeSeconds ?? 0) * 1e15;
    return `
      <section class="sv-twin-metrics sv-viewport-board" aria-label="Quantum wave model board">
        <p><span class="sv-prov-badge" data-class="MODEL">MODEL</span> 1D Schrödinger scattering on V(x)=V<sub>0</sub>−V<sub>bias</sub> x/d · not MuMax3, not Kwant</p>
        <ul class="sv-board-legend">
          <li><span class="sv-swatch" style="background:#5ec8ff"></span>Re[ψ(x)e<sup>−iEt/ℏ</sup>] (animated)</li>
          <li><span class="sv-swatch" style="background:#ffd27a"></span>|ψ(x)|² (stationary)</li>
          <li><span class="sv-swatch" style="background:#46c478"></span>arrows → max |ψ|² · green = small TISE residual</li>
          <li><span class="sv-swatch" style="background:#c43034"></span>red = larger −(ħ²/2m)ψ″+Vψ−Eψ residual</li>
        </ul>
        <p class="sv-board-eq">−(ℏ²/2m*)ψ″ + V(x)ψ = Eψ · ψ and dψ/dx continuous · T=(k<sub>R</sub>/k<sub>L</sub>)|t|²</p>
        <p class="sv-board-eq">T = ${tunnel.transmission.toExponential(3)} · R = ${tunnel.reflection.toExponential(3)} · R+T = ${tunnel.probabilityConservation.toFixed(6)} · peak |ψ|² at x=${Number(tunnel.peakXNm).toFixed(3)} nm</p>
        <p class="sv-compact-boundary">κ ${tunnel.kappa.toExponential(3)} m⁻¹ · V₀ ${tunnel.barrierEv.toFixed(2)} eV · d ${tunnel.params.barrierThicknessNm.toFixed(2)} nm · m*/mₑ ${tunnel.params.effectiveMassRatio.toFixed(2)} · regime ${tunnel.regime}</p>
        <p class="sv-compact-boundary">Shared position axis ${tunnel.potential.xMinNm.toFixed(2)} → ${tunnel.potential.xMaxNm.toFixed(2)} nm · phase Et/ℏ at t=${timeFs.toFixed(3)} fs (${(WAVE_PHYSICAL_SECONDS_PER_DISPLAY_SECOND * 1e15).toFixed(1)} fs per display second)</p>
        ${this.deviceChainMarkup(device)}
      </section>
    `;
  }

  /**
   * @param {ReturnType<typeof buildSpinCellField>} spin
   * @param {ReturnType<TwinViewportController["deviceChain"]>} device
   */
  spinBoardMarkup(spin, device) {
    const ovf = this.canOwnViewport("particle_spin") === false;
    const simulated = spin.model.startsWith("python_llg_twin");
    const source = ovf
      ? `<span class="sv-prov-badge" data-class="SIMULATED">SIMULATED</span> Raw MuMax3 OVF frames`
      : simulated
        ? `<span class="sv-prov-badge" data-class="SIMULATED">SIMULATED</span> CPU Python macrospin LLG · uniform free-layer m(t) · not a mesh`
        : `<span class="sv-prov-badge" data-class="MODEL">MODEL</span> Waiting for Python LLG m(t)`;
    const dims = spin.parameters;
    const samples = this.pythonTrajectory();
    const displaySeconds = this.spinDisplaySeconds();
    const spanNs =
      samples.length >= 2 ? (samples[samples.length - 1].time - samples[0].time) * 1e9 : 0;
    const timebase = spanNs
      ? `<p class="sv-compact-boundary">Playback timebase: ${spanNs.toFixed(3)} ns of solver time over ${displaySeconds.toFixed(1)} s of display (${(spanNs / displaySeconds).toExponential(2)} ns per display second) · ${samples.length} solver samples · loop rate set to keep precession readable</p>`
      : "";
    return `
      <section class="sv-twin-metrics sv-viewport-board" aria-label="Spin viewport board">
        <p>${source}</p>
        ${timebase}
        <ul class="sv-board-legend">
          <li><span class="sv-swatch" style="background:${mzColor(1)}"></span>m<sub>z</sub>=+1 (P)</li>
          <li><span class="sv-swatch" style="background:${mzColor(0)}"></span>m<sub>z</sub>=0 (in-plane)</li>
          <li><span class="sv-swatch" style="background:${mzColor(-1)}"></span>m<sub>z</sub>=−1 (AP)</li>
          <li><span class="sv-glyph-key">→</span>arrow direction = displayed magnetization vector</li>
        </ul>
        <p class="sv-board-eq">Spin view arrows show magnetization only. Quantum probability remains in the separate Quantum Wave view.</p>
        <p class="sv-compact-boundary">${spin.metrics.alignment} · bit ${spin.bit} · lattice ${spin.nx}×${spin.freeRows} free / ${spin.nx}×${spin.referenceRows} reference · footprint ${(dims.freeLengthNm ?? 80).toFixed(1)} × ${(dims.freeWidthNm ?? 40).toFixed(1)} nm</p>
        <p class="sv-compact-boundary">z thicknesses: free ${(dims.freeThicknessNm ?? 1.2).toFixed(2)} nm · MgO ${(dims.barrierThicknessNm ?? 1).toFixed(2)} nm · reference ${(dims.referenceThicknessNm ?? 2.4).toFixed(2)} nm</p>
        ${this.deviceChainMarkup(device)}
      </section>
    `;
  }

  destroy() {
    this.pause();
    this.mounted = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.handleResize);
    }
  }
}

/**
 * @param {string} key
 * @param {string} label
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {number} step
 */
function slider(key, label, value, min, max, step) {
  return `<label class="sv-twin-slider">${label}
    <input data-twin-slider="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
    <span>${Number(value).toPrecision(4)}</span>
  </label>`;
}
