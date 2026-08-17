"""Exact 1D stationary scattering on a finite rectangular barrier.

Not Kwant, not NEGF, not coupled to the LLG integrator.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import pi
import cmath

HBAR = 1.054571817e-34
M_E = 9.1093837015e-31
EV = 1.602176634e-19


@dataclass(frozen=True)
class BarrierResult:
    r: complex
    t: complex
    reflection: float
    transmission: float


def scatter(
    *,
    width_m: float,
    height_ev: float,
    energy_ev: float,
    mass_ratio: float = 0.4,
) -> BarrierResult:
    if width_m <= 0 or height_ev <= 0 or energy_ev <= 0 or mass_ratio <= 0:
        raise ValueError("Barrier width, height, energy, and mass ratio must be positive.")
    mass = mass_ratio * M_E
    e_j = energy_ev * EV
    v_j = height_ev * EV
    k = (2.0 * mass * e_j) ** 0.5 / HBAR
    q2 = 2.0 * mass * (e_j - v_j) / HBAR**2
    q = q2**0.5
    d = width_m
    eqd = cmath.exp(1j * q * d)
    emqd = cmath.exp(-1j * q * d)

    # Unknowns: r, A, B, t
    # x=0: 1+r = A+B
    #       ik(1-r) = iq(A-B)
    # x=d:  A e^{iqd}+B e^{-iqd} = t
    #       iq(A e^{iqd}-B e^{-iqd}) = ik t
    m00, m01, m02, m03 = 1, -1, -1, 0
    m10, m11, m12, m13 = -1j * k, -1j * q, 1j * q, 0
    m20, m21, m22, m23 = 0, eqd, emqd, -1
    m30, m31, m32, m33 = 0, 1j * q * eqd, -1j * q * emqd, -1j * k
    rhs = [-1, -1j * k, 0, 0]

    a = [
        [m00, m01, m02, m03],
        [m10, m11, m12, m13],
        [m20, m21, m22, m23],
        [m30, m31, m32, m33],
    ]
    sol = _solve4(a, rhs)
    r, _a, _b, t = sol
    reflection = abs(r) ** 2
    transmission = abs(t) ** 2  # k_R/k_L = 1
    return BarrierResult(r=r, t=t, reflection=reflection, transmission=transmission)


def schrodinger_phase_rad(energy_ev: float, time_s: float) -> float:
    return ((energy_ev * EV) * time_s / HBAR) % (2.0 * pi)


def _solve4(matrix: list[list[complex]], rhs: list[complex]) -> list[complex]:
    a = [row[:] + [rhs[i]] for i, row in enumerate(matrix)]
    n = 4
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        a[col], a[pivot] = a[pivot], a[col]
        if abs(a[col][col]) < 1e-30:
            raise ValueError("Singular barrier matching matrix.")
        scale = a[col][col]
        for j in range(col, n + 1):
            a[col][j] /= scale
        for row in range(n):
            if row == col:
                continue
            factor = a[row][col]
            for j in range(col, n + 1):
                a[row][j] -= factor * a[col][j]
    return [a[i][n] for i in range(n)]
