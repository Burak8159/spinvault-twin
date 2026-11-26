# Project-record schema fail-closed check — 26 November 2026

## Change

`ProjectRecordStore` supports schema migration version 1. It now raises `UnsupportedProjectSchema` when a database advertises a migration version greater than 1, before changing its journal mode or querying/creating project-record tables. This prevents an older app from silently treating a future schema as compatible.

## Verification

A regression constructs a synthetic future-version database with a separate table and default journal mode, opens it through the store, and verifies that the explicit exception is raised while the migration row, table set, and journal mode remain unchanged. Focused project-record tests: 23 passed. Full backend suite: **250 passed, 1 skipped**. The skipped test is the optional real-MuMax3 integration. One existing Starlette/httpx deprecation warning is emitted by the test client.

## Scope

This is local fail-closed compatibility behavior for databases with a future version. It does not implement schema v2 migrations, cross-version downgrade tooling, off-device backup, hosted multi-user storage, or a disaster-recovery exercise. No user database was opened or modified during this test.
