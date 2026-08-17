# Cursor Prompt #2: FastAPI Backend

You are adding a FastAPI backend for SpinVault Twin. This backend defines job submission, validation, job status, result retrieval, and solver routing boundaries. It must not fabricate physics results or pretend external solvers are connected before they are.

## Objective

Create a backend service that accepts structured simulation requests from the frontend, validates them, stores job metadata, and returns honest status/results. Initial execution may use a demo executor only. Real MuMax3, Kwant, RTX worker, and surrogate execution must be isolated behind explicit adapters.

## Service Boundaries

The backend owns:

- Request schema validation
- Job lifecycle
- Solver routing
- Provenance metadata
- Result storage abstraction
- Error reporting

The backend does not own:

- Frontend UI state
- MuMax3 script physics design beyond request translation
- Kwant transport model design beyond request translation
- AI/surrogate training
- Claims of scientific validity

## Suggested Structure

```text
backend/
  app/
    main.py
    api/
      routes.py
    models/
      simulation.py
      jobs.py
      provenance.py
    services/
      validation.py
      jobs.py
      solver_router.py
    solvers/
      demo.py
      mumax3.py
      kwant.py
      surrogate.py
    storage/
      local_store.py
    tests/
      test_validation.py
      test_jobs.py
```

Adapt to existing repository conventions if a backend already exists.

## API Endpoints

Implement:

```text
GET  /health
POST /api/simulations
GET  /api/simulations/{job_id}
GET  /api/simulations/{job_id}/result
POST /api/simulations/{job_id}/cancel
```

## Request Model

Use Pydantic models. Mirror the frontend model without weakening validation.

```py
class SimulationRequest(BaseModel):
    scenario_id: str
    title: str
    requested_solver: Literal["demo", "mumax3", "kwant", "surrogate"]
    geometry: DeviceGeometry
    materials: MaterialSelection
    controls: SimulationControls
    provenance: Provenance | None = None
```

Use explicit units in every quantity:

```py
class Quantity(BaseModel):
    value: float
    unit: str
    source: Literal["user", "preset", "computed", "unknown"] = "unknown"
    citation: str | None = None
```

## Solver Routing

Create a router:

```py
class SolverRouter:
    def submit(self, request: SimulationRequest) -> JobRecord:
        ...
```

Behavior:

- `"demo"` routes to a deterministic demo executor.
- `"mumax3"` returns a clear `"not_configured"` error until Prompt #3 is implemented.
- `"kwant"` returns a clear `"not_configured"` error until Prompt #6 is implemented.
- `"surrogate"` returns a clear `"not_configured"` error until future AI work exists.

Do not fake successful solver execution.

## Job Lifecycle

Use explicit statuses:

```py
JobStatus = Literal[
    "queued",
    "validating",
    "running",
    "complete",
    "failed",
    "cancelled",
    "not_configured",
]
```

Every job record should include:

- job_id
- scenario_id
- requested_solver
- status
- created_at
- updated_at
- errors
- warnings
- provenance

## Demo Executor

The demo executor may return deterministic fixture data for UI development. It must include:

```json
{
  "source": "demo_fixture",
  "is_physical_simulation": false
}
```

Do not produce values that appear to be validated research output.

## Storage

Start with a simple local storage adapter:

- JSON files in a configurable local data directory, or
- in-memory store for development if the repository is not ready for file storage.

Keep the interface replaceable:

```py
class JobStore(Protocol):
    def create(self, job: JobRecord) -> JobRecord: ...
    def get(self, job_id: str) -> JobRecord | None: ...
    def update(self, job: JobRecord) -> JobRecord: ...
```

## CORS and Frontend Integration

Allow the local frontend origin during development only. Use environment configuration, not hard-coded production assumptions.

## Tests

Add tests for:

- Health endpoint
- Valid demo submission
- Invalid quantity values
- Unsupported/not configured solver response
- Job retrieval
- Result retrieval before completion
- Provenance on demo results

## Implementation Checklist

- [ ] Add FastAPI app structure.
- [ ] Add Pydantic request/response models.
- [ ] Add validation service.
- [ ] Add job lifecycle service.
- [ ] Add solver router.
- [ ] Add deterministic demo executor.
- [ ] Add not-configured adapters for MuMax3, Kwant, and surrogate.
- [ ] Add tests.
- [ ] Document how to run backend locally.
- [ ] Run backend tests.

## Acceptance Criteria

- The backend starts locally.
- `/health` returns success.
- Demo jobs can be submitted and retrieved.
- MuMax3/Kwant/surrogate requests do not pretend to run.
- Every response has clear provenance and status.

