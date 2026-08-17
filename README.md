# SpinVault Twin

Digital twin platform for the SpinVault spintronic memory architecture.

## Run locally

- Windows 10/11: extract the package and double-click `RUN_ON_WINDOWS.bat`.
- macOS/Linux: run `scripts/run_local.sh`.
- Python 3.9+ is required. The first launch installs Python dependencies and
  therefore needs an internet connection once.

The default CPU LLGS twin does not require a GPU. See `SENDABLE_README.md` for
complete setup and scientific-scope notes.

## Planned Components

- Website (`apps/website`) — company site plus the SpinVault Twin UI at `simulator.html`.
- Engineering Simulator
- FastAPI Backend (`backend/`) — job submission, validation, demo executor, and not-configured solver adapters. See `backend/README.md`.
- Twin UI (`apps/website/simulator.html`) talks to the local API. MuMax3 runs only when `MUMAX3_BINARY` names a compatible local executable; it never falls back to another solver. Python LLG is a separate explicit macrospin target. Kwant and surrogate remain not configured.
- MuMax3 Micromagnetic Solver — backend adapter generates `.mx3` and executes only when `MUMAX3_BINARY` is configured
- Kwant Quantum Transport Solver
- AI Surrogate Models
- Optimization Engine
- Cloud/HPC Infrastructure
