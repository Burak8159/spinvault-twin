# Requirement identifier switch qualification — 27 November 2026

## Change

When a saved project requirement is loaded and the user changes its identifier, the editor now clears the prior record/revision binding and displays the draft as unsaved. The next save therefore creates the new identifier at revision 1 rather than trying to revise the old requirement or failing with a stale binding. Other edited form fields remain intact.

## Regression coverage

`apps/website/js/simulator/tests/requirementsEvidenceFlow.test.js` loads an existing requirement at revision 3, changes the identifier, verifies the unsaved state, confirms the new identifier returns not found, then verifies the UI sends `expected_revision: 0` and receives the new record at revision 1.

Results on the current checkout:

- Website tests: 167 passed, 0 failed.
- Honesty lint: passed (71 files).
- TypeScript check: passed.
- Static simulator shell check: passed.

## Isolated browser/API workflow

In a temporary localhost app setup with isolated SQLite state, the browser loaded an existing test requirement, switched to `QE88-ACCURACY-QA`, saved revision 1, and evaluated the actual archived QE observation `sv-qe88-20261126-88atom-M2-pbc-15-accuracy` through the app's evidence evaluator.

Observed result: `NOT_EVALUATED`; `review_integrity_verified=false`; reason `Qualified observation evidence missing`. The evaluator returned the actual observation value `1301.94950267 Ry`, artifact SHA-256 `11c931f2f0783da79412850a2e4bf3e9275ce0d242cdeb633c3dd9e82a630f39`, and original source-log SHA-256 `f4bb92a04ebad7e25b5aee62e50a5200dfc2eae028f6482e5ea726518a59cc2e`. The solver run stopped unconverged; the UI correctly did not treat the value as a scientific pass.

The temporary server was stopped after the workflow. This qualifies the identifier-switch and evidence-evaluation path only; it does not qualify a QE result, device physics, authentication, hosted deployment, or full Phase 1 completion.
