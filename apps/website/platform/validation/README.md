# Heavy Validation Compute

Purpose:

- Run the slow simulations that should not block the website.
- Validate promising or risky parameter sets with stronger physics.
- Produce reproducible evidence for advisors, patent work, and partners.

Future engines:

- Micromagnetic switching model with LLGS/STT terms.
- Quantum transport model for tunneling and readout contrast.
- Sensitivity sweeps across geometry, temperature, disorder, and disturbance.

Current implementation:

- A queued validation-job stub in `../orchestration/app/main.py`.
- JSON archive output for completed validation jobs.
