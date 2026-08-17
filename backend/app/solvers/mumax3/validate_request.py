"""MuMax3 request validation for script generation (not physics feasibility)."""

from __future__ import annotations

from dataclasses import dataclass, field
from math import isfinite, pi, sqrt

MU0 = 4 * pi * 1e-7

from app.models.jobs import JobError, JobWarning
from app.models.simulation import SimulationRequest
from app.physics.parameters import mesh_assessment
from app.solvers.mumax3.script import resolve_model_kind
from app.solvers.mumax3.units import UnsupportedUnitError, to_si


@dataclass
class MumaxValidation:
    errors: list[JobError] = field(default_factory=list)
    warnings: list[JobWarning] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def validate_mumax_request(request: SimulationRequest) -> MumaxValidation:
    result = MumaxValidation()
    drafts = request.solver_drafts
    if drafts is None or drafts.mumax3 is None:
        result.errors.append(
            JobError(
                code="mumax3-draft-missing",
                field="solverDrafts.mumax3",
                message="MuMax3 draft parameters are required to generate a script.",
            )
        )
        return result

    mumax = drafts.mumax3
    model_kind = resolve_model_kind(request)

    if mumax.grid_size is None:
        result.errors.append(
            JobError(
                code="mumax3-grid-missing",
                field="solverDrafts.mumax3.gridSize",
                message="gridSize (nx, ny, nz) is required for MuMax3 script generation.",
            )
        )
    else:
        for axis, value in (("nx", mumax.grid_size.nx), ("ny", mumax.grid_size.ny), ("nz", mumax.grid_size.nz)):
            if not isinstance(value, int) or value <= 0:
                result.errors.append(
                    JobError(
                        code=f"mumax3-grid-{axis}",
                        field=f"solverDrafts.mumax3.gridSize.{axis}",
                        message=f"gridSize.{axis} must be a positive integer.",
                    )
                )
        if (
            model_kind in {
                "spinvault_mtj_free_layer_v0_visible",
                "spinvault_mtj_free_layer_switching_v1",
            }
            and mumax.grid_size.nx * mumax.grid_size.ny * mumax.grid_size.nz <= 1000
        ):
            result.warnings.append(
                JobWarning(
                    code="mumax3-visible-grid-coarse",
                    field="solverDrafts.mumax3.gridSize",
                    message=(
                        "Visible-dynamics grid has 1,000 cells or fewer. "
                        "The default physically matched playback preset is 64 x 32 x 2 "
                        "(4,096 raw vectors per frame); "
                        "smaller grids are treated as an explicit user cap."
                    ),
                )
            )

    cell_sizes: dict[str, float] = {}
    for axis, quantity in (
        ("x", mumax.mesh_cell_size.x),
        ("y", mumax.mesh_cell_size.y),
        ("z", mumax.mesh_cell_size.z),
    ):
        try:
            meters = to_si(quantity, kind="length")
            cell_sizes[axis] = meters
            if meters <= 0:
                result.errors.append(
                    JobError(
                        code=f"mumax3-mesh-{axis}",
                        field=f"solverDrafts.mumax3.meshCellSize.{axis}",
                        message=f"meshCellSize.{axis} must be positive.",
                    )
                )
        except UnsupportedUnitError as exc:
            result.errors.append(
                JobError(
                    code=f"mumax3-mesh-{axis}-unit",
                    field=f"solverDrafts.mumax3.meshCellSize.{axis}",
                    message=str(exc),
                )
            )

    physical_values: dict[str, float] = {}
    for field_name, quantity, kind, label in (
        ("saturationMagnetization", mumax.saturation_magnetization, "magnetization", "Msat"),
        ("exchangeStiffness", mumax.exchange_stiffness, "exchange", "Aex"),
        ("dampingAlpha", mumax.damping_alpha, "damping", "alpha"),
    ):
        if quantity is None:
            result.errors.append(
                JobError(
                    code=f"mumax3-{field_name}-missing",
                    field=f"solverDrafts.mumax3.{field_name}",
                    message=f"{label} is required for MuMax3 script generation.",
                )
            )
            continue
        try:
            value = to_si(quantity, kind=kind)
            physical_values[kind] = value
            if kind == "damping" and (value <= 0 or value > 1):
                result.warnings.append(
                    JobWarning(
                        code="mumax3-alpha-range",
                        field=f"solverDrafts.mumax3.{field_name}",
                        message="alpha is outside the common (0, 1] review range.",
                    )
                )
            if kind != "damping" and value <= 0:
                result.errors.append(
                    JobError(
                        code=f"mumax3-{field_name}-nonpositive",
                        field=f"solverDrafts.mumax3.{field_name}",
                        message=f"{label} must be positive.",
                    )
                )
        except UnsupportedUnitError as exc:
            result.errors.append(
                JobError(
                    code=f"mumax3-{field_name}-unit",
                    field=f"solverDrafts.mumax3.{field_name}",
                    message=str(exc),
                )
            )

    sim_time = mumax.simulation_time or request.controls.duration
    try:
        seconds = to_si(sim_time, kind="time")
        if seconds <= 0:
            result.errors.append(
                JobError(
                    code="mumax3-time-nonpositive",
                    field="solverDrafts.mumax3.simulationTime",
                    message="Simulation time must be positive.",
                )
            )
    except UnsupportedUnitError as exc:
        result.errors.append(
            JobError(
                code="mumax3-time-unit",
                field="solverDrafts.mumax3.simulationTime",
                message=str(exc),
            )
        )

    init = request.initial_magnetization
    if model_kind == "spinvault_mtj_free_layer_switching_v1":
        if init is not None:
            result.warnings.append(
                JobWarning(
                    code="mumax3-m0-overridden-by-preset",
                    field="initialMagnetization",
                    message=(
                        "switching_v1 derives the initial magnetization from statePreset; "
                        "initialMagnetization does not enter the MuMax3 script."
                    ),
                )
            )
    elif init is None or init.vector is None:
        result.errors.append(
            JobError(
                code="mumax3-m0-missing",
                field="initialMagnetization.vector",
                message="Initial magnetization vector is required for MuMax3 script generation.",
            )
        )
    elif init.mode not in ("uniform", "random"):
        result.warnings.append(
            JobWarning(
                code="mumax3-m0-mode",
                field="initialMagnetization.mode",
                message=(
                    f"initialMagnetization.mode='{init.mode}' is not mapped to a MuMax3 command; "
                    "uniform(vector) will be used when a vector is present."
                ),
            )
        )
    else:
        norm = (init.vector.x**2 + init.vector.y**2 + init.vector.z**2) ** 0.5
        if norm != norm or norm <= 0:
            result.errors.append(
                JobError(
                    code="mumax3-m0-invalid",
                    field="initialMagnetization.vector",
                    message="Initial magnetization vector must be finite and non-zero.",
                )
            )

    if mumax.current_density is not None or (request.torque and request.torque.enabled):
        result.warnings.append(
            JobWarning(
                code="mumax3-current-unused",
                field="solverDrafts.mumax3.currentDensity",
                message=(
                    "Current density / torque fields are present but not mapped into the generated "
                    ".mx3 script (no unsupported STT/SOT commands are invented)."
                ),
            )
        )

    if mumax.time_step_hint is not None:
        result.warnings.append(
            JobWarning(
                code="mumax3-dt-unused",
                field="solverDrafts.mumax3.timeStepHint",
                message="timeStepHint is not written to the script; MuMax3 adaptive steppers remain default.",
            )
        )

    if mumax.anisotropy_axis is not None and model_kind not in {
        "reference_pmtj_v01_equilibrium",
        "spinvault_mtj_free_layer_switching_v1",
    }:
        result.warnings.append(
            JobWarning(
                code="mumax3-anis-unused",
                field="solverDrafts.mumax3.anisotropyAxis",
                message=(
                    "anisotropyAxis is present without an explicit Ku constant mapping; "
                    "anisU/Ku1 are not invented in the generated script."
                ),
            )
        )

    if model_kind == "reference_pmtj_v01_equilibrium":
        if request.controls.temperature.value != 0:
            result.errors.append(
                JobError(
                    code="v01-temperature-must-be-zero",
                    field="controls.temperature",
                    message=(
                        "V01_equilibrium is a deterministic zero-temperature reference. "
                        "Temperature must be 0 K because no MuMax3 thermal field is configured."
                    ),
                )
            )
    elif request.controls.temperature is not None:
        result.warnings.append(
            JobWarning(
                code="mumax3-temp-unused",
                field="controls.temperature",
                message="Temperature is not mapped to a MuMax3 thermal field in this adapter.",
            )
        )

    result.warnings.append(
        JobWarning(
            code="mumax3-unvalidated-model",
            field="solverDrafts.mumax3.modelKind",
            message=(
                f"modelKind={model_kind}: MuMax3 run uses user-provided parameters and is "
                "not calibrated or experimentally validated."
            ),
        )
    )

    if model_kind in {
        "reference_pmtj_v01_equilibrium",
        "spinvault_mtj_free_layer_v0",
        "spinvault_mtj_free_layer_v0_visible",
        "spinvault_mtj_free_layer_switching_v1",
    }:
        _validate_mtj_free_layer_v0(request, result, cell_sizes)
        _validate_exchange_length_mesh(
            request,
            result,
            cell_sizes=cell_sizes,
            saturation_magnetization=physical_values.get("magnetization"),
            exchange_stiffness=physical_values.get("exchange"),
        )
    if model_kind == "reference_pmtj_v01_equilibrium":
        _validate_reference_pmtj_v01(request, result)
    if model_kind == "spinvault_mtj_free_layer_switching_v1":
        _validate_mtj_free_layer_switching_v1(request, result)

    return result


def _validate_mtj_free_layer_v0(
    request: SimulationRequest,
    result: MumaxValidation,
    cell_sizes: dict[str, float],
) -> None:
    geom = request.geometry
    for field_name, quantity, label in (
        ("freeLayerLength", geom.free_layer_length, "Free-layer length"),
        ("freeLayerWidth", geom.free_layer_width, "Free-layer width"),
        ("freeLayerThickness", geom.free_layer_thickness, "Free-layer thickness"),
    ):
        try:
            meters = to_si(quantity, kind="length")
            if meters <= 0:
                result.errors.append(
                    JobError(
                        code=f"mumax3-geom-{field_name}",
                        field=f"geometry.{field_name}",
                        message=f"{label} must be positive for {resolve_model_kind(request)}.",
                    )
                )
        except UnsupportedUnitError as exc:
            result.errors.append(
                JobError(
                    code=f"mumax3-geom-{field_name}-unit",
                    field=f"geometry.{field_name}",
                    message=str(exc),
                )
            )

    result.warnings.append(
        JobWarning(
            code="mumax3-mtj-v0-scope",
            field="solverDrafts.mumax3.modelKind",
            message=(
                f"{resolve_model_kind(request)} models only the free layer. "
                "Barrier thickness, reference layer, TMR, and resistance are not simulated."
            ),
        )
    )
    result.warnings.append(
        JobWarning(
            code="mumax3-material-labels",
            field="materials.freeLayerId",
            message=(
                f"Material IDs (free={request.materials.free_layer_id}, "
                f"reference={request.materials.reference_layer_id}, "
                f"barrier={request.materials.barrier_id}) are labels only; "
                "Msat/Aex/alpha come from solverDrafts.mumax3."
            ),
        )
    )

    if geom.cell_shape in {"nanowire", "custom"}:
        result.warnings.append(
            JobWarning(
                code="mumax3-geom-shape-fallback",
                field="geometry.cellShape",
                message=(
                    f"cellShape={geom.cell_shape} is mapped to rectangular extents only; "
                    "no nanowire/custom topology is invented."
                ),
            )
        )

    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    if mumax.grid_size is not None and {"x", "y", "z"} <= set(cell_sizes):
        try:
            length = to_si(geom.free_layer_length, kind="length")
            width = to_si(geom.free_layer_width, kind="length")
            thickness = to_si(geom.free_layer_thickness, kind="length")
        except UnsupportedUnitError:
            return
        world_x = mumax.grid_size.nx * cell_sizes["x"]
        world_y = mumax.grid_size.ny * cell_sizes["y"]
        world_z = mumax.grid_size.nz * cell_sizes["z"]
        if length > world_x + 0.5 * cell_sizes["x"] or width > world_y + 0.5 * cell_sizes["y"]:
            result.errors.append(
                JobError(
                    code="mumax3-geom-larger-than-world",
                    field="geometry",
                    message=(
                        "Free-layer length/width exceed the mesh world size (nx*dx, ny*dy). "
                        "The run is blocked because MuMax3 would clip the requested geometry; "
                        "increase gridSize or reduce meshCellSize."
                    ),
                )
            )
        thickness_tolerance = max(0.05 * thickness, 0.5 * cell_sizes["z"])
        if thickness > 0 and abs(world_z - thickness) > thickness_tolerance:
            result.errors.append(
                JobError(
                    code="mumax3-thickness-mismatch",
                    field="geometry.freeLayerThickness",
                    message=(
                        "nz*dz does not represent the requested freeLayerThickness within "
                        "half a z cell. The run is blocked instead of simulating a different thickness."
                    ),
                )
            )


def _validate_exchange_length_mesh(
    request: SimulationRequest,
    result: MumaxValidation,
    *,
    cell_sizes: dict[str, float],
    saturation_magnetization: float | None,
    exchange_stiffness: float | None,
) -> None:
    """Apply a pre-run exchange-length mesh criterion.

    This is a necessary sanity check, not evidence of mesh convergence.
    """
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    if (
        mumax.grid_size is None
        or saturation_magnetization is None
        or exchange_stiffness is None
        or not {"x", "y", "z"} <= set(cell_sizes)
        or saturation_magnetization <= 0
        or exchange_stiffness <= 0
    ):
        return
    assessment = mesh_assessment(
        exchange_stiffness_j_per_m=exchange_stiffness,
        saturation_magnetization_a_per_m=saturation_magnetization,
        cell_x_m=cell_sizes["x"],
        cell_y_m=cell_sizes["y"],
        cell_z_m=cell_sizes["z"],
        cells_across_x=mumax.grid_size.nx,
        cells_across_y=mumax.grid_size.ny,
        cells_through_thickness=mumax.grid_size.nz,
    )
    message = (
        f"Exchange length={assessment.exchange_length_m:.6g} m; "
        f"cells=({assessment.cell_x_m:.6g}, {assessment.cell_y_m:.6g}, "
        f"{assessment.cell_z_m:.6g}) m; max(cell)/l_ex="
        f"{assessment.max_cell_to_exchange_length:.4g}. Criterion: "
        f"{assessment.criterion}. This is not a convergence result."
    )
    if (
        resolve_model_kind(request) == "reference_pmtj_v01_equilibrium"
        and assessment.max_cell_to_exchange_length > 1.0
    ):
        result.errors.append(
            JobError(
                code="mumax3-mesh-exceeds-exchange-length",
                field="solverDrafts.mumax3.meshCellSize",
                message=message,
            )
        )
    else:
        result.warnings.append(
            JobWarning(
                code=(
                    "mumax3-mesh-exchange-precheck-pass"
                    if assessment.status == "PASS_PRECHECK"
                    else "mumax3-mesh-exchange-precheck-warn"
                ),
                field="solverDrafts.mumax3.meshCellSize",
                message=message,
            )
        )


def _validate_reference_pmtj_v01(
    request: SimulationRequest,
    result: MumaxValidation,
) -> None:
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    if mumax.anisotropy_constant is None:
        result.errors.append(
            JobError(
                code="v01-anisotropy-missing",
                field="solverDrafts.mumax3.anisotropyConstant",
                message="V01_equilibrium requires an explicit uniaxial anisotropy constant.",
            )
        )
    else:
        try:
            ku1 = to_si(mumax.anisotropy_constant, kind="anisotropy")
            if ku1 <= 0:
                result.errors.append(
                    JobError(
                        code="v01-anisotropy-nonpositive",
                        field="solverDrafts.mumax3.anisotropyConstant",
                        message="V01_equilibrium requires Ku1 > 0 J/m^3.",
                    )
                )
        except UnsupportedUnitError as exc:
            result.errors.append(
                JobError(
                    code="v01-anisotropy-unit",
                    field="solverDrafts.mumax3.anisotropyConstant",
                    message=str(exc),
                )
            )
    if mumax.anisotropy_axis is None:
        result.errors.append(
            JobError(
                code="v01-anisotropy-axis-missing",
                field="solverDrafts.mumax3.anisotropyAxis",
                message="V01_equilibrium requires an explicit anisotropy axis.",
            )
        )
    elif not isfinite(
        mumax.anisotropy_axis.x**2
        + mumax.anisotropy_axis.y**2
        + mumax.anisotropy_axis.z**2
    ) or (
        mumax.anisotropy_axis.x**2
        + mumax.anisotropy_axis.y**2
        + mumax.anisotropy_axis.z**2
        <= 0
    ):
        result.errors.append(
            JobError(
                code="v01-anisotropy-axis-invalid",
                field="solverDrafts.mumax3.anisotropyAxis",
                message="V01_equilibrium anisotropyAxis must be finite and non-zero.",
            )
        )


def _validate_mtj_free_layer_switching_v1(
    request: SimulationRequest,
    result: MumaxValidation,
) -> None:
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]

    if mumax.anisotropy_axis is None:
        result.errors.append(
            JobError(
                code="mumax3-anisotropy-axis-missing",
                field="solverDrafts.mumax3.anisotropyAxis",
                message="anisotropyAxis is required for switching_v1.",
            )
        )
    else:
        norm = (
            mumax.anisotropy_axis.x**2
            + mumax.anisotropy_axis.y**2
            + mumax.anisotropy_axis.z**2
        ) ** 0.5
        if not isfinite(norm) or norm <= 0:
            result.errors.append(
                JobError(
                    code="mumax3-anisotropy-axis-invalid",
                    field="solverDrafts.mumax3.anisotropyAxis",
                    message="anisotropyAxis must be a finite, non-zero vector.",
                )
            )

    pinned_norm = (
        mumax.pinned_direction.x**2
        + mumax.pinned_direction.y**2
        + mumax.pinned_direction.z**2
    ) ** 0.5
    if not isfinite(pinned_norm) or pinned_norm <= 0:
        result.errors.append(
            JobError(
                code="mumax3-pinned-direction-invalid",
                field="solverDrafts.mumax3.pinnedDirection",
                message="pinnedDirection must be a finite, non-zero vector.",
            )
        )

    if mumax.anisotropy_axis is not None:
        anis_norm = (
            mumax.anisotropy_axis.x**2
            + mumax.anisotropy_axis.y**2
            + mumax.anisotropy_axis.z**2
        ) ** 0.5
        if isfinite(anis_norm) and anis_norm > 0 and isfinite(pinned_norm) and pinned_norm > 0:
            alignment = abs(
                (
                    mumax.anisotropy_axis.x * mumax.pinned_direction.x
                    + mumax.anisotropy_axis.y * mumax.pinned_direction.y
                    + mumax.anisotropy_axis.z * mumax.pinned_direction.z
                )
                / (anis_norm * pinned_norm)
            )
            if alignment < 0.996:
                result.errors.append(
                    JobError(
                        code="mumax3-pinned-anisotropy-misaligned",
                        field="solverDrafts.mumax3.pinnedDirection",
                        message=(
                            "switching_v1 requires pinnedDirection to be parallel or antiparallel "
                            "to anisotropyAxis within 5 degrees so P/AP classification and pulse "
                            "direction match the simulated easy axis."
                        ),
                    )
                )

    if mumax.anisotropy_constant is None:
        result.errors.append(
            JobError(
                code="mumax3-anisotropy-constant-missing",
                field="solverDrafts.mumax3.anisotropyConstant",
                message="anisotropyConstant (Ku1) is required for switching_v1.",
            )
        )
    else:
        try:
            ku1 = to_si(mumax.anisotropy_constant, kind="anisotropy")
            if ku1 <= 0:
                result.errors.append(
                    JobError(
                        code="mumax3-anisotropy-constant-nonpositive",
                        field="solverDrafts.mumax3.anisotropyConstant",
                        message="anisotropyConstant (Ku1) must be positive.",
                    )
                )
        except UnsupportedUnitError as exc:
            result.errors.append(
                JobError(
                    code="mumax3-anisotropy-constant-unit",
                    field="solverDrafts.mumax3.anisotropyConstant",
                    message=str(exc),
                )
            )

    if mumax.state_preset in {"transition_0_to_1", "transition_1_to_0"}:
        _validate_field_pulse(request, result)
    else:
        result.warnings.append(
            JobWarning(
                code="mumax3-static-preset-zero-torque",
                field="solverDrafts.mumax3.statePreset",
                message=(
                    "Static P/AP presets start collinear with the easy axis and the applied "
                    "field, so the LLG torque m x H_eff is analytically zero and the returned "
                    "trajectory is expected to be static apart from numerical noise."
                ),
            )
        )
    _validate_switching_field_consistency(request, result)

    result.warnings.append(
        JobWarning(
            code="mumax3-switching-threshold-postrun-only",
            field="solverDrafts.mumax3.switchingThreshold",
            message=(
                "switchingThreshold classifies the returned trajectory after the run; "
                "it does not alter MuMax3 LLG dynamics."
            ),
        )
    )

    result.warnings.append(
        JobWarning(
            code="mumax3-switching-v1-scope",
            field="solverDrafts.mumax3.modelKind",
            message=(
                "switching_v1 models one free layer with uniaxial anisotropy and "
                "field-pulse excitation only. MgO, pinned-layer dynamics, tunneling, "
                "TMR, resistance, retention, and current torque are not simulated."
            ),
        )
    )


def _validate_switching_field_consistency(
    request: SimulationRequest,
    result: MumaxValidation,
) -> None:
    """
    Compare the requested field pulse with the coherent-rotation switching field.

    For a uniaxial single-domain free layer the Stoner-Wohlfarth switching field for
    a field applied antiparallel to the easy axis is the anisotropy field
    mu0*H_k = 2*K_eff/Msat. A thin film magnetised out of plane also pays the shape
    term, so K_eff = Ku1 - mu0*Msat^2/2 there. A pulse below that threshold cannot
    reverse the layer, so requesting a transition with one is not a physical request.
    """
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    if mumax.anisotropy_constant is None or mumax.saturation_magnetization is None:
        return
    try:
        ku1 = to_si(mumax.anisotropy_constant, kind="anisotropy")
        msat = to_si(mumax.saturation_magnetization, kind="magnetization")
    except UnsupportedUnitError:
        return
    if not (isfinite(ku1) and isfinite(msat)) or msat <= 0 or ku1 <= 0:
        return

    axis = mumax.anisotropy_axis
    axis_norm = sqrt(axis.x**2 + axis.y**2 + axis.z**2) if axis is not None else 0.0
    if not isfinite(axis_norm) or axis_norm <= 0:
        return
    out_of_plane = abs(axis.z) / axis_norm > 0.9  # type: ignore[union-attr]

    shape_term = MU0 * msat**2 / 2 if out_of_plane else 0.0
    k_eff = ku1 - shape_term
    if out_of_plane and k_eff <= 0:
        result.errors.append(
            JobError(
                code="mumax3-anisotropy-below-demag",
                field="solverDrafts.mumax3.anisotropyConstant",
                message=(
                    f"Ku1={ku1:.4g} J/m^3 does not exceed the thin-film shape term "
                    f"mu0*Msat^2/2={shape_term:.4g} J/m^3, so the requested out-of-plane easy "
                    "axis is not the energy minimum and the stated P/AP states are not stable. "
                    "Raise Ku1 or lower Msat."
                ),
            )
        )
        return

    switching_field_t = 2 * k_eff / msat
    result.warnings.append(
        JobWarning(
            code="mumax3-switching-field-estimate",
            field="solverDrafts.mumax3.anisotropyConstant",
            message=(
                f"Coherent-rotation switching field mu0*H_k = 2*K_eff/Msat = {switching_field_t:.4g} T "
                f"(K_eff = {k_eff:.4g} J/m^3"
                + (f", including thin-film shape term {shape_term:.4g} J/m^3" if out_of_plane else "")
                + "). Macrospin estimate only; MuMax3 solves the full LLG problem."
            ),
        )
    )

    if mumax.state_preset not in {"transition_0_to_1", "transition_1_to_0"}:
        return
    if mumax.field_pulse_amplitude is None:
        return
    try:
        pulse = to_si(mumax.field_pulse_amplitude, kind="field")
        bias_x, bias_y, bias_z = (
            to_si(request.solver_drafts.mumax3.external_field.x, kind="field"),  # type: ignore[union-attr]
            to_si(request.solver_drafts.mumax3.external_field.y, kind="field"),  # type: ignore[union-attr]
            to_si(request.solver_drafts.mumax3.external_field.z, kind="field"),  # type: ignore[union-attr]
        ) if mumax.external_field is not None else (0.0, 0.0, 0.0)
    except (UnsupportedUnitError, AttributeError):
        return
    if not isfinite(pulse) or pulse <= 0:
        return

    # The script applies bias + pulse along the target direction (+/- easy axis).
    target_sign = 1.0 if mumax.state_preset == "transition_0_to_1" else -1.0
    pinned = mumax.pinned_direction
    pinned_norm = sqrt(pinned.x**2 + pinned.y**2 + pinned.z**2)
    if not isfinite(pinned_norm) or pinned_norm <= 0:
        return
    unit = (pinned.x / pinned_norm, pinned.y / pinned_norm, pinned.z / pinned_norm)
    bias_along_target = target_sign * (
        bias_x * unit[0] + bias_y * unit[1] + bias_z * unit[2]
    )
    drive = pulse + bias_along_target

    if drive < switching_field_t:
        result.errors.append(
            JobError(
                code="mumax3-pulse-below-switching-field",
                field="solverDrafts.mumax3.fieldPulseAmplitude",
                message=(
                    f"Requested transition needs at least mu0*H_k = {switching_field_t:.4g} T along the "
                    f"easy axis, but the script would apply {drive:.4g} T "
                    f"(pulse {pulse:.4g} T, bias projection {bias_along_target:+.4g} T). "
                    "Coherent rotation cannot reverse the layer, so the run is blocked instead of "
                    "producing a static trajectory labelled as a switching attempt."
                ),
            )
        )
    elif drive < 1.2 * switching_field_t:
        result.warnings.append(
            JobWarning(
                code="mumax3-pulse-marginal",
                field="solverDrafts.mumax3.fieldPulseAmplitude",
                message=(
                    f"Applied easy-axis drive {drive:.4g} T is within 20 percent of the "
                    f"{switching_field_t:.4g} T switching field. Reversal may be incomplete or "
                    "slower than the requested pulse duration."
                ),
            )
        )


def _validate_field_pulse(
    request: SimulationRequest,
    result: MumaxValidation,
) -> None:
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    if mumax.field_pulse_amplitude is None:
        result.errors.append(
            JobError(
                code="mumax3-field-pulse-missing",
                field="solverDrafts.mumax3.fieldPulseAmplitude",
                message="A positive fieldPulseAmplitude is required for a transition preset.",
            )
        )
    else:
        try:
            pulse = to_si(mumax.field_pulse_amplitude, kind="field")
            if pulse <= 0:
                result.errors.append(
                    JobError(
                        code="mumax3-field-pulse-nonpositive",
                        field="solverDrafts.mumax3.fieldPulseAmplitude",
                        message="fieldPulseAmplitude must be positive.",
                    )
                )
        except UnsupportedUnitError as exc:
            result.errors.append(
                JobError(
                    code="mumax3-field-pulse-unit",
                    field="solverDrafts.mumax3.fieldPulseAmplitude",
                    message=str(exc),
                )
            )

    if mumax.field_pulse_duration is None:
        result.errors.append(
            JobError(
                code="mumax3-field-pulse-duration-missing",
                field="solverDrafts.mumax3.fieldPulseDuration",
                message="fieldPulseDuration is required for a transition preset.",
            )
        )
        return
    try:
        pulse_duration = to_si(mumax.field_pulse_duration, kind="time")
        total_time = to_si(
            mumax.simulation_time or request.controls.duration, kind="time"
        )
        if pulse_duration <= 0 or pulse_duration >= total_time:
            result.errors.append(
                JobError(
                    code="mumax3-field-pulse-duration-range",
                    field="solverDrafts.mumax3.fieldPulseDuration",
                    message=(
                        "fieldPulseDuration must be positive and shorter than "
                        "the total simulation time."
                    ),
                )
            )
    except UnsupportedUnitError as exc:
        result.errors.append(
            JobError(
                code="mumax3-field-pulse-duration-unit",
                field="solverDrafts.mumax3.fieldPulseDuration",
                message=str(exc),
            )
        )
