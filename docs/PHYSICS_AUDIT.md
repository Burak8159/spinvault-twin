# SpinVault Twin Physics Audit

Audit date: 2026-08-17  
Checkpoint scope: repository audit, MuMax3 execution verification, reference pMTJ readiness, V01 equilibrium readiness, raw-output provenance

## Executive finding

The repository is **not yet a validated MTJ digital twin**.

The backend contains a real MuMax3 integration path: it can generate a `.mx3`
script, execute a configured local binary, preserve raw output, parse MuMax3
tables and OVF vector fields, and expose those results to the UI. However, that
path has never completed on this checkout. No local MuMax3 executable is
configured, and the archived job directories contain no generated `.mx3`
script from a real run.

Current successful default runs use `python_llg_twin`, a deterministic,
single-macrospin Landau–Lifshitz–Gilbert approximation. That is not a spatial
micromagnetic mesh and must not be presented as MuMax3.

The current application also contains:

- synthetic demo curves;
- schematic pre-run magnetization fields;
- a separate analytical one-dimensional barrier scattering model;
- placeholder material and transport parameters;
- display arrows whose direction can be overridden toward a probability peak
  rather than showing magnetization;
- no implemented retention model in the Twin result path;
- no thermal stochastic field;
- no exchange-length or mesh-convergence validation.

Overall scientific status: **UNVALIDATED**

## Classification vocabulary

- `REAL_SOLVER`: values parsed directly from an executed external solver.
- `ANALYTICAL_MODEL`: values evaluated from a stated equation and assumptions.
- `APPROXIMATION`: numerical physical model with documented omitted physics.
- `VISUALIZATION_ONLY`: geometry or interpolation for display, not scientific output.
- `PLACEHOLDER`: synthetic, demo, unvalidated default, or future interface.
- `UNKNOWN`: origin cannot be established.

## Architecture

### Active application

- Frontend: static HTML/CSS/ES modules under `apps/website/`.
- API: FastAPI under `backend/app/`.
- Job execution: in-process worker and memory queue under
  `backend/app/workers/`.
- MuMax3 adapter: `backend/app/solvers/mumax3/`.
- Local approximation: `backend/app/solvers/python_llg/`.
- Frontend analytical barrier model:
  `apps/website/js/simulator/lib/tunnelingModel.js`.

### Inactive or separate code

- `apps/simulator/` is a Next.js scaffold and is not the active simulator.
- `apps/website/orchestration/` is a separate prototype with analytical proxy
  metrics. It is not the active MuMax3 pipeline.
- `apps/website/script.js` contains marketing-site canvas visualizations. These
  are not solver output.

## Major feature classification

| Feature | Classification | Evidence / limitation |
|---|---|---|
| MuMax3 table `m_x,m_y,m_z` and energy columns | `REAL_SOLVER` when `result.source == "mumax3"` | Parser exists, but no completed local run is present |
| MuMax3 OVF field `m(x,y,z,t)` | `REAL_SOLVER` when loaded from archived OVF | Text and Binary 4/8 parser exists; no real local run yet |
| Python LLG trajectory | `APPROXIMATION` | One macrospin, deterministic RK4, thin-film demagnetization approximation, no exchange field |
| Demo result curves | `PLACEHOLDER` | Hard-coded sinusoidal fixture; explicitly non-physical |
| Pre-run spin lattice | `VISUALIZATION_ONLY` | Procedural target state and seeded disorder |
| Spin arrows redirected toward `|psi|^2` peak | `VISUALIZATION_ONLY` | Arrow direction is not magnetization direction |
| 1D rectangular/trapezoidal wave model | `ANALYTICAL_MODEL` | Effective-mass TISE scattering; not MuMax3, Kwant, NEGF, or MTJ transport |
| Wave phase animation | `ANALYTICAL_MODEL` plus display time scaling | Uses `exp(-iEt/hbar)` for the analytical stationary state |
| Switching classification | `APPROXIMATION` derived from solver data | Threshold applied to mean magnetization; not a separate physical solve |
| Display interpolation between samples | `VISUALIZATION_ONLY` | Scrubbing/plot interpolation only |
| OVF display downsampling | `VISUALIZATION_ONLY` | Spatial bin averages of real cells; does not invent domains |
| Material selectors | `PLACEHOLDER` | IDs and summaries do not authoritatively update solver constants |
| TMR/resistance | `PLACEHOLDER` / unavailable | No connected transport model in Twin |
| Retention | `PLACEHOLDER` / unavailable | No `K_eff V / k_B T` plus validated lifetime model in Twin |
| Leakage risk helper | `APPROXIMATION` | Ad hoc monotone mapping from analytical transmission; not leakage current |
| Thermal behavior | `PLACEHOLDER` | Temperature is not mapped to MuMax3 or stochastic LLG |
| Kwant | `PLACEHOLDER` | Adapter returns `not_configured` |
| Surrogate | `PLACEHOLDER` | Adapter returns `not_configured` |

## MuMax3 provenance chain

The intended real-solver chain is:

1. User parameters in `apps/website/simulator.html`.
2. Store state and serialization in
   `apps/website/js/api/serialize.js`.
3. `POST /api/simulations` in `backend/app/api/routes.py`.
4. Request validation in
   `backend/app/solvers/mumax3/validate_request.py`.
5. `.mx3` generation in `backend/app/solvers/mumax3/script.py`.
6. Job archive preparation in
   `backend/app/solvers/mumax3/adapter.py` and
   `backend/app/solvers/mumax3/runner.py`.
7. Local command execution:
   `[MUMAX3_BINARY, "generated.mx3"]`, with the run directory as working
   directory.
8. Raw MuMax3 `.out` files copied into the stable `outputs/` directory.
9. MuMax3 table parsing in `backend/app/workers/parser.py`.
10. OVF discovery and vector parsing in
    `backend/app/solvers/mumax3/frames.py`.
11. Processed result construction in
    `backend/app/workers/local_worker.py`.
12. API job/result/frame endpoints in `backend/app/api/routes.py`.
13. Frontend result mapping in `apps/website/js/api/jobMapper.js`.
14. Table plots and OVF playback in
    `apps/website/js/simulator/components/scientificBoard.js` and
    `mumax3FrameAnimator.js`.

### Current break

The chain currently breaks at step 7 because no executable is configured or
detected. Consequently, current UI output cannot be classified as
`REAL_SOLVER`.

## MuMax3 executable and execution status

- Configuration key: `MUMAX3_BINARY` or `SPINVAULT_MUMAX3_BINARY`.
- Path lookup implementation: `backend/app/solvers/mumax3/runner.py`.
- Expected test command: `<binary> -v`.
- Exact executable found: **NONE at audit time**.
- Version: **UNAVAILABLE**.
- Execution result: **NOT EXECUTED**.
- Existing archived `generated.mx3` files: **0**.
- Existing completed real MuMax3 runs: **0**.

Until an executable is installed and configured, the V01 real-solver checkpoint
is blocked. The application must return `NOT IMPLEMENTED / MODEL REQUIRED` or a
clear MuMax3-not-configured failure for a MuMax3 request. A different solver
must not be silently substituted.

## Generated script and mapped parameters

`backend/app/solvers/mumax3/script.py` currently maps:

- grid dimensions;
- cell dimensions in metres;
- saturation magnetization in A/m;
- exchange stiffness in J/m;
- damping alpha;
- initial magnetization;
- free-layer ellipse or rectangle geometry;
- external field in tesla;
- uniaxial anisotropy and anisotropy axis for switching v1;
- field-pulse amplitude and duration for switching v1;
- total simulation duration;
- table and OVF output intervals.

It explicitly omits:

- MgO transport;
- reference-layer dynamics;
- TMR and resistance;
- current-driven STT/SOT;
- thermal field;
- retention and leakage.

The barrier and reference-layer thicknesses are recorded in the request but do
not enter the MuMax3 free-layer model.

## Raw data preservation

When a real MuMax3 run is attempted, the intended archive is
`backend/data/mumax_jobs/<job_id>/` and contains:

- `request.json`;
- `generated.mx3`;
- `stdout.log`;
- `stderr.log`;
- native MuMax3 `.out` directory;
- stable copied `outputs/`;
- `result.json`;
- `artifacts.json`;
- `status.json`.

Gaps:

- the requested canonical names `input_parameters.json` and
  `run_metadata.json` are not both present;
- the exact executed command and exit status are not yet consolidated into one
  mandatory metadata document;
- `.ovf.gz` is unsupported;
- the default memory job store loses API records on restart, although disk
  artifacts remain;
- there is no processing-version field that independently versions the parser.

## Units

The MuMax3 interface converts accepted quantities to SI:

- length: m;
- time: s;
- magnetic field: T;
- magnetization: A/m;
- exchange stiffness: J/m;
- anisotropy: J/m3;
- current density: A/m2;
- temperature: K.

The current unit conversion code is centralized in
`backend/app/solvers/mumax3/units.py`, but the authoritative parameter schema is
not yet centralized across frontend, backend, experiments, and provenance.

Scientific gaps:

- common literature units such as Oe and kA/m are not supported;
- the UI and API validate syntax/ranges more than physical feasibility;
- material dropdowns do not authoritatively propagate `M_s`, `A_ex`, alpha, and
  `K_u` into the solver draft;
- several parameter defaults lack citations and are therefore
  `UNVALIDATED_DEFAULT`.

## Reference device status

The current default resembles an elliptical pMTJ free layer:

- lateral dimensions: 80 nm x 40 nm;
- free-layer thickness: 1.2 nm;
- grid: 64 x 32 x 2;
- cells: 1.25 nm x 1.25 nm x 0.6 nm;
- `M_s`: 1.0e6 A/m;
- `A_ex`: 1.0e-11 J/m;
- alpha: 0.01;
- `K_u`: 8.0e5 J/m3 for the switching preset.

These are not yet a provenance-backed reference parameter set. They must be
classified as `UNVALIDATED_DEFAULT` until citations and applicability are
documented.

The UI renders reference and barrier layers, but the MuMax3 model currently
simulates only the free magnetic layer. The rendered z thicknesses are
deliberately exaggerated. The pre-run display lattice is not the MuMax3 mesh.

## Mesh assessment

The required exchange-length criterion is:

`l_ex = sqrt(2 A_ex / (mu_0 M_s^2))`

For the current unvalidated defaults:

- `A_ex = 1.0e-11 J/m`;
- `M_s = 1.0e6 A/m`;
- `l_ex` is approximately 3.99 nm;
- lateral cell size is 1.25 nm;
- thickness cell size is 0.6 nm.

The default cell dimensions are smaller than the calculated exchange length,
which is a plausible first criterion. This is not proof of convergence.

Current defects:

- exchange length is not calculated by the application;
- mesh quality is not reported;
- users can choose physically poor cell sizes without an exchange-length
  warning;
- no mesh-convergence experiment has been executed;
- quantitative accuracy must not be claimed.

## Physical model audit

### Python LLG

The implemented deterministic macrospin equation is dimensionally consistent
for the documented approximation. It includes:

- precession and Gilbert damping;
- uniaxial anisotropy;
- external magnetic field;
- a thin-film out-of-plane demagnetizing approximation.

It omits:

- spatial exchange;
- a real magnetostatic field solve;
- thermal stochastic field;
- STT/SOT;
- barrier/reference dynamics;
- transport.

The Python switching drive is not equivalent to the MuMax3 field-pulse script:
it uses a full-duration drive with a hard-axis seed, while MuMax3 uses a
finite-duration axial pulse followed by relaxation. Results are not
interchangeable.

### Quantum barrier model

The frontend evaluates a one-dimensional effective-mass Schrödinger scattering
problem for a rectangular or discretized trapezoidal barrier. This is an
`ANALYTICAL_MODEL`, not a quantum MTJ transport solver.

It does not model:

- three-dimensional CoFeB/MgO band structure;
- symmetry filtering;
- spin-dependent density of states;
- electrode interfaces;
- NEGF;
- bias-dependent self-consistent potential;
- conductance or RA product.

The current spin-state and polarization inputs do not change the computed
transmission. Default barrier height, effective mass, and bias are placeholders.

### Retention and leakage

No trustworthy retention or leakage model is implemented in the active Twin
result path.

Missing retention baseline:

- `K_eff`;
- magnetic volume;
- `E_b = K_eff V`;
- `Delta = E_b / (k_B T)`;
- explicit attempt frequency and a documented Neel-Brown validity range.

Missing leakage model:

- voltage/current boundary conditions;
- junction area and barrier model tied to conductance;
- validated material/bias parameters;
- measured or physics-based RA / I-V relation.

Current conceptual gauges must not be displayed as device retention or leakage.

## Parameter propagation findings

Parameters that reach MuMax3:

- free-layer lateral geometry and thickness consistency checks;
- mesh/grid;
- `M_s`, `A_ex`, alpha;
- external field;
- initial magnetization;
- simulation duration;
- `K_u`, anisotropy axis, field pulse for switching v1.

Parameters that do not currently reach applicable physics:

- material IDs do not set solver constants;
- barrier/reference thicknesses do not enter MuMax3;
- temperature does not enter MuMax3 or Python LLG;
- current density, polarization, and torque mechanism do not produce STT/SOT;
- quantum controls are viewport-local and do not enter the backend;
- Python LLG ignores mesh, geometry, and `A_ex`.

## Misleading or synthetic features

The following must be removed from scientific mode or kept behind an
unmistakable `SCHEMATIC / DEMO — NOT SOLVER DATA` mode:

1. Sinusoidal demo magnetization/current curves.
2. Timed demo job-status choreography.
3. Procedural pre-run spin disorder and transition arcs.
4. Free-layer magnetization arrows redirected toward a quantum probability
   peak.
5. Marketing-site schematic wave/spin canvases.
6. Retention, leakage, attack, and TMR proxy composites in the orchestration
   prototype.
7. A missing-MuMax3 request completing as a different solver result.

Legitimate display-only processing that may remain with provenance:

- linear plot-marker interpolation between real samples;
- frame selection for scrubbing;
- spatial bin averaging of real OVF cells;
- documented time dilation for analytical wave phase.

## Validation experiment status

| Experiment | Status |
|---|---|
| V01 equilibrium | `NOT IMPLEMENTED / MODEL REQUIRED` as an executed MuMax3 experiment |
| V02 P/AP | `NOT VALIDATED` |
| V03 hysteresis | `NOT IMPLEMENTED / MODEL REQUIRED` |
| V04 dynamics | `NOT VALIDATED` for MuMax3 |
| V05 STT switching | `NOT IMPLEMENTED / MODEL REQUIRED` |
| V06 thermal | `NOT IMPLEMENTED / MODEL REQUIRED` |

## Required first checkpoint

The next implementation must not start with dashboard work. It must:

1. require an actual local MuMax3 executable for a MuMax3 request;
2. define a provenance-marked reference pMTJ free-layer parameter set;
3. calculate exchange length and validate the candidate mesh;
4. generate one V01 equilibrium `.mx3`;
5. execute MuMax3 locally;
6. preserve command, version, inputs, script, stdout, stderr, table, OVF, and
   processed output;
7. parse final mean magnetization and the final raw vector field;
8. display only those parsed values and vectors;
9. provide an automated provenance comparison from raw output to plotted data.

If no compatible MuMax3 executable can be installed on the host, the checkpoint
must stop with:

`NOT IMPLEMENTED / MODEL REQUIRED`

No macrospin, demo, or analytical fallback may be substituted for that
MuMax3 experiment.

## 2026-08-17 checkpoint result

### Existing system

- Real MuMax3 script generation, subprocess runner, table parser, OVF parser,
  archive writer, API frame endpoint, and raw-vector renderer exist.
- Python LLG remains available only when explicitly requested as
  `python_llg`.
- The analytical 1D barrier model remains separate from MuMax3 and is not an
  MTJ transport result.

### Repairs completed before execution

- Removed the missing-MuMax3 to Python-LLG fallback from both synchronous and
  worker execution paths.
- Removed the frontend 422 retry that silently changed `switching_v1` into
  `v0_visible`.
- Added the `reference_pmtj_v01_equilibrium` experiment.
- Added an authoritative SI reference parameter manifest; every numeric
  default is marked `UNVALIDATED_DEFAULT`.
- Added exchange-length calculation and a declared mesh precheck.
- Added initial and equilibrium OVF saves around MuMax3 `relax()`.
- Added `input_parameters.json`, `reference_parameters.json`, and
  `run_metadata.json`.
- Removed production spin-arrow redirection toward the analytical quantum
  probability peak. Spin arrows now represent magnetization direction.

### MuMax3 status

- Host: `Darwin arm64`.
- GPU: Apple M4; no NVIDIA runtime (`nvidia-smi` absent).
- `MUMAX3_BINARY`: unset.
- `mumax3` on `PATH`: not found.
- Common local executable paths probed: none found.
- Exact version: unavailable.
- Subprocess command: not created because there is no executable.
- Execution status: `not_configured`.

MuMax3 is CUDA/NVIDIA software. This Apple-silicon-only host cannot satisfy the
required real local MuMax3 execution checkpoint without access to a compatible
local NVIDIA Linux/Windows machine. Docker on this Mac does not provide an
NVIDIA CUDA device and therefore is not a scientifically valid workaround.

### Prepared V01 input

Archive:

`backend/data/mumax_jobs/audit_v01_equilibrium_20260817/`

Generated script:

`backend/data/mumax_jobs/audit_v01_equilibrium_20260817/generated.mx3`

Parameters:

- circular free layer, diameter 40 nm;
- thickness 1.2 nm;
- `M_s = 1.0e6 A/m`;
- `A_ex = 1.0e-11 J/m`;
- `K_u = 8.0e5 J/m3`;
- `alpha = 0.01`;
- zero external field;
- zero temperature;
- initial `m = (0.1, 0, 0.9949874371)`;
- mesh `32 x 32 x 2`;
- cells `1.25 x 1.25 x 0.6 nm`.

All numeric values above remain `UNVALIDATED_DEFAULT`.

### Mesh precheck

- exchange length: `3.98942e-9 m` (3.98942 nm);
- maximum cell dimension: 1.25 nm;
- `max(cell) / l_ex = 0.3133`;
- declared criterion: `max(dx,dy,dz) <= 0.5 l_ex`;
- precheck: `PASS_PRECHECK`;
- mesh convergence: **false / not established**.

### First real simulation

`NOT IMPLEMENTED / MODEL REQUIRED`

No MuMax3 process started. Therefore:

- runtime: unavailable;
- MuMax3 stdout/stderr: unavailable;
- table output: unavailable;
- OVF output: unavailable;
- final average magnetization: unavailable;
- energy behavior: unavailable;
- parser-to-UI proof for a real run: unavailable.

The failure is preserved in:

- `run_metadata.json`;
- `status.json`;
- `artifacts.json`;
- the generated `.mx3`;
- the exact input and reference parameter manifests.

### Validation tests

- Backend: 99 passed, 1 skipped.
- The skipped test is the real-binary availability test gated by
  `MUMAX3_BINARY`.
- Frontend: 125 passed.
- Frontend TypeScript check: passed.

Mocked subprocess tests verify parser and archive plumbing but are not evidence
that MuMax3 executed.

### Data provenance status

The intended real chain remains:

`MuMax3 table/OVF -> parser -> SimulationResult/frame endpoint -> graph/field`

For this checkpoint, the chain stops before MuMax3:

`user/reference parameters -> generated.mx3 -> NOT CONFIGURED`

No numerical result or field is displayed as MuMax3 output.

### Remaining problems

1. Compatible local NVIDIA host and real MuMax3 executable are absent.
2. Reference values need literature citations and applicability review.
3. V01 has not executed and therefore has no physical result.
4. Mesh convergence has not been performed.
5. Real table-to-OVF consistency has not been measured.
6. No thermal, STT, transport, retention, leakage, or quantum-transport model
   is implemented for the reference device.
7. Demo/schematic code still exists outside scientific V01 mode and must remain
   unmistakably labeled.

### Next experiment

Do not proceed to V02. The next action is to run **V01 equilibrium only** on a
compatible local NVIDIA host with `MUMAX3_BINARY` set, then verify the raw table
and final OVF averages agree before accepting any UI result.
