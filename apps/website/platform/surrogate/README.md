# AI Surrogate Layer

Purpose:

- Return near-instant predictions during slider interaction.
- Approximate expensive physics outputs before running full validation.
- Rank parameter sets worth deeper compute.

Current implementation:

- Physics-informed formulas in `../orchestration/app/physics.py`.
- Finite-barrier transmission estimate.
- Spin polarization / TMR estimate.
- Thermal and disturbance margin estimates.

Production direction:

- Train a surrogate from high-fidelity validation runs.
- Version every model.
- Store the model version with every prediction.
