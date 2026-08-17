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

### Worker mode (important)

`InMemorySimulationQueue` is **process-local**. Real MuMax3 execution requires the **in-process** worker that starts with the API:

```bash
# Default — keep this for Windows RTX / MuMax3 hosts
export SPINVAULT_WORKER_ENABLED=true
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

`python -m app.workers` starts a separate process with its own empty queue and **cannot** drain jobs enqueued by uvicorn. Disable the in-process worker only for tests that call `LocalWorker.run_once()` directly:

```bash
export SPINVAULT_WORKER_ENABLED=false   # tests / manual drain only
```

A shared cross-process queue is not implemented yet.

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
