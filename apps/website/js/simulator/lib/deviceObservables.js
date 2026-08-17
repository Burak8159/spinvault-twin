/**
 * Compact provenance classification for displayed quantities.
 * SIMULATED / DERIVED / MODEL / UNAVAILABLE — never upgrade a quantity.
 */

/** @typedef {"SIMULATED" | "DERIVED" | "MODEL" | "UNAVAILABLE"} ProvenanceClass */

/**
 * @param {import("./types").SimulationResult | null | undefined} result
 */
export function classifyDeviceObservables(result) {
  const series = result?.series ?? [];
  const metrics = result?.metrics ?? [];
  const hasOvf = Boolean(result?.artifacts?.frames?.length);
  const isMumax = result?.source === "mumax3" && result.isPhysicalSimulation;
  const isPythonLlg = result?.source === "python_llg_twin" && result.isPhysicalSimulation;
  const hasTableM = series.some((item) => /m[xyz]/i.test(`${item.id} ${item.label}`));
  const isPythonMesh = result?.source === "python_micromagnetic" && result.isPhysicalSimulation;
  const isSimulatedMeanM = (isMumax || isPythonLlg || isPythonMesh) && hasTableM;
  const hasEnergy = series.some((item) => /e_total|e_exch|e_demag|e_anis|energy/i.test(`${item.id} ${item.label}`));
  const hasKwant = result?.source === "kwant";
  const metric = (/** @type {string} */ id) => metrics.find((entry) => entry.id === id)?.displayValue ?? null;
  /**
   * @param {string} id
   * @param {string} label
   * @param {ProvenanceClass} klass
   * @param {string} value
   * @param {string} note
   */
  const row = (id, label, klass, value, note) => ({ id, label, klass, value, note });
  return [
    row(
      "m-field",
      "Magnetization field m(x,y,z)",
      isMumax || isPythonMesh ? "SIMULATED" : "UNAVAILABLE",
      hasOvf ? `${result?.artifacts?.frames?.length} mesh frame(s)` : "unavailable",
      isPythonMesh
        ? "Python finite-difference LLGS mesh. Not OVF. Not MuMax3."
        : "MuMax3 OVF magnetization only. The Python macrospin twin has no mesh."
    ),
    row(
      "mean-m",
      "Average magnetization <mx,my,mz>",
      isSimulatedMeanM ? "SIMULATED" : hasTableM ? "DERIVED" : "UNAVAILABLE",
      hasTableM ? "m(t) table" : "unavailable",
      isPythonLlg
        ? "CPU macrospin LLGS (one free-layer moment, Slonczewski STT, optional Brown field). Not a spatial average."
        : isPythonMesh
          ? "Spatial average over magnetic cells of the Python mesh."
          : "Spatially averaged MuMax3 table columns when present."
    ),
    row(
      "switching-time",
      "Switching time",
      metric("switching-completion-time") && metric("switching-completion-time") !== "unavailable"
        ? "DERIVED"
        : "UNAVAILABLE",
      metric("switching-completion-time") ?? "unavailable",
      "From mean-m threshold crossing; not a device spec."
    ),
    row(
      "energy",
      "Energy",
      hasEnergy ? "SIMULATED" : "UNAVAILABLE",
      hasEnergy ? "table energy columns" : "unavailable",
      "Energy components from the Python mesh (or parsed table columns). Unavailable when the solver does not return them."
    ),
    row(
      "resistance",
      "Resistance / TMR",
      "MODEL",
      "Julliere G(theta) on the 1D barrier conductance",
      "Analytical two-current model driven by the solved magnetization angle. Neither MuMax3 nor MgO band structure computes transport here."
    ),
    row(
      "retention",
      "Retention / energy barrier",
      "MODEL",
      "Neel-Arrhenius tau = tau_0 exp(K_eff V / k_B T)",
      "Macrospin single-domain barrier from the requested anisotropy, free-layer volume, and temperature. Attempt time is assumed 1 ns; not a product retention rating."
    ),
    row(
      "transmission",
      "Quantum transmission T(E)",
      hasKwant ? "SIMULATED" : "UNAVAILABLE",
      hasKwant ? "Kwant series" : "unavailable",
      "Unavailable until a transport solver is connected."
    )
  ];
}

/**
 * @param {ProvenanceClass} klass
 */
export function provenanceBadge(klass) {
  return `<span class="sv-prov-badge" data-class="${klass}">${klass}</span>`;
}
