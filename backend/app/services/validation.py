"""UI/request-level validation. Not a physics feasibility check."""

from __future__ import annotations

import math

from app.models.jobs import JobError, JobWarning
from app.models.simulation import (
    CURRENT_DENSITY_UNITS,
    DIMENSIONLESS_UNITS,
    ENERGY_UNITS,
    EXCHANGE_UNITS,
    FIELD_UNITS,
    LENGTH_UNITS,
    MAGNETIZATION_UNITS,
    TEMPERATURE_UNITS,
    TIME_UNITS,
    Quantity,
    SimulationRequest,
)


class ValidationResult:
    def __init__(self) -> None:
        self.errors: list[JobError] = []
        self.warnings: list[JobWarning] = []

    @property
    def ok(self) -> bool:
        return not self.errors


def _unit_ok(quantity: Quantity, allowed: set[str], field: str, label: str, result: ValidationResult) -> None:
    if quantity.unit not in allowed:
        result.errors.append(
            JobError(
                code=f"{field}-unit",
                field=field,
                message=f"{label} has an invalid unit '{quantity.unit}'.",
            )
        )


def _positive(quantity: Quantity, field: str, label: str, result: ValidationResult) -> None:
    if quantity.value <= 0:
        result.errors.append(
            JobError(
                code=f"{field}-nonpositive",
                field=field,
                message=f"{label} must be a positive number.",
            )
        )


def _nonnegative(quantity: Quantity, field: str, label: str, result: ValidationResult) -> None:
    if quantity.value < 0:
        result.errors.append(
            JobError(
                code=f"{field}-negative",
                field=field,
                message=f"{label} must be zero or positive.",
            )
        )


def _length_m(quantity: Quantity) -> float:
    factors = {"m": 1.0, "um": 1e-6, "nm": 1e-9}
    return quantity.value * factors.get(quantity.unit, float("nan"))


def _optional_quantity(
    quantity: Quantity | None,
    allowed: set[str],
    field: str,
    label: str,
    result: ValidationResult,
    *,
    require_positive: bool = False,
) -> None:
    if quantity is None:
        return
    _unit_ok(quantity, allowed, field, label, result)
    if require_positive:
        _positive(quantity, field, label, result)


def validate_simulation_request(request: SimulationRequest) -> ValidationResult:
    """Validate structured request integrity. Does not claim scientific validity."""
    result = ValidationResult()

    if not request.title.strip():
        result.errors.append(
            JobError(code="title-missing", field="title", message="Scenario title is required.")
        )
    if not request.scenario_id.strip():
        result.errors.append(
            JobError(
                code="scenario-id-missing",
                field="scenarioId",
                message="Scenario id is required.",
            )
        )

    length_fields = [
        (request.geometry.free_layer_thickness, "geometry.freeLayerThickness", "Free layer thickness"),
        (request.geometry.free_layer_length, "geometry.freeLayerLength", "Free layer length"),
        (request.geometry.free_layer_width, "geometry.freeLayerWidth", "Free layer width"),
        (request.geometry.barrier_thickness, "geometry.barrierThickness", "Barrier thickness"),
        (
            request.geometry.reference_layer_thickness,
            "geometry.referenceLayerThickness",
            "Reference layer thickness",
        ),
    ]
    for quantity, field, label in length_fields:
        _unit_ok(quantity, LENGTH_UNITS, field, label, result)
        _positive(quantity, field, label, result)

    _unit_ok(request.controls.duration, TIME_UNITS, "controls.duration", "Duration", result)
    _positive(request.controls.duration, "controls.duration", "Duration", result)
    _unit_ok(
        request.controls.temperature,
        TEMPERATURE_UNITS,
        "controls.temperature",
        "Temperature",
        result,
    )
    _nonnegative(request.controls.temperature, "controls.temperature", "Temperature", result)

    if request.controls.viewport_zoom <= 0:
        result.errors.append(
            JobError(
                code="controls.viewportZoom-nonpositive",
                field="controls.viewportZoom",
                message="Viewport zoom must be positive.",
            )
        )

    materials = request.materials
    if not materials.free_layer_id or not materials.reference_layer_id or not materials.barrier_id:
        result.errors.append(
            JobError(
                code="materials-empty",
                field="materials",
                message="Free, reference, and barrier materials must all be selected.",
            )
        )
    else:
        result.warnings.append(
            JobWarning(
                code="materials-unverified",
                field="materials",
                message="Material ids are accepted as labels only; constants are not verified by this API.",
            )
        )

    if request.requested_solver not in {"demo", "python_llg", "mumax3"}:
        result.warnings.append(
            JobWarning(
                code="solver-pending",
                field="requestedSolver",
                message=(
                    f"{request.requested_solver} integration is pending. "
                    "This API will not fabricate a successful solve."
                ),
            )
        )

    if request.torque and request.torque.enabled:
        _optional_quantity(
            request.torque.current_density,
            CURRENT_DENSITY_UNITS,
            "torque.currentDensity",
            "Torque current density",
            result,
        )
        _optional_quantity(
            request.torque.polarization,
            DIMENSIONLESS_UNITS,
            "torque.polarization",
            "Torque polarization",
            result,
        )

    if request.initial_magnetization and request.initial_magnetization.vector:
        vector = request.initial_magnetization.vector
        norm = math.hypot(vector.x, vector.y, vector.z)
        if not math.isfinite(norm):
            result.errors.append(
                JobError(
                    code="initialMagnetization.vector-finite",
                    field="initialMagnetization.vector",
                    message="Initial magnetization components must be finite.",
                )
            )
        elif abs(norm - 1.0) > 0.01:
            result.warnings.append(
                JobWarning(
                    code="initialMagnetization.vector-normalized",
                    field="initialMagnetization.vector",
                    message=f"Initial magnetization is not normalized (norm {norm:.3f}).",
                )
            )

    if request.external_field:
        for axis, quantity in (
            ("x", request.external_field.x),
            ("y", request.external_field.y),
            ("z", request.external_field.z),
        ):
            _optional_quantity(
                quantity,
                FIELD_UNITS,
                f"externalField.{axis}",
                f"External field {axis}",
                result,
            )

    drafts = request.solver_drafts
    if drafts and drafts.mumax3:
        mumax = drafts.mumax3
        for axis, quantity, dimension in (
            ("x", mumax.mesh_cell_size.x, request.geometry.free_layer_length),
            ("y", mumax.mesh_cell_size.y, request.geometry.free_layer_width),
            ("z", mumax.mesh_cell_size.z, request.geometry.free_layer_thickness),
        ):
            field = f"solverDrafts.mumax3.meshCellSize.{axis}"
            _unit_ok(quantity, LENGTH_UNITS, field, f"Mesh cell {axis}", result)
            _positive(quantity, field, f"Mesh cell {axis}", result)
            if (
                quantity.unit in LENGTH_UNITS
                and dimension.unit in LENGTH_UNITS
                and math.isfinite(_length_m(quantity))
                and math.isfinite(_length_m(dimension))
                and _length_m(quantity) > _length_m(dimension)
            ):
                result.errors.append(
                    JobError(
                        code=f"mesh-{axis}-dimension",
                        field=field,
                        message=(
                            f"Mesh cell {axis} must be smaller than the corresponding device dimension."
                        ),
                    )
                )
        _optional_quantity(
            mumax.saturation_magnetization,
            MAGNETIZATION_UNITS,
            "solverDrafts.mumax3.saturationMagnetization",
            "Saturation magnetization",
            result,
        )
        _optional_quantity(
            mumax.exchange_stiffness,
            EXCHANGE_UNITS,
            "solverDrafts.mumax3.exchangeStiffness",
            "Exchange stiffness",
            result,
        )
        _optional_quantity(
            mumax.damping_alpha,
            DIMENSIONLESS_UNITS,
            "solverDrafts.mumax3.dampingAlpha",
            "Damping alpha",
            result,
        )
        _optional_quantity(
            mumax.current_density,
            CURRENT_DENSITY_UNITS,
            "solverDrafts.mumax3.currentDensity",
            "Current density",
            result,
        )
        if mumax.anisotropy_axis:
            norm = math.hypot(
                mumax.anisotropy_axis.x,
                mumax.anisotropy_axis.y,
                mumax.anisotropy_axis.z,
            )
            if math.isfinite(norm) and abs(norm - 1.0) > 0.01:
                result.warnings.append(
                    JobWarning(
                        code="solverDrafts.mumax3.anisotropyAxis-normalized",
                        field="solverDrafts.mumax3.anisotropyAxis",
                        message=f"Anisotropy axis is not normalized (norm {norm:.3f}).",
                    )
                )

    if drafts and drafts.kwant:
        kwant = drafts.kwant
        _optional_quantity(
            kwant.hopping_energy,
            ENERGY_UNITS,
            "solverDrafts.kwant.hoppingEnergy",
            "Hopping energy",
            result,
        )
        _optional_quantity(
            kwant.onsite_energy,
            ENERGY_UNITS,
            "solverDrafts.kwant.onsiteEnergy",
            "Onsite energy",
            result,
        )
        _optional_quantity(
            kwant.spin_orbit_coupling,
            ENERGY_UNITS,
            "solverDrafts.kwant.spinOrbitCoupling",
            "Spin-orbit coupling",
            result,
        )
        result.warnings.append(
            JobWarning(
                code="kwant-draft-only",
                field="solverDrafts.kwant",
                message="Kwant fields are request-shaping drafts only; transport is not evaluated.",
            )
        )

    return result
