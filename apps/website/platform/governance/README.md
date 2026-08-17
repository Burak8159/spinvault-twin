# Governance Layer

Purpose:

- Prevent uncontrolled compute cost.
- Track model versions and reproducibility.
- Separate public demo claims from validation-backed claims.

Current implementation:

- Budget guardrail constants and `/api/budget` in `../orchestration/app/main.py`.

Production direction:

- Cloud budget alerts.
- Job cancellation policy.
- Evidence labels for every public-facing claim.
- Audit trail for patent-supporting simulations.
