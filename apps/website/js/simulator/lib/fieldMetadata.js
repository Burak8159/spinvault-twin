/**
 * Scientific field help is centralized so later solver integrations can reuse it.
 * "Used by demo" only means the value affects the schematic or fixture labels.
 */
export const SCIENTIFIC_FIELD_METADATA = {
  saturationMagnetization: {
    label: "Saturation magnetization",
    unit: "A/m",
    solver: "MuMax3 draft",
    usedByDemo: false,
    help: "Magnetic material parameter for future MuMax3 request generation. The frontend does not solve the Landau–Lifshitz–Gilbert equation."
  },
  exchangeStiffness: {
    label: "Exchange stiffness",
    unit: "J/m",
    solver: "MuMax3 draft",
    usedByDemo: false,
    help: "Micromagnetic material parameter intended for MuMax3 request generation. The frontend does not solve exchange interactions."
  },
  dampingAlpha: {
    label: "Damping alpha",
    unit: "dimensionless",
    solver: "MuMax3 draft",
    usedByDemo: false,
    help: "Dimensionless damping input for a future MuMax3 request. Only basic numeric integrity is checked here."
  },
  anisotropyConstant: {
    label: "Anisotropy constant",
    unit: "J/m^3",
    solver: "MuMax3 draft",
    usedByDemo: false,
    help: "Draft uniaxial anisotropy magnitude for future micromagnetic requests. No energy is computed in this browser."
  },
  polarization: {
    label: "Polarization",
    unit: "dimensionless",
    solver: "MuMax3 torque draft",
    usedByDemo: false,
    help: "Draft spin-polarization fraction for future torque request generation. It is not used by the demo fixture."
  },
  currentDensity: {
    label: "Current density",
    unit: "A/m^2",
    solver: "MuMax3 torque draft",
    usedByDemo: false,
    help: "Excitation metadata for a future torque configuration. It does not drive a solve loop in this phase."
  },
  externalField: {
    label: "External field",
    unit: "T",
    solver: "MuMax3 draft",
    usedByDemo: false,
    help: "Vector field draft for future micromagnetic requests. The viewport only reports the vector."
  },
  initialMagnetization: {
    label: "Initial magnetization",
    unit: "dimensionless",
    solver: "MuMax3 draft",
    usedByDemo: true,
    help: "Normalized direction draft for a future solver request. The viewport draws the direction; it does not evolve it."
  },
  meshCellSize: {
    label: "Mesh cell size",
    unit: "nm",
    solver: "MuMax3 draft",
    usedByDemo: false,
    help: "Discretization draft for MuMax3 request generation. Mesh execution happens only on the backend worker."
  },
  hoppingEnergy: {
    label: "Hopping energy",
    unit: "eV",
    solver: "Kwant draft",
    usedByDemo: false,
    help: "Transport-model draft intended only for a future Kwant module. Kwant is not connected."
  },
  onsiteEnergy: {
    label: "Onsite energy",
    unit: "eV",
    solver: "Kwant draft",
    usedByDemo: false,
    help: "Transport-model draft intended only for a future Kwant module. It is not mixed into micromagnetic inputs."
  },
  spinOrbitCoupling: {
    label: "Spin–orbit coupling",
    unit: "eV",
    solver: "Kwant draft",
    usedByDemo: false,
    help: "Transport Hamiltonian draft for a future Kwant module. The browser does not evaluate a Hamiltonian."
  }
};

