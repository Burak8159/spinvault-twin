# SpinVault Platform Architecture

This folder mirrors the target system design for the SpinVault simulation platform.

The current website is still a local prototype, but the repo is now organized around the parts needed for a real product:

- `client/` - public website, parameter controls, and future 3D/WebGL cell viewer.
- `gateway/` - API gateway and orchestration controller.
- `surrogate/` - fast physics-informed prediction layer for instant UI feedback.
- `validation/` - future high-fidelity simulation workers.
- `storage/` - experiment metadata and generated result archives.
- `governance/` - budget, reproducibility, and evidence-control logic.
- `quantum-future/` - placeholder for future quantum hardware integration experiments.

The first working gateway implementation currently lives in `../orchestration/`.
