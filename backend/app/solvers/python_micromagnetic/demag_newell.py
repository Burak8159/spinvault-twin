"""Finite-cell Newell demagnetizing tensor with zero-padded FFT convolution.

Open boundaries only: the kernel is the analytic cuboid interaction tensor
and magnetization is zero-padded to at least 2 nx × 2 ny before the FFT.
Periodic (unpadded) FFTs are never used.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np

from app.solvers.python_llg.engine import MU0

_KERNEL_CACHE: dict[tuple, "DemagOperator"] = {}


def _asinh_ratio(numerator: np.ndarray, hypot_pair: np.ndarray) -> np.ndarray:
    """arcsinh(num / hypot) with 0/0 → 0 so Newell corner terms stay finite."""
    safe = np.where(hypot_pair < 1e-30, 1.0, hypot_pair)
    return np.arcsinh(np.where(hypot_pair < 1e-30, 0.0, numerator / safe))


def _finite(term: np.ndarray) -> np.ndarray:
    return np.where(np.isfinite(term), term, 0.0)


def newell_f(x: np.ndarray, y: np.ndarray, z: np.ndarray) -> np.ndarray:
    """Newell's F (diagonal). Coordinates enter as absolute values."""
    x = np.abs(np.asarray(x, dtype=np.float64))
    y = np.abs(np.asarray(y, dtype=np.float64))
    z = np.abs(np.asarray(z, dtype=np.float64))
    x2, y2, z2 = x * x, y * y, z * z
    r = np.sqrt(x2 + y2 + z2)
    term = (
        (2.0 * x2 - y2 - z2) * r / 6.0
        + 0.5 * y * (z2 - x2) * _asinh_ratio(y, np.sqrt(x2 + z2))
        + 0.5 * z * (y2 - x2) * _asinh_ratio(z, np.sqrt(x2 + y2))
        - x * y * z * np.arctan(y * z / (x * r + 1e-30))
    )
    return _finite(np.where(r < 1e-30, 0.0, term))


def newell_g(x: np.ndarray, y: np.ndarray, z: np.ndarray) -> np.ndarray:
    """Newell's G (off-diagonal). Only z is taken in absolute value."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    z = np.abs(np.asarray(z, dtype=np.float64))
    x2, y2, z2 = x * x, y * y, z * z
    r = np.sqrt(x2 + y2 + z2)
    term = (
        -x * y * r / 3.0
        + x * y * z * _asinh_ratio(z, np.sqrt(x2 + y2))
        + (y / 6.0) * (3.0 * z2 - y2) * _asinh_ratio(x, np.sqrt(y2 + z2))
        + (x / 6.0) * (3.0 * z2 - x2) * _asinh_ratio(y, np.sqrt(x2 + z2))
        - (z2 * z / 6.0) * np.arctan(x * y / (z * r + 1e-30))
        - (z * y2 / 2.0) * np.arctan(x * z / (y * r + 1e-30))
        - (z * x2 / 2.0) * np.arctan(y * z / (x * r + 1e-30))
    )
    return _finite(np.where(r < 1e-30, 0.0, term))


def _newell_diff(func, x, y, z, dx: float, dy: float, dz: float, dX: float, dY: float, dZ: float):
    """64-term Newell difference for identical or non-identical cuboids (magnum.np)."""

    def f1(xx, yy, zz):
        return (
            func(xx, yy, zz + dZ)
            - func(xx, yy, zz)
            - func(xx, yy, zz - dz + dZ)
            + func(xx, yy, zz - dz)
        )

    def f0(xx, yy, zz):
        return (
            f1(xx, yy + dY, zz)
            - f1(xx, yy, zz)
            - f1(xx, yy - dy + dY, zz)
            + f1(xx, yy - dy, zz)
        )

    res = f0(x, y, z) - f0(x - dx, y, z) - f0(x + dX, y, z) + f0(x - dx + dX, y, z)
    return -res / (4.0 * np.pi * dx * dy * dz)


def demag_tensor_components(
    x: np.ndarray,
    y: np.ndarray,
    z: np.ndarray,
    dx: float,
    dy: float,
    dz: float,
) -> dict[str, np.ndarray]:
    """Return Nxx..Nyz at center-to-center offsets. H = -N M with tr(N_self)=1."""
    # magnum.np newell() already includes the magnetostatic minus (self Nxx < 0).
    nxx_m = _newell_diff(newell_f, x, y, z, dx, dy, dz, dx, dy, dz)
    nyy_m = _newell_diff(newell_f, y, z, x, dy, dz, dx, dy, dz, dx)
    nzz_m = _newell_diff(newell_f, z, x, y, dz, dx, dy, dz, dx, dy)
    nxy_m = _newell_diff(newell_g, x, y, z, dx, dy, dz, dx, dy, dz)
    nxz_m = _newell_diff(newell_g, x, z, y, dx, dz, dy, dx, dz, dy)
    nyz_m = _newell_diff(newell_g, y, z, x, dy, dz, dx, dy, dz, dx)
    return {
        "xx": -nxx_m,
        "yy": -nyy_m,
        "zz": -nzz_m,
        "xy": -nxy_m,
        "xz": -nxz_m,
        "yz": -nyz_m,
    }


def self_demag_tensor(dx: float, dy: float, dz: float) -> tuple[float, float, float]:
    """Nxx, Nyy, Nzz of a single cuboid (trace must be 1)."""
    tensor = demag_tensor_components(0.0, 0.0, 0.0, dx, dy, dz)
    return float(np.asarray(tensor["xx"])), float(np.asarray(tensor["yy"])), float(np.asarray(tensor["zz"]))


def _lag_mesh(nx: int, ny: int, dx: float, dy: float) -> tuple[np.ndarray, np.ndarray]:
    lx = np.arange(-(nx - 1), nx, dtype=np.float64)
    ly = np.arange(-(ny - 1), ny, dtype=np.float64)
    x, y = np.meshgrid(lx * dx, ly * dy, indexing="xy")
    return x, y


def realspace_kernel(nx: int, ny: int, dx: float, dy: float, dz: float) -> dict[str, np.ndarray]:
    """Newell tensor on lags [-(n-1)..(n-1)], shape (2 ny - 1, 2 nx - 1)."""
    x, y = _lag_mesh(nx, ny, dx, dy)
    z = np.zeros_like(x)
    return demag_tensor_components(x, y, z, dx, dy, dz)


def _embed_kernel(real: np.ndarray, pad_y: int, pad_x: int, ny: int, nx: int) -> np.ndarray:
    """Wrap-around embed of the (2ny-1, 2nx-1) lag kernel into a padded FFT array."""
    out = np.zeros((pad_y, pad_x), dtype=np.float64)
    ly = np.arange(-(ny - 1), ny)
    lx = np.arange(-(nx - 1), nx)
    iy = ly % pad_y
    ix = lx % pad_x
    iy_grid, ix_grid = np.meshgrid(iy, ix, indexing="ij")
    out[iy_grid, ix_grid] = real
    return out


class DemagOperator:
    """Cached FFT Newell operator for a 2-D (nz=1) mesh."""

    def __init__(self, nx: int, ny: int, dx: float, dy: float, dz: float, msat: float) -> None:
        if nx <= 0 or ny <= 0:
            raise ValueError("Mesh dimensions must be positive.")
        self.nx = nx
        self.ny = ny
        self.dx = dx
        self.dy = dy
        self.dz = dz
        self.msat = msat
        self.pad_y = 2 * ny
        self.pad_x = 2 * nx
        kernels = realspace_kernel(nx, ny, dx, dy, dz)
        self.real = kernels
        self.k_hat = {
            name: np.fft.rfft2(_embed_kernel(array, self.pad_y, self.pad_x, ny, nx))
            for name, array in kernels.items()
        }

    def field_tesla(self, m: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """B_d = μ0 H_d with H_d = -Ms N*m. Vacuum cells are zero."""
        ny, nx = self.ny, self.nx
        mx = np.zeros((self.pad_y, self.pad_x), dtype=np.float64)
        my = np.zeros((self.pad_y, self.pad_x), dtype=np.float64)
        mz = np.zeros((self.pad_y, self.pad_x), dtype=np.float64)
        mx[:ny, :nx] = m[:, :, 0] * mask
        my[:ny, :nx] = m[:, :, 1] * mask
        mz[:ny, :nx] = m[:, :, 2] * mask
        Mx = np.fft.rfft2(mx)
        My = np.fft.rfft2(my)
        Mz = np.fft.rfft2(mz)
        k = self.k_hat
        Hx = np.fft.irfft2(k["xx"] * Mx + k["xy"] * My + k["xz"] * Mz, s=(self.pad_y, self.pad_x))
        Hy = np.fft.irfft2(k["xy"] * Mx + k["yy"] * My + k["yz"] * Mz, s=(self.pad_y, self.pad_x))
        Hz = np.fft.irfft2(k["xz"] * Mx + k["yz"] * My + k["zz"] * Mz, s=(self.pad_y, self.pad_x))
        h = np.stack((Hx[:ny, :nx], Hy[:ny, :nx], Hz[:ny, :nx]), axis=-1)
        b = -MU0 * self.msat * h
        b[~mask] = 0.0
        return b

    def field_h_over_ms(self, m: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """Return H/Ms = -N*m (dimensionless), useful for kernel checks."""
        return self.field_tesla(m, mask) / (-MU0 * self.msat)


def demag_operator(nx: int, ny: int, dx: float, dy: float, dz: float, msat: float) -> DemagOperator:
    key = (int(nx), int(ny), float(dx), float(dy), float(dz), float(msat))
    cached = _KERNEL_CACHE.get(key)
    if cached is None:
        cached = DemagOperator(nx, ny, dx, dy, dz, msat)
        _KERNEL_CACHE[key] = cached
    return cached


def demag_direct(m: np.ndarray, mask: np.ndarray, dx: float, dy: float, dz: float, msat: float) -> np.ndarray:
    """O(N²) Newell convolution. For tests on tiny meshes only."""
    ny, nx, _ = m.shape
    kernel = realspace_kernel(nx, ny, dx, dy, dz)
    # kernel[ly + (ny-1), lx + (nx-1)] corresponds to lag (lx, ly)
    origin_y = ny - 1
    origin_x = nx - 1
    h = np.zeros_like(m)
    active = np.argwhere(mask)
    for j, i in active:
        acc = np.zeros(3, dtype=np.float64)
        for j2, i2 in active:
            ly = j - j2
            lx = i - i2
            nxx = kernel["xx"][origin_y + ly, origin_x + lx]
            nyy = kernel["yy"][origin_y + ly, origin_x + lx]
            nzz = kernel["zz"][origin_y + ly, origin_x + lx]
            nxy = kernel["xy"][origin_y + ly, origin_x + lx]
            nxz = kernel["xz"][origin_y + ly, origin_x + lx]
            nyz = kernel["yz"][origin_y + ly, origin_x + lx]
            mx, my, mz = m[j2, i2]
            acc[0] += nxx * mx + nxy * my + nxz * mz
            acc[1] += nxy * mx + nyy * my + nyz * mz
            acc[2] += nxz * mx + nyz * my + nzz * mz
        h[j, i] = acc
    b = -MU0 * msat * h
    b[~mask] = 0.0
    return b


@lru_cache(maxsize=32)
def _unused_cache_guard() -> None:
    return None
