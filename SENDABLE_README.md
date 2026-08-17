# SpinVault Twin — local sendable package

This package is the local digital-twin stack:

- static Twin UI (`apps/website`)
- FastAPI backend + Python LLG solver (`backend`)
- one-command launchers for Windows, macOS, and Linux

No cloud service is required. MuMax3 is optional and only runs if you set
`MUMAX3_BINARY` to a real local NVIDIA/CUDA MuMax3 executable.

## Requirements

- Python 3.9+
- Windows 10/11, macOS, or Linux
- Network once for the first `pip install` of backend dependencies

## Start on Windows

1. Extract the zip completely.
2. Double-click **`RUN_ON_WINDOWS.bat`**.
3. Keep the terminal window open. The simulator opens automatically in the
   default browser.

No WSL, Git Bash, PowerShell configuration, Node.js, GPU, or administrator
access is required. If Python is missing, the launcher explains where to
install it. During Python installation, select **Add python.exe to PATH**.

Windows SmartScreen may show a warning because the batch file is not
code-signed. Choose **More info → Run anyway** only if this zip came from
someone you trust.

## Start on macOS or Linux

```bash
cd spinvault-twin
chmod +x scripts/run_local.sh
scripts/run_local.sh
```

Then open:

- Simulator: http://127.0.0.1:4191/simulator.html
- Website:   http://127.0.0.1:4191/index.html
- API docs:  http://127.0.0.1:8001/docs

Stop either launcher with Ctrl+C.

If ports are busy:

```bash
SPINVAULT_API_PORT=8055 SPINVAULT_WEB_PORT=4455 scripts/run_local.sh
```

and open:

http://127.0.0.1:4455/simulator.html?api=http://127.0.0.1:8055

## What runs by default

- `python_llg`: CPU macrospin Landau–Lifshitz–Gilbert–Slonczewski on this machine
- Quantum Wave view: analytical 1D barrier Schrödinger model
- MuMax3: only when `MUMAX3_BINARY` points at a compatible local binary

A MuMax3 request without a binary returns `not_configured`. It does **not**
silently invent MuMax3 results.

## The physics that is actually integrated

The free layer is one macrospin obeying

```text
dm/dt = -γ' m×B_eff - γ'α m×(m×B_eff) - γ' a_J m×(m×p) + γ' α a_J m×p
```

with the Slonczewski amplitude and angular efficiency

```text
a_J = ħ η(θ) J / (2 e M_s t_free)
η(θ) = P Λ² / [(Λ²+1) + (Λ²-1) cos θ]
```

Consequences you can check by moving the controls:

- **Write current is real.** Positive J drives toward parallel, negative J
  toward antiparallel. Below the threshold the bit does not flip.
- **Threshold is reported, not asserted.** `Jc0 = 4 e α K_eff t / (ħ η₀)`
  appears in the run metrics next to the applied J and the ratio J/Jc0.
- **Temperature is in the equation of motion.** T > 0 adds the Brown field
  `σ = sqrt(2 α k_B T / (M_s γ V Δt))` and the integrator switches from
  deterministic RK4 to stochastic Heun. T = 0 is reproducible.
- **Static presets hold.** Run state 0 / 1 set the write current to zero so
  the stored bit is not being pushed by a current that should be off.

Analytical device chain evaluated on the same parameters:

- Retention: `K_eff = K_u1 - μ₀M_s²/2`, `Δ = K_eff V / k_B T`, `τ = τ₀ e^Δ`
- Leakage: Tsu–Esaki integrated over the same 1D transmission `T(E)` the
  Quantum Wave view plots
- Resistance: Julliere `G(θ) = G(1 + P² cos θ)` using cos θ from the solved
  magnetization

## Optional MuMax3

On a machine with NVIDIA CUDA and MuMax3 installed:

```bash
export MUMAX3_BINARY=/path/to/mumax3
scripts/run_local.sh
```

Then choose the MuMax3 solver / V01 equilibrium experiment in the UI.

## Honesty notes

- This is a **macrospin** twin: one free-layer moment, no spatial mesh, no
  exchange field, no domain nucleation. Real reversal nucleates, so the
  coherent-rotation `Jc0` reported here **overestimates** a real device.
- The pinned layer is a fixed polarizer, not a dynamical second layer.
- Retention, leakage, and TMR are **analytical models** (Néel–Arrhenius,
  Tsu–Esaki, Julliere), not device solvers, and are labeled MODEL in the UI.
- Barrier height, tunneling effective mass, and the lead Fermi level are
  placeholders, not reviewed values.
- Material presets are review labels, not calibrated device cards.
- Nothing here is calibrated against a fabricated device or NEGF transport.
- See `docs/PHYSICS_AUDIT.md` for the current scientific status.

## Run the tests

```bash
cd backend && python3 -m pytest -q
cd ../apps/website && npm test
```

## Package contents

```text
apps/website/     Twin UI + company site
backend/          FastAPI + solvers + tests
docs/             Physics audit and prompts
scripts/          Local run helpers
RUN_ON_WINDOWS.bat Native Windows launcher
SENDABLE_README.md
README.md
```
