export type JsonObject = Record<string, unknown>;

export type VersionedRecord = {
  record_type: string;
  id: string;
  revision: number;
  record: JsonObject;
  sha256: string;
  created_at?: string;
};

export type RequirementRecord = {
  id: string;
  revision: number;
  requirement: JsonObject;
  sha256: string;
  created_at?: string;
};

export type ApiSnapshot = {
  apiUrl: string;
  webUrl: string;
  health: JsonObject | null;
  solvers: JsonObject | null;
  worker: JsonObject | null;
  records: Record<string, VersionedRecord[]>;
  requirements: RequirementRecord[];
  failures: string[];
};

const apiBase = (process.env.SPINVAULT_TWIN_API_URL ?? "http://127.0.0.1:8001").replace(/\/$/, "");
const webBase = (process.env.SPINVAULT_TWIN_WEB_URL ?? "http://127.0.0.1:4191").replace(/\/$/, "");

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function records(value: unknown): VersionedRecord[] {
  const rows = object(value)?.records;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is VersionedRecord => {
    const item = object(row);
    return Boolean(item && typeof item.id === "string" && typeof item.revision === "number" && object(item.record));
  });
}

function requirements(value: unknown): RequirementRecord[] {
  const rows = object(value)?.requirements;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is RequirementRecord => {
    const item = object(row);
    return Boolean(item && typeof item.id === "string" && typeof item.revision === "number" && object(item.requirement));
  });
}

export async function loadApiSnapshot(): Promise<ApiSnapshot> {
  const failures: string[] = [];
  const get = async (name: string, path: string) => {
    try {
      return await readJson(path);
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : "unavailable"}`);
      return null;
    }
  };

  const [healthRaw, solversRaw, workerRaw, deviceRaw, structureRaw, studyRaw, materialRaw, requirementsRaw] =
    await Promise.all([
      get("Health", "/health"),
      get("Solvers", "/api/solvers"),
      get("Worker", "/api/worker"),
      get("Devices", "/api/project-records/device"),
      get("Structures", "/api/project-records/structure"),
      get("Studies", "/api/project-records/study"),
      get("Materials", "/api/project-records/material"),
      get("Requirements", "/api/requirements"),
    ]);

  return {
    apiUrl: apiBase,
    webUrl: webBase,
    health: object(healthRaw),
    solvers: object(solversRaw),
    worker: object(workerRaw),
    records: {
      device: records(deviceRaw),
      structure: records(structureRaw),
      study: records(studyRaw),
      material: records(materialRaw),
    },
    requirements: requirements(requirementsRaw),
    failures,
  };
}

export function asObject(value: unknown): JsonObject {
  return object(value) ?? {};
}
