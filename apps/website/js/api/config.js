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
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isLoopbackApiUrl(url) {
  try {
    return isLoopbackHost(new URL(url, "http://127.0.0.1").hostname);
  } catch {
    return false;
  }
}

/**
 * Same-origin /api on a public hostname; local FastAPI on loopback.
 * @returns {string}
 */
export function defaultApiUrlForPage() {
  try {
    const location = browserScope().location;
    const hostname = location?.hostname ?? "";
    if (hostname && !isLoopbackHost(hostname) && location?.origin) {
      return location.origin.replace(/\/$/, "");
    }
  } catch {
    // ignore
  }
  return DEFAULT_API_URL;
}

/**
 * @returns {string}
 */
export function getApiBaseUrl() {
  const scope = browserScope();
  const pageIsPublic = (() => {
    try {
      const hostname = scope.location?.hostname ?? "";
      return Boolean(hostname) && !isLoopbackHost(hostname);
    } catch {
      return false;
    }
  })();
  if (runtimeApiUrl.trim()) {
    const runtime = runtimeApiUrl.trim().replace(/\/$/, "");
    if (!(pageIsPublic && isLoopbackApiUrl(runtime))) return runtime;
  }
  try {
    const fromQuery = new URLSearchParams(scope.location?.search ?? "").get("api");
    if (fromQuery && fromQuery.trim()) return fromQuery.trim().replace(/\/$/, "");
  } catch {
    // ignore URL parsing errors
  }
  try {
    const fromStorage = scope.localStorage?.getItem(API_URL_KEY);
    if (fromStorage && fromStorage.trim()) {
      const stored = fromStorage.trim().replace(/\/$/, "");
      if (!(pageIsPublic && isLoopbackApiUrl(stored))) return stored;
    }
  } catch {
    // ignore storage access errors
  }
  const fromWindow = scope.SPINVAULT_API_URL;
  if (typeof fromWindow === "string" && fromWindow.trim()) {
    const windowUrl = fromWindow.trim().replace(/\/$/, "");
    if (!(pageIsPublic && isLoopbackApiUrl(windowUrl))) return windowUrl;
  }
  return defaultApiUrlForPage();
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
