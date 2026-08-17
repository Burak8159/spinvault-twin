"""In-plane magnetic masks for the nz=1 free-layer mesh."""

from __future__ import annotations

import numpy as np

from app.solvers.python_llg.engine import Vec, normalize


def cell_centers(nx: int, ny: int, dx: float, dy: float) -> tuple[np.ndarray, np.ndarray]:
    """Return (x, y) arrays of shape (ny, nx) with cell-center coordinates.

    The mesh is centered on the origin so an ellipse/rectangle of size
    (nx*dx, ny*dy) is aligned with the grid.
    """
    x = (np.arange(nx, dtype=np.float64) + 0.5) * dx - 0.5 * nx * dx
    y = (np.arange(ny, dtype=np.float64) + 0.5) * dy - 0.5 * ny * dy
    return np.meshgrid(x, y, indexing="xy")


def magnetic_mask(
    nx: int,
    ny: int,
    dx: float,
    dy: float,
    *,
    shape: str = "rectangle",
) -> np.ndarray:
    """Boolean (ny, nx) mask. Vacuum cells are False and stay m = 0."""
    if nx <= 0 or ny <= 0:
        raise ValueError("Mesh dimensions must be positive.")
    if shape in {"rectangle", "nanowire", "custom"}:
        return np.ones((ny, nx), dtype=bool)
    xs, ys = cell_centers(nx, ny, dx, dy)
    rx = 0.5 * nx * dx
    ry = 0.5 * ny * dy
    if rx <= 0.0 or ry <= 0.0:
        raise ValueError("Cell size must be positive.")
    return (xs / rx) ** 2 + (ys / ry) ** 2 <= 1.0 + 1e-12


def uniform_magnetization(mask: np.ndarray, vector: Vec) -> np.ndarray:
    """(ny, nx, 3) magnetization with `vector` on magnetic cells and 0 in vacuum."""
    ny, nx = mask.shape
    m = np.zeros((ny, nx, 3), dtype=np.float64)
    unit = normalize(vector)
    m[mask, 0] = unit[0]
    m[mask, 1] = unit[1]
    m[mask, 2] = unit[2]
    return m


def random_magnetization(mask: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Uniform random unit vectors on magnetic cells."""
    ny, nx = mask.shape
    raw = rng.normal(size=(ny, nx, 3))
    norm = np.linalg.norm(raw, axis=2, keepdims=True)
    norm = np.where(norm < 1e-30, 1.0, norm)
    m = raw / norm
    m[~mask] = 0.0
    return m


def normalize_active(m: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Project magnetic cells onto the unit sphere. Vacuum stays zero."""
    out = np.array(m, dtype=np.float64, copy=True)
    active = out[mask]
    norm = np.linalg.norm(active, axis=1, keepdims=True)
    tiny = norm[:, 0] < 1e-30
    if np.any(tiny):
        active[tiny] = np.array([0.0, 0.0, 1.0])
        norm[tiny] = 1.0
    out[mask] = active / norm
    out[~mask] = 0.0
    return out


def max_norm_drift(m: np.ndarray, mask: np.ndarray) -> float:
    if not np.any(mask):
        return 0.0
    norms = np.linalg.norm(m[mask], axis=1)
    return float(np.max(np.abs(norms - 1.0)))
