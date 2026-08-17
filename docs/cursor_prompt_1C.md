# Cursor Prompt #1C: Integration & Quality Review

You are performing a production-quality integration pass on the SpinVault Twin frontend created in Prompts #1A and #1B. Your job is to review, harden, and polish the implementation without expanding scope into real backend physics.

## Objective

Make the frontend reliable, typed, accessible, responsive, and honest about what is implemented. Fix structural problems, missing states, unclear labels, weak validation, and scientific boundary violations.

## Review Priorities

1. Scientific honesty
2. Type safety
3. Usability
4. Accessibility
5. Responsive layout
6. Maintainable architecture
7. Test coverage proportional to risk

## Scientific Boundary Audit

Search the codebase for claims such as:

```text
simulates
computed by MuMax3
Kwant result
AI prediction
physics-accurate
validated
real-time solver
```

If any claim implies real solver execution, change it unless the actual implementation exists. Prefer exact language:

```text
Demo output
Prepared for MuMax3 request generation
Kwant integration pending
Surrogate model not connected
```

## Architecture Audit

Ensure the code has clear boundaries:

```text
components/       visual UI components
lib/simulator/    types, defaults, validation, fixtures
lib/api/          future API client boundary
```

Avoid mixing chart fixtures, form state, validation, and UI rendering in one large component.

## API Boundary

Add a future-safe client boundary if missing:

```ts
interface SimulationRequest {
  scenario: SimulatorState;
  requestedSolver: SolverTarget;
}

interface SimulationResponse {
  jobId: string;
  status: SimulationStatus;
  result?: SimulationResult;
  provenance: Provenance;
}
```

For now, the client may call a local demo adapter:

```ts
async function submitDemoSimulation(request: SimulationRequest): Promise<SimulationResponse>
```

Do not create fake network calls to nonexistent services.

## Error and Empty States

The UI must include:

- Idle state
- Validation error state
- Running/queued state
- Complete state
- Failed state
- Cancelled state
- Empty result state

Each state should use concise, useful language.

## Tests

Add focused tests if the project has a test framework. Prioritize:

- Validation logic
- Unit handling
- Result provenance labels
- Demo adapter behavior
- Critical component rendering if testing utilities already exist

If no test framework exists, do not install a heavy testing stack unless the project conventions point that way. At minimum, ensure typecheck/build passes.

## Accessibility Pass

Verify:

- Icon-only controls have labels.
- Inputs have labels.
- Validation messages are programmatically associated where practical.
- Keyboard navigation works.
- Color contrast is acceptable.
- Tabs are understandable to screen readers.

## Responsive Pass

Check at minimum:

- 390px mobile width
- 768px tablet width
- 1280px desktop width

Fix overlapping text, unstable fixed-format elements, clipped controls, and unreadable panels.

## Performance

Do not over-optimize. Do ensure:

- Large mock result arrays are not regenerated unnecessarily on every render.
- Derived validation can be memoized if needed.
- Charts or canvas components avoid layout thrash.

## Build and Lint

Run the project’s existing quality commands. Use package scripts if available:

```bash
npm run lint
npm run typecheck
npm run build
```

Adapt to pnpm, yarn, bun, or the repository’s existing tooling.

## Implementation Checklist

- [ ] Remove or reword overstated physics claims.
- [ ] Confirm frontend, demo adapter, and future API boundary are separated.
- [ ] Confirm all result objects include provenance.
- [ ] Add or improve validation tests where possible.
- [ ] Confirm loading, error, empty, cancelled, and completed states exist.
- [ ] Confirm responsive layouts do not overlap.
- [ ] Confirm icon buttons and tabs are accessible.
- [ ] Run lint/typecheck/build.
- [ ] Summarize remaining limitations clearly.

## Acceptance Criteria

- The frontend is polished enough to hand to backend work.
- The implementation is honest about demo outputs and pending solvers.
- The code is modular and typed.
- The app builds successfully.
- Any unimplemented scientific capability is explicitly marked as pending.

