# Cursor Prompt #6: Kwant Integration

You are adding a Kwant integration boundary for SpinVault Twin. Kwant is for quantum transport modeling and must remain separate from MuMax3 micromagnetics. This prompt creates a careful backend adapter, schema, and result path for transport calculations without fabricating a validated device model.

## Objective

Implement a Kwant adapter that can:

- Check whether Kwant is installed.
- Accept transport-specific request parameters.
- Generate a minimal, explicit model only from supported inputs.
- Execute the calculation when configured.
- Return conductance/transmission-style results with provenance.

## Scientific Boundary

Do not imply that Kwant replaces MuMax3. Do not mix micromagnetic fields directly into a transport model unless a documented coupling layer exists. If coupling from MuMax3 magnetization outputs to Kwant is not implemented, mark it as pending.

Do not invent device-specific Hamiltonians without explicit implementation and documentation.

## Configuration

Use environment variables:

```text
KWANT_PYTHON=/path/to/python-with-kwant
SPINVAULT_JOB_ROOT=/path/to/jobs
KWANT_TIMEOUT_SECONDS=600
```

If Kwant is unavailable:

```json
{
  "status": "not_configured",
  "error": "Kwant runtime is not configured on this machine."
}
```

## Adapter Interface

```py
class KwantAdapter:
    def is_available(self) -> bool: ...
    def prepare(self, request: SimulationRequest) -> PreparedKwantJob: ...
    def run(self, prepared: PreparedKwantJob) -> SolverRunResult: ...
    def parse_outputs(self, job_dir: Path) -> SimulationResult: ...
```

## Supported Model Policy

Start with one clearly named minimal model, for example:

```text
placeholder_1d_transport
```

This model must be documented as a starter transport calculation, not a validated SpinVault device.

If the request asks for unsupported model types, return a validation error.

## Input Schema

Use a Kwant-specific section:

```py
class KwantTransportRequest(BaseModel):
    lattice_model: Literal["placeholder_1d_transport"]
    onsite_energy: Quantity | None = None
    hopping_energy: Quantity
    energy_min: Quantity
    energy_max: Quantity
    energy_points: int
    lead_configuration: Literal["two_terminal"]
    temperature: Quantity | None = None
```

Keep this separate from MuMax3 parameters.

## Execution Strategy

Generate a Python script or call a controlled module that:

- Builds the supported Kwant system.
- Sweeps energy over the requested range.
- Computes transmission or conductance values.
- Writes outputs to JSON/CSV.

Use subprocess safely if invoking a separate runtime:

- No shell interpolation.
- Timeout.
- Captured logs.
- Persisted script and request.

## Output Schema

Return:

```py
class KwantResult(BaseModel):
    job_id: str
    solver: Literal["kwant"]
    is_physical_simulation: bool
    model_name: str
    transmission_series: list[ParsedSeries]
    artifacts: list[ArtifactRef]
    provenance: Provenance
    warnings: list[str] = []
```

`is_physical_simulation` may be true only when Kwant actually executed. Add warnings that the starter model is not device-validated unless calibration exists.

## Coupling to MuMax3

Do not implement automatic MuMax3-to-Kwant coupling unless a clear file format and mapping are already present.

Represent future coupling as:

```py
class CouplingStatus(BaseModel):
    mumax_to_kwant_supported: bool = False
    notes: list[str]
```

## Frontend Updates

Add or enable Kwant UI only for supported fields:

- Model selector
- Energy range
- Number of points
- Hopping energy
- Onsite energy
- Lead configuration
- Runtime availability
- Results tab for transmission/conductance series

Keep warnings visible.

## Tests

Add tests for:

- Kwant availability check
- Unsupported model rejection
- Energy range validation
- Script/module generation
- Mocked execution success
- Parse failure
- Provenance and warning output

Do not require Kwant in CI unless the environment already provides it.

## Implementation Checklist

- [ ] Add Kwant config.
- [ ] Add Kwant request models.
- [ ] Add adapter interface.
- [ ] Add availability check.
- [ ] Add minimal supported transport model.
- [ ] Add safe execution wrapper.
- [ ] Add parser.
- [ ] Add provenance and warnings.
- [ ] Update backend solver router.
- [ ] Update frontend Kwant controls/results.
- [ ] Add tests.

## Acceptance Criteria

- Kwant requests are rejected cleanly when runtime is unavailable.
- Supported Kwant runs produce traceable transport outputs.
- Kwant and MuMax3 remain scientifically separated.
- Coupling is clearly marked as pending unless actually implemented.
- No validated-device claim is made without evidence.

