# Cursor Prompt #4: RTX Worker & Parser

You are adding a GPU-aware worker layer and robust artifact parser for SpinVault Twin. This prompt assumes the FastAPI backend exists and MuMax3 integration has an adapter boundary. Your work should make heavier simulation jobs asynchronous and traceable.

## Objective

Create a worker architecture that can run solver jobs outside the request/response path, capture artifacts, parse outputs, and report progress. If no RTX/GPU environment is present, the system must degrade clearly rather than pretending acceleration exists.

## Scope

Implement:

- Job queue abstraction
- Local worker process
- GPU availability detection
- Solver execution handoff
- Artifact parser
- Progress/status updates
- Failure and timeout handling

Do not implement AI training or surrogate inference in this prompt.

## Worker Architecture

Suggested structure:

```text
backend/
  app/
    workers/
      queue.py
      local_worker.py
      gpu.py
      parser.py
      artifacts.py
```

Start with a local process or background task model unless the repository already uses Celery, RQ, Dramatiq, Ray, or another worker system.

## Queue Interface

```py
class SimulationQueue(Protocol):
    def enqueue(self, job_id: str) -> None: ...
    def cancel(self, job_id: str) -> None: ...
```

```py
class Worker:
    def run_once(self) -> None: ...
    def run_forever(self) -> None: ...
```

Keep the queue replaceable for future cloud execution.

## GPU Detection

Detect GPU capability honestly:

- Check NVIDIA tools only if available.
- Record detected device names and driver/runtime data if accessible.
- Mark capability as unavailable if detection fails.

Example response:

```json
{
  "gpu_available": false,
  "acceleration": "not_configured",
  "details": "No NVIDIA runtime detected."
}
```

Do not label a run as RTX accelerated unless the execution environment is actually using that path.

## Artifact Contract

Every worker job should produce or update:

```text
job_dir/
  request.json
  status.json
  stdout.log
  stderr.log
  artifacts.json
  result.json
```

`status.json` should include:

- job_id
- status
- progress phase
- started_at
- updated_at
- completed_at
- worker_id
- solver
- gpu metadata
- warnings
- errors

## Parser Responsibilities

The parser should:

- Identify output files.
- Parse known table formats.
- Preserve raw file references.
- Convert parsed arrays into chart-ready series.
- Attach units when known.
- Mark unknown columns as unknown rather than guessing.

Do not infer scientific conclusions by default.

## Result Schema

```py
class ParsedSeries(BaseModel):
    id: str
    label: str
    x_unit: str | None
    y_unit: str | None
    points: list[tuple[float, float]]
    source_file: str

class ParsedSimulationResult(BaseModel):
    job_id: str
    solver: str
    is_physical_simulation: bool
    series: list[ParsedSeries]
    artifacts: list[ArtifactRef]
    provenance: Provenance
    warnings: list[str] = []
```

For MuMax3 runs, `is_physical_simulation` may be true only if a real MuMax3 process completed successfully.

## Progress Phases

Use explicit phases:

```text
queued
preparing
checking_environment
generating_solver_input
running_solver
parsing_outputs
complete
failed
cancelled
```

## Error Handling

Handle:

- Missing solver binary
- GPU unavailable
- Timeout
- Process nonzero exit
- Missing expected output
- Malformed table data
- Cancel request

Preserve logs for diagnosis.

## Tests

Add tests for:

- Queue status transitions
- GPU detection fallback
- Parser with sample table output
- Parser with malformed output
- Worker failure state
- Cancellation state if implemented
- Artifact manifest generation

## Implementation Checklist

- [ ] Add queue abstraction.
- [ ] Add local worker.
- [ ] Add GPU detection.
- [ ] Add artifact manifest.
- [ ] Add parser for known solver output files.
- [ ] Add progress status updates.
- [ ] Add robust failure handling.
- [ ] Add tests.
- [ ] Update API to expose worker/job progress.

## Acceptance Criteria

- Simulation jobs can run outside the immediate API response path.
- GPU/RTX availability is reported accurately.
- Artifacts and logs are preserved.
- Parsed data is traceable to source files.
- The system never claims acceleration or physical validity without evidence.

