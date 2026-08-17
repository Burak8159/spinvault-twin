/**
 * Lightweight path helpers shared by the workspace controller.
 */

/**
 * @param {any} root
 * @param {string} path
 * @returns {any}
 */
export function getPath(root, path) {
  return path.split(".").reduce((value, key) => value?.[key], root);
}

/**
 * Returns a cloned state with a nested value replaced.
 * @param {import("./types").SimulatorState} state
 * @param {string} path
 * @param {unknown} value
 */
export function setPath(state, path, value) {
  /** @type {any} */
  const next = structuredClone(state);
  const keys = path.split(".");
  const finalKey = keys.pop();
  const parent = keys.reduce((cursor, key) => cursor[key], next);
  if (finalKey) parent[finalKey] = value;
  return next;
}

/**
 * Compare only viewport-driving fields to avoid redraw thrash.
 * @param {import("./types").SimulatorState} state
 */
export function viewportSignature(state) {
  return JSON.stringify({
    geometry: state.geometry,
    materials: state.materials,
    selectedRegion: state.controls.selectedRegion,
    viewportZoom: state.controls.viewportZoom,
    currentDirection: state.controls.currentDirection,
    initialMagnetization: state.initialMagnetization,
    externalField: state.externalField
  });
}
