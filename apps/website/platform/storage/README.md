# Storage Layer

Purpose:

- Store simulation runs, parameter sets, assumptions, outputs, and generated reports.
- Archive validation results separately from fast public demo results.

Current implementation:

- SQLite metadata database in `../orchestration/data/` when the API is running.
- JSON archives in `../orchestration/data/archives/`.

Production direction:

- Postgres for metadata.
- Object storage for graph/report archives.
- Pre-signed access for private advisor or partner results.
