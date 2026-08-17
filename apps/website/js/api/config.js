/**
 * Backend URL and demo execution mode for the static Twin UI.
 * Vanilla site: configure via window.SPINVAULT_API_URL, localStorage, or Settings.
 * Default matches the local FastAPI process used in Prompt #2 review (:8001).
 */

const API_URL_KEY = "spinvault-api-url";
const DEMO_MODE_KEY = "spinvault-demo-execution";
let runtimeApiUrl = "";

/** @type {string} */
export const DEFAULT_API_URL = "http://localhost:8001";

/** @returns {Window & { SPINVAULT_API_URL?: string }} */
function browserScope() {
  return /** @type {Window & { SPINVAULT_API_URL?: string }} */ (/** @type {unknown} */ (globalThis));
}

/**
 * @returns {string}
 */
export function getApiBaseUrl() {
  const scope = browserScope();
  if (runtimeApiUrl.trim()) return runtimeApiUrl.trim().replace(/\/$/, "");
  try {
    const fromQuery = new URLSearchParams(scope.location?.search ?? "").get("api");
    if (fromQuery && fromQuery.trim()) return fromQuery.trim().replace(/\/$/, "");
  } catch {
    // ignore URL parsing errors
  }
  try {
    const fromStorage = scope.localStorage?.getItem(API_URL_KEY);
    if (fromStorage && fromStorage.trim()) return fromStorage.trim().replace(/\/$/, "");
  } catch {
    // ignore storage access errors
  }
  const fromWindow = scope.SPINVAULT_API_URL;
  if (typeof fromWindow === "string" && fromWindow.trim()) {
    return fromWindow.trim().replace(/\/$/, "");
  }
  return DEFAULT_API_URL;
}

/**
 * @param {string} url
 */
export function setApiBaseUrl(url) {
  const cleaned = url.trim().replace(/\/$/, "") || DEFAULT_API_URL;
  runtimeApiUrl = cleaned;
  const scope = browserScope();
  try {
    scope.SPINVAULT_API_URL = cleaned;
  } catch {
    // Some controlled browser contexts make window non-extensible.
  }
  try {
    scope.localStorage?.setItem(API_URL_KEY, cleaned);
  } catch {
    // ignore
  }
  return cleaned;
}

/**
 * @returns {"local" | "backend"}
 */
export function getDemoExecutionMode() {
  try {
    const stored = browserScope().localStorage?.getItem(DEMO_MODE_KEY);
    if (stored === "backend" || stored === "local") return stored;
  } catch {
    // ignore
  }
  return "local";
}

/**
 * @param {"local" | "backend"} mode
 */
export function setDemoExecutionMode(mode) {
  const next = mode === "backend" ? "backend" : "local";
  try {
    browserScope().localStorage?.setItem(DEMO_MODE_KEY, next);
  } catch {
    // ignore
  }
  return next;
}
