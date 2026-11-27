# Local evidence configuration qualification — 27 November 2026

## Finding

The existing local Requirements and evidence page was reachable, but its same-cycle check returned `Reviewed evidence storage is not configured`. This is a runtime configuration gap, not a failed evidence comparison: the API requires `SPINVAULT_REQUIREMENT_EVIDENCE_ROOT`, and grouped checks additionally require `SPINVAULT_ACCEPTANCE_POLICY_FILE`. A record is qualified only when its review signature and metadata verify; configuration alone cannot make an observation acceptable.

## Change

- `scripts/run_workspace.sh` now reports whether the private evidence folder, review key, and same-cycle acceptance policy are configured/readable when it starts. It prints no configured path or key contents.
- `docs/LOCAL_EVIDENCE_CONFIGURATION.md` gives the local setup commands, record-review boundary, and fail-closed behavior.
- `README.md` links the setup guide from the local workspace instructions.

No currently running application process, stored project record, evidence record, key, or acceptance policy was modified. No server was restarted and no solver was run.

## Verification

- `bash -n scripts/run_workspace.sh`: pass.
- `backend/.venv/bin/python -m pytest -q scripts/tests/test_build_local_package.py`: 2 passed.
- `git diff --check`: pass.
- Live UI observation: same-cycle check reports evidence storage is unconfigured in the currently running workspace.

The startup banner was not exercised by restarting the active workspace. This qualifies source syntax and package inclusion safeguards, not a live reconfiguration. The required action for a configured workflow is to start a new workspace from a shell with the private paths set, after ensuring no simulation job is active. No scientific evidence was signed or promoted.
