# SpinVault Twin

## Build the local delivery archive

From a committed checkout, run `python3 scripts/build_local_package.py --output PATH`. The script builds a reproducible source-only ZIP from tracked files, writes a SHA-256 sidecar, preserves executable modes, checks ZIP CRCs, and refuses to replace either an existing archive or checksum. It excludes prior ZIPs, VCS data, local databases, caches, virtual environments, generated outputs, environment secrets, and the private Cloudflare config. The archive is a convenient local delivery artifact; it does not add solver acceptance, scientific calibration, or production deployment qualification.

Digital twin platform for the SpinVault spintronic memory architecture.

## Run locally

- Windows 10/11: extract the package and double-click `RUN_ON_WINDOWS.bat`.
- To publish the same stack at **https://spinvault.biz** from a Windows PC,
  follow `docs/HOSTING_WINDOWS.md` and double-click `HOST_ON_WINDOWS.bat`.
- macOS: extract the package and double-click `RUN_ON_MAC.command`, or run
  `scripts/run_local.sh` from Terminal. On Apple silicon with Python 3.11, the
  launcher installs from the hash-locked file
  `backend/requirements-macos-arm64-py311.lock`; other platforms use the
  declared minimum requirements until their environments are qualified.
- Linux: run `scripts/run_local.sh`.
- Python 3.9+ is required. The first launch installs Python dependencies and
  therefore needs an internet connection once.

To also start the live records/evidence overview, install the pinned Node
dependencies with `npm ci` in `apps/simulator`, then run
`scripts/run_workspace.sh`. It builds and serves the overview in production
mode by default and supervises it with the API and static tools. Set
`SPINVAULT_NEXT_MODE=development` only when actively editing the dashboard.
The overview is read-only and does not certify scientific records. To enable
the private, hash-checked requirements evidence workflow, configure its evidence
folder, review key, and (for same-cycle gates) project policy before launch; see
[`docs/LOCAL_EVIDENCE_CONFIGURATION.md`](docs/LOCAL_EVIDENCE_CONFIGURATION.md).

To check dependency-installer routing without starting the app or installing
packages, run `scripts/tests/run_local_dependency_selection.sh`. It covers the
qualified Apple silicon/Python 3.11 path and the generic Linux fallback using
isolated fake installer commands.

The default solver is a local Python 64×32×1 mesh LLGS run. It does not require
a GPU. See `SENDABLE_README.md` for complete setup and scientific-scope notes.

## Notebooks

`notebooks/pmtj_retention_and_leakage.ipynb` works the retention and barrier-leakage
side of the device in NumPy with matplotlib figures: Néel–Arrhenius dwell time and
the Tsu–Esaki tunnel current over the exact 1D barrier.

```bash
python3 -m pip install -r notebooks/requirements.txt
jupyter lab notebooks/pmtj_retention_and_leakage.ipynb
```

The physics lives in `backend/app/physics/device_chain.py` so the notebook and the
web dashboard share one implementation. `backend/tests/test_device_chain.py` pins
that module against golden values exported from the dashboard's JavaScript by
`scripts/export_device_chain_golden.mjs`. These are analytical models, not
measurements, and they are separate from the mesh solver's magnetization dynamics.

## NumPy + matplotlib Twin

With the local stack running, open:

http://127.0.0.1:4191/matplotlib-twin.html

This page submits a real queued `python_micromagnetic` 64×32×1 run. The local
worker renders a six-frame mesh overview, synchronized GIF, mean `m(t)`, energy
decomposition, final component maps, `nz=1` cross-sections, and numerical
diagnostics with matplotlib. Spatial panels are generated only from the returned
`spinvault-magnetization-npz-v1` frames; no domain sequence is prescribed.
The page exposes free-layer dimensions, footprint, material constants, damping,
polarization, drive, and temperature. Spatial maps use one continuous color mapping
of the computed spin direction (hue = in-plane angle, light = +z, dark = -z) with a
color key, resampled bilinearly between computed cell centers so transitions read as
gradients instead of cell blocks; the diagnostics panel keeps the same arrays as raw
per-cell values. Saturation is gamma-boosted so a few-degree tilt still reads as a
distinct hue. Panels whose title says "adaptive" use a 98th-percentile contrast
stretch with the numeric range printed, so narrow-range quantities such as
`mz - mean(mz)`, the component maps, and the `mz(x,t)` cut stay legible while the
absolute `-1 … +1` versions remain alongside them. A separate same-job analytical panel
uses the declared geometry, material, and barrier inputs for Néel–Brown retention
and Tsu–Esaki leakage; barrier inputs do not alter the LLGS solve.

## Planned Components

- Website (`apps/website`) — company site plus the SpinVault Twin UI at `simulator.html`.
- Engineering Simulator
- FastAPI Backend (`backend/`) — job submission, validation, demo executor, and not-configured solver adapters. See `backend/README.md`.
- Twin UI (`apps/website/simulator.html`) talks to the local API. The default solver is `python_micromagnetic` (local NumPy mesh). Python LLG is a separate explicit macrospin target. MuMax3 is not used in this package. Kwant and surrogate remain not configured.
- MuMax3 Micromagnetic Solver — backend adapter generates `.mx3` and executes only when `MUMAX3_BINARY` is configured
- Kwant Quantum Transport Solver
- AI Surrogate Models
- Optimization Engine
- Cloud/HPC Infrastructure
