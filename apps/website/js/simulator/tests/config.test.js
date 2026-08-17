import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_API_URL, getApiBaseUrl, setApiBaseUrl } from "../../api/config.js";

function installStorageStub() {
  const values = new Map();
  const original = globalThis.localStorage;
  globalThis.localStorage = /** @type {Storage} */ ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    }
  });
  return () => {
    if (original === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = original;
    }
  };
}

describe("API URL config", () => {
  it("uses saved Settings URL before the inline default", () => {
    const restoreStorage = installStorageStub();
    const originalUrl = globalThis.SPINVAULT_API_URL;
    globalThis.SPINVAULT_API_URL = "http://localhost:8001";
    localStorage.setItem("spinvault-api-url", "http://192.168.0.22:8001");

    try {
      assert.equal(getApiBaseUrl(), "http://192.168.0.22:8001");
    } finally {
      localStorage.removeItem("spinvault-api-url");
      if (originalUrl === undefined) {
        delete globalThis.SPINVAULT_API_URL;
      } else {
        globalThis.SPINVAULT_API_URL = originalUrl;
      }
      restoreStorage();
    }
  });

  it("uses explicit runtime setting before saved browser state", () => {
    const restoreStorage = installStorageStub();
    localStorage.setItem("spinvault-api-url", "http://192.168.0.22:8001");

    try {
      setApiBaseUrl("http://127.0.0.1:8001");
      assert.equal(getApiBaseUrl(), "http://127.0.0.1:8001");
    } finally {
      localStorage.removeItem("spinvault-api-url");
      setApiBaseUrl(DEFAULT_API_URL);
      restoreStorage();
    }
  });
});
