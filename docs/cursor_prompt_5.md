# Cursor Prompt #5: Browser to MuMax3 Integration

You are connecting the SpinVault Twin browser interface to the FastAPI backend and MuMax3 job lifecycle. The frontend should submit solver-ready requests, display job progress, show generated artifacts, and present parsed results honestly.

## Objective

Replace frontend-only demo execution with real API integration while preserving the demo mode. Users should be able to choose a solver target, submit a request, watch status updates, and inspect logs/results.

## Scope

Implement:

- API client
- Request serialization
- Job submission flow
- Polling or streaming status updates
- Result retrieval
- Error display
- Artifact links/previews
- MuMax3 configured/not-configured UI

Do not implement new physics, Kwant integration, or AI inference.

## Frontend API Client

Create a clear client boundary:

```ts
async function submitSimulation(request: SimulationRequest): Promise<JobRecord>;
async function getSimulationJob(jobId: string): Promise<JobRecord>;
async function getSimulationResult(jobId: string): Promise<SimulationResult>;
async function cancelSimulation(jobId: string): Promise<JobRecord>;
```

Use environment configuration for the backend URL:

```text
NEXT_PUBLIC_SPINVAULT_API_URL=http://localhost:8000
```

Adapt the variable name to the framework.

## Request Serialization

Serialize the current simulator state into the backend schema. Include:

- scenario id
- title
- requested solver
- geometry
- materials
- controls
- solver-specific draft parameters
- provenance

Do not silently drop fields. If a field cannot be serialized, show a validation warning.

## Solver Mode Behavior

`demo`:

- Can run without backend if existing demo mode is useful, or through backend demo endpoint.
- Must remain labeled as fixture/demo output.

`mumax3`:

- Submits to backend.
- If not configured, show clear status and setup guidance.
- If configured, show job lifecycle and artifacts.

`kwant`:

- Keep disabled or pending until Prompt #6.

`surrogate`:

- Keep disabled or pending until future validated AI work exists.

## Status UX

Show:

- Queued
- Preparing
- Checking environment
- Running solver
- Parsing outputs
- Complete
- Failed
- Cancelled
- Not configured

Avoid vague spinners with no state. Provide timestamps when available.

## Results UX

When physical MuMax3 results are present:

- Show solver name and version if available.
- Show request hash or input id.
- Show script/artifact references.
- Show parsed series with units.
- Show warnings.

When only demo results are present:

- Keep the demo label visible near charts and exports.

## Artifact Inspection

Add UI support for:

- Generated script preview
- stdout/stderr logs
- artifact manifest
- result JSON preview/download if already supported by the app

Do not expose local filesystem paths in a way that breaks browser security. Use backend artifact routes if implemented.

## Polling

If streaming is not available, use polling with a reasonable interval:

```ts
const POLL_INTERVAL_MS = 1500;
```

Stop polling when the job reaches a terminal state:

- complete
- failed
- cancelled
- not_configured

## Error Handling

Handle:

- Backend unreachable
- Validation failure
- Solver not configured
- Job not found
- Timeout
- Parse failure
- Cancel failure

Give the user actionable but concise messages.

## Tests

Add tests for:

- Request serialization
- API client error handling
- Job status rendering
- Demo vs physical result labeling
- Terminal state polling stop

Mock backend calls in frontend tests.

## Implementation Checklist

- [ ] Add API client.
- [ ] Add backend URL configuration.
- [ ] Add request serialization.
- [ ] Add MuMax3 submission path.
- [ ] Preserve demo mode.
- [ ] Add status polling.
- [ ] Add result retrieval.
- [ ] Add logs/artifacts UI.
- [ ] Add error states.
- [ ] Add tests where project tooling supports them.
- [ ] Run lint/typecheck/build.

## Acceptance Criteria

- Browser can submit a MuMax3-targeted job to the backend.
- Not-configured backend states are displayed cleanly.
- Completed MuMax3 jobs show provenance and artifacts.
- Demo output remains distinguishable from real solver output.
- Kwant and surrogate remain explicitly pending.

