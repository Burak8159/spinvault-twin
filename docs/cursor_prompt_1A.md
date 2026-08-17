# Cursor Prompt #1A: Simulator Architecture & UI Shell

You are building the first production-quality frontend shell for **SpinVault Twin**, an engineering simulator for spintronic memory concepts. This phase is about architecture, interaction design, typed state, and a credible simulation workflow shell. Do **not** implement real micromagnetic physics, quantum transport, AI inference, or backend execution in this prompt.

## Objective

Create a polished browser-based simulator interface that lets a user define a spintronic device scenario, inspect inputs, run a placeholder simulation workflow, and review mock results that are clearly labeled as placeholder/demo output.

The result should feel like an engineering tool, not a landing page. The first screen must be the simulator workspace.

## Non-Negotiable Boundaries

- Do not fabricate physics results.
- Do not claim MuMax3, Kwant, RTX acceleration, or AI models are connected.
- Do not put surrogate/AI predictions inside the solve loop.
- Do not use unverifiable formulas as executed simulation logic.
- Do not hide placeholder behavior. Label it as `"demo"`, `"mock"`, or `"not connected"` in the UI and data model.
- Do not create decorative marketing sections before the actual simulator.

## Product Shape

SpinVault Twin should have four primary zones:

1. Device setup panel
2. Simulation controls and status
3. Visualization canvas or schematic area
4. Results and analysis panel

Use a dense, practical layout suitable for repeated engineering work. Avoid oversized hero sections, decorative cards, and generic SaaS marketing copy.

## Suggested Route Structure

If this project uses React or Next.js, create a structure like:

```text
src/
  app/
    page.tsx
  components/
    simulator/
      SimulatorWorkspace.tsx
      DeviceSetupPanel.tsx
      SimulationToolbar.tsx
      DeviceViewport.tsx
      ResultsPanel.tsx
      AnalysisTabs.tsx
      StatusTimeline.tsx
  lib/
    simulator/
      types.ts
      defaults.ts
      validation.ts
      mockResults.ts
      units.ts
```

Adapt names to the existing framework if the repository already has strong conventions.

## UI Requirements

### Simulator Workspace

The default page should open directly into the simulator. It should include:

- A compact top bar with project name, scenario selector, run status, and export/settings actions.
- A left setup panel for device geometry and material presets.
- A central viewport showing a schematic of the stack or nanotrack.
- A right or bottom analysis area with tabs for results, logs, provenance, and validation.
- A responsive layout that remains usable on tablet and mobile.

### Controls

Use familiar controls:

- Icon buttons for save, export, reset, zoom, pause, and settings.
- Segmented controls for simulation mode.
- Toggles for binary options.
- Numeric inputs with units for geometry and material parameters.
- Select menus for material presets and solver target.
- Tabs for analysis views.

Do not use vague text buttons where a standard icon is clearer.

### Device Viewport

The viewport should show a simplified visual representation of the configured device:

- Magnetic layer
- Spacer or barrier layer
- Reference layer
- Current direction indicator
- Coordinate axes
- Selected region highlight

The viewport may be SVG, Canvas, or DOM/CSS. It must be deterministic and driven by typed scenario state.

### Placeholder Results

Display mock results only as development fixtures. Label them clearly:

```ts
result.source = "demo_fixture";
result.isPhysicalSimulation = false;
```

Use plausible chart labels and units, but do not claim numerical validity.

## State Model

Create a central simulator state that can later be sent to a backend.

```ts
type SolverTarget = "demo" | "mumax3" | "kwant" | "surrogate";

type SimulationStatus =
  | "idle"
  | "validating"
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "cancelled";

interface SimulatorState {
  scenarioId: string;
  title: string;
  solverTarget: SolverTarget;
  geometry: DeviceGeometry;
  materials: MaterialSelection;
  controls: SimulationControls;
  validation: ValidationIssue[];
}
```

Keep these types in a shared frontend library file so Prompt #1B can extend them.

## Validation Shell

Implement validation as a separate pure function:

```ts
function validateScenario(state: SimulatorState): ValidationIssue[] {
  // UI-level validation only in this phase.
}
```

For this prompt, validation should check only obvious UI/data integrity:

- Missing scenario title
- Non-positive dimensions
- Unsupported solver target
- Empty material selection
- Invalid unit strings

Do not encode real material feasibility limits yet.

## Accessibility

- All controls must be keyboard reachable.
- Icon-only buttons must have accessible labels and tooltips.
- Tabs must use semantic tab behavior where possible.
- Form errors must be visible and associated with inputs.
- Color must not be the only way to distinguish status.

## Responsive Behavior

Desktop:

- Three-column engineering layout is acceptable.
- Keep setup controls scannable and compact.

Tablet:

- Collapse analysis panel below the viewport if needed.

Mobile:

- Use tabs or drawers for Setup, Device, Results, and Logs.
- Do not allow text or controls to overlap.
- Keep fixed-format elements stable with explicit dimensions or aspect ratios.

## Implementation Checklist

- [ ] Build simulator as the first screen.
- [ ] Add typed scenario state.
- [ ] Add device setup panel.
- [ ] Add simulation toolbar.
- [ ] Add deterministic device viewport.
- [ ] Add clearly labeled demo result fixtures.
- [ ] Add validation issue display.
- [ ] Add analysis tabs.
- [ ] Add responsive layout.
- [ ] Add accessible labels and keyboard support.
- [ ] Run lint, typecheck, and build.

## Acceptance Criteria

- The app opens directly to a working simulator shell.
- A user can modify device setup values and see the viewport update.
- Running the simulation produces explicitly labeled demo output.
- The code has clear module boundaries for later backend, MuMax3, Kwant, and AI integration.
- No file claims that real physics simulation is implemented.

