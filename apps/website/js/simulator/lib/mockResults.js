/**
 * Development fixtures for the results panel.
 * These series are labeled demo output and must not be treated as physical results.
 */

/**
 * @param {import("./types").SimulatorState} state
 * @returns {import("./types").SimulationResult}
 */
export function createMockResult(state) {
  const duration = Math.max(1, state.controls.duration.value);
  const pointCount = 24;
  /** @type {import("./types").ResultSeriesPoint[]} */
  const mzPoints = [];
  /** @type {import("./types").ResultSeriesPoint[]} */
  const currentPoints = [];
  const serializedInput = JSON.stringify({
    geometry: state.geometry,
    materials: state.materials,
    torque: state.torque,
    initialMagnetization: state.initialMagnetization,
    externalField: state.externalField,
    solverDrafts: state.solverDrafts
  });
  let hash = 2166136261;
  for (let index = 0; index < serializedInput.length; index += 1) {
    hash ^= serializedInput.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  for (let index = 0; index < pointCount; index += 1) {
    const t = (index / (pointCount - 1)) * duration;
    const phase = index / (pointCount - 1);
    mzPoints.push({
      x: t,
      y: Number((0.82 - 0.18 * phase + 0.04 * Math.sin(phase * 6)).toFixed(3))
    });
    currentPoints.push({
      x: t,
      y: Number(((state.controls.currentDirection === "positive_z" ? 1 : -1) * (0.4 + 0.2 * Math.sin(phase * 4))).toFixed(3))
    });
  }

  return {
    source: "demo_fixture",
    isPhysicalSimulation: false,
    summary: "Demo fixture only. Chart values are placeholders for layout review, not a solved magnetization trajectory.",
    series: [
      {
        id: "mz-demo",
        label: "mz (demo fixture)",
        xLabel: "Time",
        xUnit: state.controls.duration.unit,
        yLabel: "mz",
        yUnit: "dimensionless",
        points: mzPoints
      },
      {
        id: "current-demo",
        label: "Current marker (demo fixture)",
        xLabel: "Time",
        xUnit: state.controls.duration.unit,
        yLabel: "Direction marker",
        yUnit: "dimensionless",
        points: currentPoints
      }
    ],
    metrics: [
      {
        id: "switching-marker",
        label: "Switching marker",
        displayValue: "n/a",
        unit: "dimensionless",
        note: "Not computed. Demo fixture has no switching criterion."
      },
      {
        id: "energy-marker",
        label: "Energy density marker",
        displayValue: "n/a",
        unit: "dimensionless",
        note: "Not computed. No micromagnetic energy model is connected."
      },
      {
        id: "tmr-marker",
        label: "TMR marker",
        displayValue: "n/a",
        unit: "dimensionless",
        note: "Not computed. Kwant/transport is not connected."
      }
    ],
    provenance: {
      createdAt: new Date().toISOString(),
      createdBy: "demo_fixture",
      solver: "demo",
      solverVersion: "ui-shell-1c",
      inputHash: `demo-fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`,
      notes: [
        "Demo output",
        "source=demo_fixture",
        "isPhysicalSimulation=false",
        "Prepared for MuMax3 request generation; not connected.",
        "Kwant integration pending.",
        "Surrogate model not connected."
      ]
    }
  };
}
