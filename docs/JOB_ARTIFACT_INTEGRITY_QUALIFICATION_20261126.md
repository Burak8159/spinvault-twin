# Local job artifact integrity qualification — 26 November 2026

## Change

Worker-generated job manifests now use schema version 2. They inventory each regular file below the job directory except `artifacts.json` itself, record its byte count and streaming SHA-256, and omit digest metadata for a file that changed while it was read. Symlinks are not followed. The manifest is written through a temporary file and atomically replaced.

The read-only job reconciliation audit checks schema-2 size and digest values, reports changed or unsafe references, and returns the observed digest for an integrity comparison. Older manifests remain readable; their references are explicitly marked `integrity: unverified`. The audit continues to avoid database/file mutation, retries, or cleanup.

## Qualification

- Focused worker and reconciliation tests: **29 passed** (the full backend suite includes these cases).
- Full backend test suite: **249 passed, 1 skipped**. The skip is an optional real-MuMax3-dependent test. One Starlette/httpx deprecation warning remains.
- Regression cases cover exact hashes and sizes, full regular-file inventory, symlink exclusion, matching schema-2 verification, same-size tampering, size changes, legacy manifests, and atomic-replace failure preservation. An end-to-end mock worker lifecycle verifies the final result, status and solver output bytes against the emitted manifest.
- `git diff --check`: pass.

## Limits

The digest records file identity at a particular snapshot; it does not prove a solver finished correctly or that a calculation is scientifically valid. The manifest excludes itself. A schema-2 hash is checked only for references present in the manifest. Legacy entries have no integrity proof. This does not add user ownership, multi-host reconciliation, Windows qualification, remote backup, public artifact access, or evidence review. Large files are hashed in streaming chunks after solver execution; this may add local finalization time.

## Changed files

- `backend/app/workers/artifacts.py`
- `backend/app/workers/artifact_reconciliation.py`
- `backend/app/workers/local_worker.py`
- `backend/tests/test_workers.py`
- `backend/tests/test_artifact_reconciliation.py`
- `backend/README.md`

Status: qualified local integrity feature; full Phase 1 and product release remain open.
