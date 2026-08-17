"""Generate auditable MuMax3 .mx3 scripts from validated request fields only."""

from __future__ import annotations

from dataclasses import dataclass
from math import sqrt

from app.models.simulation import MumaxModelKind, MumaxStatePreset, SimulationRequest, Vector3
from app.solvers.mumax3.units import to_si

DEFAULT_MODEL_KIND: MumaxModelKind = "smoke"


def _fmt(value: float) -> str:
    return f"{value:.12g}"


def resolve_model_kind(request: SimulationRequest) -> MumaxModelKind:
    mumax = request.solver_drafts.mumax3 if request.solver_drafts else None
    if mumax is None:
        return DEFAULT_MODEL_KIND
    return mumax.model_kind or DEFAULT_MODEL_KIND


def generate_mx3_script(request: SimulationRequest) -> str:
    """
    Build a MuMax3 script using only explicitly mapped fields.

    Caller must run validate_mumax_request first. Missing required fields will raise.
    """
    kind = resolve_model_kind(request)
    if kind == "reference_pmtj_v01_equilibrium":
        return _generate_reference_pmtj_v01_equilibrium(request)
    if kind in {
        "spinvault_mtj_free_layer_v0",
        "spinvault_mtj_free_layer_v0_visible",
    }:
        return _generate_mtj_free_layer_v0(request, kind)
    if kind == "spinvault_mtj_free_layer_switching_v1":
        return _generate_mtj_free_layer_switching_v1(request)
    return _generate_smoke(request)


@dataclass
class _MappedBlocks:
    grid_lines: list[str]
    material_lines: list[str]
    total_time: float
    world_size: tuple[float, float, float]


def _mapped_blocks(
    request: SimulationRequest, *, include_initial_magnetization: bool = True
) -> _MappedBlocks:
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    grid = mumax.grid_size
    if grid is None:
        raise ValueError("grid_size is required")

    dx = to_si(mumax.mesh_cell_size.x, kind="length")
    dy = to_si(mumax.mesh_cell_size.y, kind="length")
    dz = to_si(mumax.mesh_cell_size.z, kind="length")
    msat = to_si(mumax.saturation_magnetization, kind="magnetization")  # type: ignore[arg-type]
    aex = to_si(mumax.exchange_stiffness, kind="exchange")  # type: ignore[arg-type]
    alpha = to_si(mumax.damping_alpha, kind="damping")  # type: ignore[arg-type]
    sim_time_q = mumax.simulation_time or request.controls.duration
    total_time = to_si(sim_time_q, kind="time")
    vector = request.initial_magnetization.vector  # type: ignore[union-attr]
    mx, my, mz = vector.x, vector.y, vector.z

    grid_lines = [
        f"// Source: solverDrafts.mumax3.gridSize = ({grid.nx}, {grid.ny}, {grid.nz})",
        f"SetGridSize({grid.nx}, {grid.ny}, {grid.nz})",
        "// Source: solverDrafts.mumax3.meshCellSize (converted to meters)",
        f"// meshCellSize.x={mumax.mesh_cell_size.x.value} {mumax.mesh_cell_size.x.unit} -> {_fmt(dx)} m",
        f"// meshCellSize.y={mumax.mesh_cell_size.y.value} {mumax.mesh_cell_size.y.unit} -> {_fmt(dy)} m",
        f"// meshCellSize.z={mumax.mesh_cell_size.z.value} {mumax.mesh_cell_size.z.unit} -> {_fmt(dz)} m",
        f"SetCellSize({_fmt(dx)}, {_fmt(dy)}, {_fmt(dz)})",
        "",
    ]
    material_lines = [
        f"// Source: solverDrafts.mumax3.saturationMagnetization = {mumax.saturation_magnetization.value} {mumax.saturation_magnetization.unit}",
        f"Msat = {_fmt(msat)}",
        f"// Source: solverDrafts.mumax3.exchangeStiffness = {mumax.exchange_stiffness.value} {mumax.exchange_stiffness.unit}",
        f"Aex = {_fmt(aex)}",
        f"// Source: solverDrafts.mumax3.dampingAlpha = {mumax.damping_alpha.value} {mumax.damping_alpha.unit}",
        f"alpha = {_fmt(alpha)}",
        "",
    ]
    if include_initial_magnetization:
        material_lines.extend(
            [
                f"// Source: initialMagnetization.vector = ({mx}, {my}, {mz})",
                f"m = uniform({_fmt(mx)}, {_fmt(my)}, {_fmt(mz)})",
                "// MuMax3 default table columns include t, mx, my, mz (spatially averaged m).",
                "",
            ]
        )
    return _MappedBlocks(
        grid_lines=grid_lines,
        material_lines=material_lines,
        total_time=total_time,
        world_size=(grid.nx * dx, grid.ny * dy, grid.nz * dz),
    )


def _external_field_block(request: SimulationRequest) -> list[str]:
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    ext = mumax.external_field or request.external_field
    if ext is None:
        return []
    bx = to_si(ext.x, kind="field")
    by = to_si(ext.y, kind="field")
    bz = to_si(ext.z, kind="field")
    return [
        "// Source: externalField / solverDrafts.mumax3.externalField (Tesla)",
        f"B_ext = vector({_fmt(bx)}, {_fmt(by)}, {_fmt(bz)})",
        "// Preserve the explicitly supplied field as additional raw table columns.",
        "TableAdd(B_ext)",
        "",
    ]


def _external_field_values(request: SimulationRequest) -> tuple[float, float, float]:
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    ext = mumax.external_field or request.external_field
    if ext is None:
        return (0.0, 0.0, 0.0)
    return (
        to_si(ext.x, kind="field"),
        to_si(ext.y, kind="field"),
        to_si(ext.z, kind="field"),
    )


def _run_and_table_block(request: SimulationRequest, total_time: float) -> list[str]:
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    sim_time_q = mumax.simulation_time or request.controls.duration
    time_source = (
        "solverDrafts.mumax3.simulationTime"
        if mumax.simulation_time is not None
        else "controls.duration"
    )
    return [
        f"// Source: {time_source} = {sim_time_q.value} {sim_time_q.unit} -> {_fmt(total_time)} s",
        "// Raw output sampling only; no switching or performance criterion is applied.",
        "// Export spatial magnetization frames for visualization only.",
        "// These OVF snapshots are raw MuMax3 m(x,y,z,t) outputs, not calibrated device evidence.",
        "// Text OVF is selected for portable inspection; the backend also parses OVF2 Binary 4/8.",
        "TableAdd(E_total)",
        "TableAdd(E_exch)",
        "TableAdd(E_demag)",
        "TableAdd(E_anis)",
        "TableAdd(E_Zeeman)",
        "OutputFormat = OVF2_TEXT",
        f"autosave(m, {_fmt(total_time / 50.0)})",
        f"TableAutoSave({_fmt(total_time / 100.0)})",
        "save(m)",
        "TableSave()",
        f"run({_fmt(total_time)})",
        "save(m)",
        "TableSave()",
        "",
    ]


def _generate_smoke(request: SimulationRequest) -> str:
    blocks = _mapped_blocks(request)
    lines: list[str] = [
        "// Generated by SpinVault Twin",
        "// modelKind=smoke",
        f"// Scenario: {request.scenario_id}",
        f"// Title: {request.title}",
        "// This script reflects user-provided parameters and is not a validated device model.",
        "// Unsupported request fields are omitted rather than invented.",
        "",
        *blocks.grid_lines,
        *blocks.material_lines,
        *_external_field_block(request),
        *_run_and_table_block(request, blocks.total_time),
    ]
    return "\n".join(lines)


def _geom_shape_line(request: SimulationRequest) -> str:
    geom = request.geometry
    length = to_si(geom.free_layer_length, kind="length")
    width = to_si(geom.free_layer_width, kind="length")
    shape = geom.cell_shape
    if shape == "ellipse":
        return (
            f"// Source: geometry.freeLayerLength/Width + cellShape=ellipse\n"
            f"SetGeom(ellipse({_fmt(length)}, {_fmt(width)}))"
        )
    if shape == "rectangle":
        return (
            f"// Source: geometry.freeLayerLength/Width + cellShape=rectangle\n"
            f"SetGeom(rect({_fmt(length)}, {_fmt(width)}))"
        )
    # nanowire / custom: use rectangle extents without inventing extra topology.
    return (
        f"// Source: geometry.freeLayerLength/Width; cellShape={shape} mapped to rect extents only\n"
        f"SetGeom(rect({_fmt(length)}, {_fmt(width)}))"
    )


def _generate_reference_pmtj_v01_equilibrium(request: SimulationRequest) -> str:
    """Generate the zero-temperature V01 free-layer equilibrium experiment."""
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    blocks = _mapped_blocks(request)
    world_x, world_y, world_z = blocks.world_size
    thickness = to_si(request.geometry.free_layer_thickness, kind="length")
    ku1 = to_si(mumax.anisotropy_constant, kind="anisotropy")  # type: ignore[arg-type]
    anis = _normalized(mumax.anisotropy_axis)  # type: ignore[arg-type]
    return "\n".join(
        [
            "// Generated by SpinVault Twin",
            "// experimentId=V01_equilibrium",
            "// modelKind=reference_pmtj_v01_equilibrium",
            f"// Scenario: {request.scenario_id}",
            f"// Title: {request.title}",
            "// Conventional pMTJ reference: MuMax3 models the free magnetic layer only.",
            "// MgO tunneling, reference-layer dynamics, current torque, temperature,",
            "// TMR, resistance, retention, and leakage are NOT IMPLEMENTED in V01.",
            "// Every default remains UNVALIDATED_DEFAULT until a citation is recorded.",
            "",
            f"// Geometry review: freeLayerThickness={request.geometry.free_layer_thickness.value} "
            f"{request.geometry.free_layer_thickness.unit} -> {_fmt(thickness)} m",
            f"// Mesh world size (nx*dx, ny*dy, nz*dz) = ({_fmt(world_x)}, {_fmt(world_y)}, {_fmt(world_z)}) m",
            "",
            *blocks.grid_lines,
            _geom_shape_line(request),
            "",
            *blocks.material_lines,
            f"// Source: solverDrafts.mumax3.anisotropyConstant = "
            f"{mumax.anisotropy_constant.value} {mumax.anisotropy_constant.unit}",  # type: ignore[union-attr]
            f"Ku1 = {_fmt(ku1)}",
            f"// Source: solverDrafts.mumax3.anisotropyAxis = "
            f"({mumax.anisotropy_axis.x}, {mumax.anisotropy_axis.y}, {mumax.anisotropy_axis.z})",  # type: ignore[union-attr]
            f"anisU = vector({_fmt(anis[0])}, {_fmt(anis[1])}, {_fmt(anis[2])})",
            "",
            *_external_field_block(request),
            "TableAdd(E_total)",
            "TableAdd(E_exch)",
            "TableAdd(E_demag)",
            "TableAdd(E_anis)",
            "TableAdd(E_Zeeman)",
            "OutputFormat = OVF2_TEXT",
            "// Preserve the exact initial field before relaxation.",
            'saveas(m, "initial")',
            "TableSave()",
            "// MuMax3 relaxes toward a local energy minimum using its own convergence logic.",
            "// This is not assigned a fabricated physical elapsed time.",
            "relax()",
            "// Preserve the converged field and one final table row.",
            "TableSave()",
            'saveas(m, "equilibrium")',
            "",
        ]
    )


def _generate_mtj_free_layer_v0(
    request: SimulationRequest,
    model_kind: MumaxModelKind,
) -> str:
    blocks = _mapped_blocks(request)
    world_x, world_y, world_z = blocks.world_size
    thickness = to_si(request.geometry.free_layer_thickness, kind="length")
    lines: list[str] = [
        "// Generated by SpinVault Twin",
        f"// modelKind={model_kind}",
        f"// Scenario: {request.scenario_id}",
        f"// Title: {request.title}",
        "// SpinVault MTJ free-layer dynamics v0: single ferromagnetic free layer only.",
        (
            "// Visible dynamics preset: tilted m0 and transverse+z B_ext come from the request."
            if model_kind == "spinvault_mtj_free_layer_v0_visible"
            else "// Stable/basic v0 request; initial state and field come from the request."
        ),
        "// Not calibrated. Not experimentally validated.",
        "// Barrier, reference layer, TMR, resistance, STT/SOT, and thermal fields are omitted.",
        "// Material IDs are labels only; Msat/Aex/alpha come from solverDrafts.mumax3.",
        "",
        f"// Geometry review: freeLayerThickness={request.geometry.free_layer_thickness.value} "
        f"{request.geometry.free_layer_thickness.unit} -> {_fmt(thickness)} m",
        f"// Mesh world size (nx*dx, ny*dy, nz*dz) = ({_fmt(world_x)}, {_fmt(world_y)}, {_fmt(world_z)}) m",
        "// Barrier thickness and reference layer thickness are ignored in this model.",
        "",
        *blocks.grid_lines,
        _geom_shape_line(request),
        "",
        *blocks.material_lines,
        *_external_field_block(request),
        *_run_and_table_block(request, blocks.total_time),
    ]
    return "\n".join(lines)


def _normalized(vector: Vector3) -> tuple[float, float, float]:
    norm = sqrt(vector.x**2 + vector.y**2 + vector.z**2)
    if norm <= 0:
        raise ValueError("vector must be non-zero")
    return (vector.x / norm, vector.y / norm, vector.z / norm)


def _transition_initial(
    pinned: tuple[float, float, float], source_sign: float
) -> tuple[float, float, float]:
    """Return a nearly P/AP vector with a small deterministic transverse cant."""
    px, py, pz = pinned
    trial = (1.0, 0.0, 0.0) if abs(px) < 0.9 else (0.0, 1.0, 0.0)
    dot = trial[0] * px + trial[1] * py + trial[2] * pz
    tx, ty, tz = (
        trial[0] - dot * px,
        trial[1] - dot * py,
        trial[2] - dot * pz,
    )
    transverse_norm = sqrt(tx**2 + ty**2 + tz**2)
    tx, ty, tz = tx / transverse_norm, ty / transverse_norm, tz / transverse_norm
    cant = 0.02
    base = sqrt(1.0 - cant**2)
    return (
        source_sign * base * px + cant * tx,
        source_sign * base * py + cant * ty,
        source_sign * base * pz + cant * tz,
    )


def _preset_vectors(
    preset: MumaxStatePreset, pinned: tuple[float, float, float]
) -> tuple[tuple[float, float, float], float | None]:
    if preset == "state_0_ap":
        return tuple(-value for value in pinned), None  # type: ignore[return-value]
    if preset == "state_1_p":
        return pinned, None
    if preset == "transition_0_to_1":
        return _transition_initial(pinned, -1.0), 1.0
    return _transition_initial(pinned, 1.0), -1.0


def _generate_mtj_free_layer_switching_v1(request: SimulationRequest) -> str:
    """Generate one free-layer, uniaxial-anisotropy field-pulse switching script."""
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    blocks = _mapped_blocks(request, include_initial_magnetization=False)
    world_x, world_y, world_z = blocks.world_size
    thickness = to_si(request.geometry.free_layer_thickness, kind="length")
    ku1 = to_si(mumax.anisotropy_constant, kind="anisotropy")  # type: ignore[arg-type]
    pinned = _normalized(mumax.pinned_direction)
    initial, target_sign = _preset_vectors(mumax.state_preset, pinned)
    bx, by, bz = _external_field_values(request)
    # Transition presets request >=100 autosaved OVF frames for visible dynamics.
    # Static P/AP presets keep a lighter sample budget.
    frame_divisor = 100.0 if target_sign is not None else 50.0
    frame_interval = blocks.total_time / frame_divisor

    lines: list[str] = [
        "// Generated by SpinVault Twin",
        "// modelKind=spinvault_mtj_free_layer_switching_v1",
        f"// Scenario: {request.scenario_id}",
        f"// Title: {request.title}",
        "// SpinVault MTJ free-layer switching v1: one ferromagnetic free layer only.",
        "// MuMax3 solves magnetization dynamics; MgO, reference-layer dynamics, tunneling,",
        "// TMR, resistance, retention, and leakage are not solved in this script.",
        "// Not calibrated. Not experimentally validated.",
        "// Field-pulse excitation only; no STT/SOT/current term is used.",
        "",
        f"// Source: solverDrafts.mumax3.statePreset = {mumax.state_preset}",
        f"// Source: solverDrafts.mumax3.pinnedDirection (normalized) = ({_fmt(pinned[0])}, {_fmt(pinned[1])}, {_fmt(pinned[2])})",
        f"// Source: solverDrafts.mumax3.switchingThreshold = {_fmt(mumax.switching_threshold)}",
        "// P/AP and switching diagnostics are computed after the run from raw mean m(t).",
        f"// Geometry review: freeLayerThickness={request.geometry.free_layer_thickness.value} "
        f"{request.geometry.free_layer_thickness.unit} -> {_fmt(thickness)} m",
        f"// Mesh world size (nx*dx, ny*dy, nz*dz) = ({_fmt(world_x)}, {_fmt(world_y)}, {_fmt(world_z)}) m",
        "// Barrier/reference thicknesses are recorded in the request but ignored by MuMax3.",
        "",
        *blocks.grid_lines,
        _geom_shape_line(request),
        "",
        *blocks.material_lines,
        f"// Source: solverDrafts.mumax3.anisotropyConstant = {mumax.anisotropy_constant.value} {mumax.anisotropy_constant.unit}",  # type: ignore[union-attr]
        f"Ku1 = {_fmt(ku1)}",
        f"// Source: solverDrafts.mumax3.anisotropyAxis = ({mumax.anisotropy_axis.x}, {mumax.anisotropy_axis.y}, {mumax.anisotropy_axis.z})",  # type: ignore[union-attr]
        f"anisU = vector({_fmt(_normalized(mumax.anisotropy_axis)[0])}, {_fmt(_normalized(mumax.anisotropy_axis)[1])}, {_fmt(_normalized(mumax.anisotropy_axis)[2])})",  # type: ignore[arg-type]
        "",
        f"// State preset initial m; transitions include a 0.02 transverse cant to avoid an exact zero-torque collinear start.",
        f"m = uniform({_fmt(initial[0])}, {_fmt(initial[1])}, {_fmt(initial[2])})",
        "// MuMax3 default table columns include t, mx, my, mz (spatially averaged m).",
        "// Preserve the applied field vector as raw table columns.",
        "TableAdd(B_ext)",
        "TableAdd(E_total)",
        "TableAdd(E_exch)",
        "TableAdd(E_demag)",
        "TableAdd(E_anis)",
        "TableAdd(E_Zeeman)",
        "OutputFormat = OVF2_TEXT",
        f"autosave(m, {_fmt(frame_interval)})",
        f"TableAutoSave({_fmt(blocks.total_time / 100.0)})",
        "save(m)",
        "TableSave()",
        "",
    ]

    if target_sign is None:
        lines.extend(
            [
                "// Static P/AP state preset: no switching pulse requested.",
                f"B_ext = vector({_fmt(bx)}, {_fmt(by)}, {_fmt(bz)})",
                f"run({_fmt(blocks.total_time)})",
            ]
        )
    else:
        pulse = to_si(mumax.field_pulse_amplitude, kind="field")  # type: ignore[arg-type]
        pulse_duration = to_si(mumax.field_pulse_duration, kind="time")  # type: ignore[arg-type]
        target = tuple(target_sign * value for value in pinned)
        lines.extend(
            [
                f"// Source: fieldPulseAmplitude={mumax.field_pulse_amplitude.value} {mumax.field_pulse_amplitude.unit}; fieldPulseDuration={mumax.field_pulse_duration.value} {mumax.field_pulse_duration.unit}",  # type: ignore[union-attr]
                f"// Pulse target direction = ({_fmt(target[0])}, {_fmt(target[1])}, {_fmt(target[2])})",
                f"B_ext = vector({_fmt(bx + pulse * target[0])}, {_fmt(by + pulse * target[1])}, {_fmt(bz + pulse * target[2])})",
                f"run({_fmt(pulse_duration)})",
                "// Pulse off; continue relaxation under the explicitly supplied static bias field.",
                f"B_ext = vector({_fmt(bx)}, {_fmt(by)}, {_fmt(bz)})",
                f"run({_fmt(blocks.total_time - pulse_duration)})",
            ]
        )

    lines.extend(
        [
            "save(m)",
            "TableSave()",
            "",
            (
                "// Expected raw spatial output: >=100 autosaved OVF frames plus explicit endpoints."
                if target_sign is not None
                else "// Expected raw spatial output: >=50 autosaved OVF frames plus explicit endpoints."
            ),
            "// A non-static trajectory or successful switch is never assumed; backend diagnostics",
            "// classify the parsed trajectory and report static/no-switching honestly.",
            "",
        ]
    )
    return "\n".join(lines)
