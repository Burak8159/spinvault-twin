# Local package publication safety — 26 November 2026

## Change

The source-only Twin ZIP builder now checks both the destination archive and its SHA-256 sidecar before work, then uses atomic hard-link publication that cannot replace an existing destination. The checksum sidecar is prepared before publication; if publication of either name fails, a just-published archive is removed only when its inode still matches the temporary archive created by this run. Temporary files are cleaned up. The README documents the no-overwrite behavior.

## Qualification

- Builder tests: **2 passed**.
- Tests cover a reproducible fixture package with CRC and per-source hash verification, refusal to replace an existing archive/sidecar without changing either, and refusal when a sidecar exists without an archive.
- Full backend suite: **249 passed, 1 skipped**; see `JOB_ARTIFACT_INTEGRITY_QUALIFICATION_20261126.md`.

## Limits

The builder is intended for local filesystems that support hard links. It does not upload the archive or certify the physical models inside it. The package remains source-only and should be rebuilt under a new filename after changes; existing dated packages are left intact.

Status: local package overwrite protection qualified; broader deployment, platform and scientific release gates remain open.
