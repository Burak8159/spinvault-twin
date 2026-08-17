import { createDefaultState } from "./defaults.js";
import { validateScenario } from "./validation.js";

/**
 * @param {import("./types").SimulatorState} state
 * @returns {import("./types").SimulatorState}
 */
function withValidation(state) {
  const next = structuredClone(state);
  next.validation = validateScenario(next);
  return next;
}

/**
 * @returns {import("./types").WorkspaceSnapshot}
 */
function emptyWorkspace() {
  return {
    state: withValidation(createDefaultState()),
    status: "idle",
    result: null,
    error: null,
    logs: [],
    timeline: [],
    jobId: null,
    paused: false,
    lastJob: null
  };
}

/**
 * Central workspace store. Later prompts can serialize `state` to a backend request.
 */
export function createSimulatorStore() {
  /** @type {import("./types").WorkspaceSnapshot} */
  let snapshot = emptyWorkspace();
  /** @type {Set<(snapshot: import("./types").WorkspaceSnapshot) => void>} */
  const listeners = new Set();

  const emit = () => {
    const frozen = snapshot;
    listeners.forEach((listener) => listener(frozen));
  };

  return {
    get() {
      return snapshot;
    },
    /**
     * @param {(snapshot: import("./types").WorkspaceSnapshot) => void} listener
     */
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    /**
     * @param {Partial<import("./types").SimulatorState> | ((state: import("./types").SimulatorState) => import("./types").SimulatorState)} patch
     */
    updateState(patch) {
      const current = snapshot.state;
      const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
      snapshot = { ...snapshot, state: withValidation(next) };
      emit();
    },
    /**
     * @param {Partial<import("./types").WorkspaceSnapshot>} patch
     */
    updateWorkspace(patch) {
      snapshot = { ...snapshot, ...patch };
      if (patch.state) {
        snapshot.state = withValidation(patch.state);
      }
      emit();
    },
    /**
     * @param {import("./types").LogEntry} entry
     */
    appendLog(entry) {
      snapshot = { ...snapshot, logs: [...snapshot.logs, entry].slice(-80) };
      emit();
    },
    /**
     * @param {import("./types").TimelineEvent} event
     */
    appendTimeline(event) {
      snapshot = { ...snapshot, timeline: [...snapshot.timeline, event].slice(-20) };
      emit();
    },
    reset() {
      snapshot = emptyWorkspace();
      emit();
    }
  };
}
