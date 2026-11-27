# Current source checkout QA revalidation — 27 November 2026

## Scope

Revalidated the clean companion-app checkout at commit `7fc2d3125313d3c06bb144c3d17950411a194c10` on branch `dev2/phase1-requirements-evidence`. This verifies the checked-in application source on this macOS host. It is not a fresh extracted-package install, browser-to-live-API workflow, hosted deployment, cross-platform qualification, or scientific acceptance.

## Results

| Check | Result |
|---|---|
| Backend suite | 252 passed, 1 skipped, 1 warning (Starlette/httpx deprecation) |
| Website suite | 167 passed, 0 failed |
| Website honesty lint | Passed, 71 files |
| TypeScript typecheck | Passed |
| Static shell build check | Passed; explicitly confirms no physics bundle is produced |

Commands run from the companion checkout:

```sh
backend/.venv/bin/python -m pytest -q
(cd apps/website && npm test)
(cd apps/website && npm run lint)
(cd apps/website && npm run typecheck)
(cd apps/website && npm run build)
```

The Python suite's single skipped test is the optional real-MuMax3 integration case. The warning is from Starlette's deprecated use of `httpx` in its test client; it did not fail the suite and was not addressed by changing dependencies during this verification-only pass.

## Product and science boundary

The saved requirement/evidence workflow remains source-qualified only: previously recorded live-browser/API evidence covers requirement save/list/load and fail-closed evaluation of a real archived unconverged QE record. This revalidation did not repeat that browser workflow. A green application suite does not establish a converged SpinVault electronic state, accepted device, OBC solution, or validated transmission spectrum. Hosted authentication/deployment, full accessibility, Windows/Linux installs, off-device restore, and positive qualified scientific evidence remain open Phase 1 gates.
