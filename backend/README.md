# SpinVault Twin API

FastAPI job gateway for the Twin frontend.

**Connected today**
- Deterministic `demo` executor (`source: demo_fixture`, non-physical)
- MuMax3 adapter + local worker queue: generates auditable `.mx3` scripts and runs only when `MUMAX3_BINARY` is an executable
- Honest GPU detection via `nvidia-smi` (`host_gpu_available` for host probe; `cuda` / `rtx` only when MuMax3 logs confirm GPU execution)
- MuMax3 model kinds: `smoke` (connectivity), `spinvault_mtj_free_layer_v0` (stable/basic), `spinvault_mtj_free_layer_v0_visible` (tilted-request visible playback), and `spinvault_mtj_free_layer_switching_v1` (uniaxial anisotropy + field-pulse free-layer switching); all are uncalibrated

**Not configured**
- Kwant
- Surrogate / AI

If `MUMAX3_BINARY` is missing on this machine (typical on macOS development hosts), MuMax3 requests stay `queued` until the worker marks them `not_configured`. The API does **not** fake execution or RTX acceleration.

## Run locally

Requires Python 3.9+ (`eval_type_backport` covers `|` union syntax on 3.9).

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

The whole-app launcher detects Apple silicon with Python 3.11 and installs with
`constraints-macos-arm64-py311.txt`, which matches the locally qualified setup.
Other platforms currently use the minimum requirements because platform-specific
constraints have not been qualified yet. The Python constraints pin versions but
do not provide package hashes.

### Worker mode and local persistence

The default `SPINVAULT_JOB_STORE=sqlite` stores job records, pending queue entries,
worker claims and cross-process cancellation markers in `backend/data/jobs.sqlite3` (override
with `SPINVAULT_JOB_DATABASE`). SQLite claims are transactional, enqueueing a
queued job and recording its queue entry happen in one transaction, and pending
jobs survive API/worker restarts. Claims record both the worker and active solver
PID so startup recovery does not mark a job interrupted while its solver remains
alive. This is local single-host persistence, not a
multi-host queue service or off-device backup.

Back up and restore the local job database with
`python scripts/backup_job_runtime.py backup DB NEW_BACKUP_DIR` and
`python scripts/backup_job_runtime.py restore BACKUP_DIR NEW_DB`. The tool uses
SQLite's online backup API, verifies schema/integrity and SHA-256, and refuses to
overwrite an existing destination. It covers job records and queue state, not
solver output directories; back those up separately if they must be retained.

For a simple single-process local run, keep the in-process worker enabled:

```bash
# Default — keep this for Windows RTX / MuMax3 hosts
export SPINVAULT_WORKER_ENABLED=true
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

With the SQLite store, `python -m app.workers` can share the same database and
drain jobs submitted through the API. If running it separately, disable the API's
in-process worker to avoid unintentionally running multiple workers:

```bash
export SPINVAULT_WORKER_ENABLED=false
python -m app.workers
```

`SPINVAULT_JOB_STORE=memory` and `json` remain available for tests or legacy local
setups; those modes use a process-local queue, so a separate worker cannot see
their jobs. A job already claimed by a worker is deliberately not retried
automatically after a process crash, because solver files may be partial and
automatic retry could duplicate computation. On startup, a claim is marked
`interrupted` only after its same-host owner PID is confirmed absent; unknown
hosts and permission-denied PID checks are left untouched. During a managed
MuMax3 run, cancellation and timeout request termination of the solver process
group and wait for the group leader to exit before the worker returns; cancellation
is recorded as `cancelled`, while timeout is `failed`. POSIX process-group
termination is covered by a local fake-solver test; the Windows `taskkill /T`
path is implemented but was not exercised here. If the worker itself crashes,
the child solver may outlive it; inspect artifacts and confirm solver exit before
a deliberate retry. The SQLite mode has not yet been qualified for
multi-host production deployment or disaster recovery.

## MuMax3 on a configured host (e.g. Windows + CUDA)

```bash
export MUMAX3_BINARY=/path/to/mumax3   # Windows: C:\path\to\mumax3.exe
export SPINVAULT_JOB_ROOT=/path/to/jobs
export MUMAX3_TIMEOUT_SECONDS=600
export SPINVAULT_WORKER_ENABLED=true
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

Job folders:

```text
$SPINVAULT_JOB_ROOT/<job_id>/
  request.json
  input_parameters.json
  status.json
  generated.mx3
  run_metadata.json
  reference_parameters.json  # V01 reference experiment only
  stdout.log                 # after subprocess launch
  stderr.log                 # after subprocess launch
  artifacts.json
  result.json                # after parsing a solver attempt
  outputs/
```

An early `not_configured` outcome preserves the validated request, generated script, run metadata, status, and manifest, but does not create solver logs, raw outputs, or `result.json` because no subprocess ran. The API `job.result` remains `null`.

`status.json` tracks worker progress phases (`queued` → `preparing` → … → `complete` / `failed` / `not_configured`).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness (`workerEnabled`) |
| `GET` | `/api/solvers` | Solver config + GPU host-detection report |
| `GET` | `/api/worker` | Worker id, pending queue depth, GPU |
| `POST` | `/api/simulations` | Submit job (MuMax3 returns `queued`) |
| `GET` | `/api/simulations/{job_id}` | Job metadata / progress |
| `GET` | `/api/simulations/{job_id}/result` | Result when `complete` (else `409`) |
| `POST` | `/api/simulations/{job_id}/cancel` | Cancel non-terminal jobs |

## Tests

```bash
cd backend
source .venv/bin/activate
pytest -q
```

MuMax3 execution and GPU detection are mocked in unit tests. A real binary / NVIDIA runtime is only used when present on the host.

## Honesty notes

- Demo results always include `source: "demo_fixture"` and `isPhysicalSimulation: false`.
- MuMax3 `isPhysicalSimulation` is true only after a successful real MuMax3 process.
- Host GPU probe uses `host_gpu_available` / `gpu_detected` — never `cuda` / `rtx` by itself.
- Run metrics use `cuda` / `rtx` only when MuMax3 stdout/stderr show GPU/CUDA evidence; otherwise run acceleration stays `not_configured`.
- Free-layer MuMax3 kinds (`v0`, `v0_visible`, `switching_v1`) do not solve MgO, reference-layer dynamics, tunneling, TMR, resistance, retention, or STT/SOT. `v0_visible` only changes request m0/Bext/time. `switching_v1` adds validated `Ku1`/`anisU`, an explicit pinned direction, P/AP state presets, and a field pulse; switching is classified from raw mean-m tables with an honest static/no-switch report when the threshold is not met.
- Unsupported fields (e.g. current density without a mapped torque model) are omitted from scripts and surfaced as warnings. Anisotropy without `Ku1` remains unused outside `switching_v1`.

### Reproduce the qualified macOS Python 3.11 environment

The following constraints record the dependency versions used in the November 2026 macOS arm64 verification. They are not a cross-platform lockfile, do not include package hashes, and should be requalified when updated.

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -c constraints-macos-arm64-py311.txt
.venv/bin/python -m pytest tests -q -rs
```

The local app accepts the default preview origins and the configured `SPINVAULT_WEB_PORT`. `SPINVAULT_CORS_ORIGINS` replaces the default list with a comma-separated list. Direct `file://` pages (`Origin: null`) are not allowed by default; use the local website server. The SpinVault public website origins are included in the default list; override the list to limit access to local origins if required.

### Device and study records

Local record routes use `SPINVAULT_PROJECT_RECORDS_DB` (default `project_records.sqlite` beside the requirement database). Device records preserve ordered layers and explicit unknowns; known numeric quantities require units. Study records must reference an existing immutable device revision. Records are append-only with SHA-256, optimistic revision checks and migration version 1.

- `GET /api/project-records/device` or `/study` lists the latest revisions.
- `GET /api/project-records/{type}/{id}?revision=N` reads a revision.
- `POST /api/project-records/{type}` saves `{record, expected_revision}`.
- `GET /api/project-records/{type}/{id}/export?revision=N` returns a hash-checked JSON bundle.
- `POST /api/project-records/import` accepts `{bundle}` and imports only when the record ID is new; it never overwrites an existing ID.
- A study may optionally reference an exact immutable structure revision using `structure_id` and `structure_revision`; the pair is validated together and must already exist when saving or importing a standalone study bundle.
- `GET /api/project-records/study/{id}/package?revision=N` exports a study together with the exact device revision and, when linked, the exact structure revision it references.
- `POST /api/project-records/study-package/import` atomically imports the exact linked revisions, preserves their revision numbers, verifies nested and package hashes, and rejects ID collisions. Legacy study packages without a structure reference remain supported.
- `POST /api/project-records/import-qe-structure` accepts the exact text of a version-1 QE structure catalog record and its filename. The API computes the catalog SHA-256, validates ordered atoms, coordinates and species counts, and stores a normalized source-aware structure record. It preserves the source status and always keeps `transport_validated` false.
- `GET /api/project-records/structure` lists imported structures; `GET /api/project-records/structure/{id}?revision=N` reads one immutable revision; the standard record export route returns its hash-checked bundle.
- `GET /api/project-records/archive` exports every device, study, and structure revision into one bounded, SHA-256 protected JSON archive.
- `POST /api/project-records/archive/import` validates the entire archive, exact study-to-device and optional study-to-structure links, revision continuity, and all hashes before atomically importing it. Any ID collision or invalid entry rejects the whole archive without partial writes.

The project archive contains versioned device, study, and structure records only. It deliberately does not package raw scientific files, simulation outputs, secrets, evidence-signing keys, or material data files. Structure import is limited to the QE catalog labels currently mapped in the API; unsupported species stop with an error rather than being guessed.

These endpoints accept JSON only and do not resolve user-supplied filesystem paths. The local UI provides ordered layer fields while other advanced structures remain explicit JSON fields; no material registry, schema upgrade beyond v1, or project-wide atomic study export is claimed.

### Catalogued research artifacts

The optional read-only artifact API uses `SPINVAULT_ARTIFACT_ROOT` and a JSON file selected by `SPINVAULT_ARTIFACT_MANIFEST` (default `artifact-manifest.json`). The manifest is an object with `schema_version: "1.0"` and an `artifacts` array. Each entry follows the Phase 1 artifact contract: `id`, root-relative `relative_path`, lowercase SHA-256, exact byte count, `availability`, `access`, and `source_revision`. Unknown files are never enumerated or served. Invalid paths, duplicate IDs, symlinks escaping the root, and changed file size/hash are rejected. The manifest is capped at 2 MiB and 5,000 records; downloads are capped by `SPINVAULT_ARTIFACT_MAX_FILE_BYTES` (default 250 MiB).

`GET /api/artifacts` and `GET /api/artifacts/{id}` return catalog metadata without exposing root-relative paths. `GET /api/artifacts/{id}/content` serves only entries marked both `present` and `reviewed_public`; `private` entries remain non-downloadable. The requirements page can refresh this list and verifies SHA-256 again in the browser before saving a download. Leave this service unset to disable it. This is a local, read-only convenience, not a public evidence-sharing service: do not place private scientific outputs in a `reviewed_public` manifest, and do not expose the API publicly without authentication and access control.

Back up or restore the SQLite project-record store with `python scripts/backup_project_records.py backup DB NEW_BACKUP_DIR` and `python scripts/backup_project_records.py restore BACKUP_DIR NEW_DB`. Both operations refuse overwrite. The backup includes a SHA-256/byte-count manifest and SQLite integrity check; restore verifies the hash and supported schema version before atomically creating a new database. Keep backups in a separately managed, access-controlled location; this local tool does not itself provide off-device backup.

### Requirements workspace

Open `/requirements.html` on the local website. Project requirements default to `backend/data/requirements.sqlite`; set `SPINVAULT_REQUIREMENTS_DB` to choose another location. The UI supports immutable revisions, an expected-revision conflict check, project load/save, and JSON export. Browser-only save is also available. The default storage location is explicit and separate from the evidence directory.

Evidence evaluation additionally requires `SPINVAULT_REQUIREMENT_EVIDENCE_ROOT`, outside the public website tree. Each `ID.json` names a relative JSON observation, its SHA-256, and a review object with `status`, `reviewer`, `evidence_ref`, and `scope`. The observation supplies metric, value, unit and structured operating conditions. When `SPINVAULT_EVIDENCE_SIGNING_KEY_FILE` is configured, qualification requires a matching HMAC signature; without a verified signature the observation remains unqualified. A caller cannot supply qualification in the evaluation request. Artifact JSON is bounded to 1 MiB per file.

The grouped same-cycle endpoint also requires `SPINVAULT_ACCEPTANCE_POLICY_FILE` to point to the project policy JSON. If it is unset or invalid, the endpoint returns a configuration error. A policy with `runtime_semantics_verified: false` can display traceable values but cannot satisfy the numerical cycle acceptance boolean. The local launcher intentionally does not select a project policy on the user's behalf; configure the path for the project before launch.

Do not expose these local administrative functions or private evidence on a public server without deployment authentication, permissions and review controls. The current release is qualified only for the tested local workflows.

### Signed local evidence reviews

Requirement comparisons require signed local review metadata before an observation can be treated as qualified. Keep the signing key outside the public website and outside shared evidence exports. Set `SPINVAULT_EVIDENCE_SIGNING_KEY_FILE` for the API process. Without a configured verified signature, the comparison remains NOT_EVALUATED; a changed or invalid signature is rejected when a key is configured. When an observation carries a solver-log path and SHA-256 in provenance, the API rehashes that source file for each comparison and rejects changes or paths outside the configured evidence root.

From `backend`, initialize a private key once:

```bash
.venv/bin/python review_evidence.py --key-file /private/path/review.key --init-key
```

After independently reviewing an observation and its existing hash record, sign it explicitly:

```bash
.venv/bin/python review_evidence.py --key-file /private/path/review.key --record /private/evidence/ID.json --reviewer reviewer-id --reference review-document-id --scope numerical-log-review
```

The tool refuses to overwrite an existing key and refuses to sign a record whose artifact hash no longer matches. It signs the artifact identity and review metadata together. This authenticates possession of the local administrator's key; it does not establish professional reviewer identity, independent peer review or physical truth. No material-specific scientific state is automatically approved by this tool. A single-record PASS is only that one requirement comparison, not device certification.
