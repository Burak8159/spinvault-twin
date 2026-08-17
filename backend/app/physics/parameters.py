"""Authoritative SI constants and mesh-quality calculations.

This module performs calculations only. It does not infer material parameters
or claim that satisfying one mesh criterion establishes convergence.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import isfinite, pi, sqrt

MU0_H_PER_M = 4.0 * pi * 1e-7
BOLTZMANN_CONSTANT_J_PER_K = 1.380649e-23


def exchange_length_m(*, exchange_stiffness_j_per_m: float, saturation_magnetization_a_per_m: float) -> float:
    """Return magnetostatic exchange length sqrt(2 A / (mu0 Ms^2)) in metres."""
    if not isfinite(exchange_stiffness_j_per_m) or exchange_stiffness_j_per_m <= 0:
        raise ValueError("exchange_stiffness_j_per_m must be finite and positive")
    if not isfinite(saturation_magnetization_a_per_m) or saturation_magnetization_a_per_m <= 0:
        raise ValueError("saturation_magnetization_a_per_m must be finite and positive")
    return sqrt(
        2.0
        * exchange_stiffness_j_per_m
        / (MU0_H_PER_M * saturation_magnetization_a_per_m**2)
    )


@dataclass(frozen=True)
class MeshAssessment:
    """One necessary mesh check; not a convergence certificate."""

    exchange_length_m: float
    cell_x_m: float
    cell_y_m: float
    cell_z_m: float
    max_cell_to_exchange_length: float
    cells_across_x: int
    cells_across_y: int
    cells_through_thickness: int
    criterion: str
    status: str
    converged: bool

    def as_dict(self) -> dict[str, float | int | str | bool]:
        return asdict(self)


def mesh_assessment(
    *,
    exchange_stiffness_j_per_m: float,
    saturation_magnetization_a_per_m: float,
    cell_x_m: float,
    cell_y_m: float,
    cell_z_m: float,
    cells_across_x: int,
    cells_across_y: int,
    cells_through_thickness: int,
    max_cell_fraction: float = 0.5,
) -> MeshAssessment:
    """Assess cells against a declared fraction of exchange length.

    The default requirement max(dx,dy,dz) <= 0.5*l_ex is deliberately
    conservative for the initial reference experiment. Passing it only means
    that this pre-run criterion is satisfied; mesh convergence still requires
    comparisons across progressively finer meshes.
    """
    cells = (cell_x_m, cell_y_m, cell_z_m)
    if any(not isfinite(value) or value <= 0 for value in cells):
        raise ValueError("cell dimensions must be finite and positive")
    if any(value <= 0 for value in (cells_across_x, cells_across_y, cells_through_thickness)):
        raise ValueError("cell counts must be positive")
    if not isfinite(max_cell_fraction) or not 0 < max_cell_fraction <= 1:
        raise ValueError("max_cell_fraction must be in (0, 1]")

    exchange = exchange_length_m(
        exchange_stiffness_j_per_m=exchange_stiffness_j_per_m,
        saturation_magnetization_a_per_m=saturation_magnetization_a_per_m,
    )
    ratio = max(cells) / exchange
    passes = ratio <= max_cell_fraction
    criterion = f"max(dx,dy,dz) <= {max_cell_fraction:g} * exchange_length"
    return MeshAssessment(
        exchange_length_m=exchange,
        cell_x_m=cell_x_m,
        cell_y_m=cell_y_m,
        cell_z_m=cell_z_m,
        max_cell_to_exchange_length=ratio,
        cells_across_x=cells_across_x,
        cells_across_y=cells_across_y,
        cells_through_thickness=cells_through_thickness,
        criterion=criterion,
        status="PASS_PRECHECK" if passes else "FAIL_PRECHECK",
        converged=False,
    )
