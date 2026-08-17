"""Publication-style matplotlib report from real Python micromagnetic frames.

Every spatial panel in this module is rendered directly from
``spinvault-magnetization-npz-v1``.  It never synthesizes a domain texture,
interpolates missing frames, or prescribes a reversal path.

Color is a continuous display mapping of the computed spin direction, and the
maps are resampled bilinearly between computed cell centers so transitions read
as gradients rather than cell blocks.  That resampling is presentation only: the
diagnostics panel plots the same arrays as raw per-cell values, and no panel
invents data outside the returned mesh.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

# Avoid a first-run warning or repeated font-cache rebuild when the API is
# launched from a sandboxed/local environment with a read-only home directory.
_mpl_config = Path(tempfile.gettempdir()) / "spinvault-matplotlib"
_mpl_config.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_mpl_config))

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation, PillowWriter
from matplotlib.colors import LinearSegmentedColormap, hsv_to_rgb

from app.models.simulation import SimulationRequest, SimulationResult
from app.physics.device_chain import (
    SECONDS_PER_YEAR,
    effective_anisotropy,
    free_layer_volume_m3,
    leakage_sweep,
    retention_from_delta,
    thermal_stability,
    tunnel_current_density,
)
from app.solvers.python_micromagnetic.artifact import load_magnetization_npz

REPORT_FORMAT = "spinvault-matplotlib-twin-v1"
REPORT_DIR = "outputs/matplotlib_twin"
REPORT_MANIFEST = "report.json"

INK = "#e2e8f0"
MUTED = "#94a3b8"
GRID = "#1e293b"
BG = "#05070a"
PANEL = "#070b10"
MX = "#60a5fa"
MY = "#fbbf24"
MZ = "#86efac"
TOTAL = "#f8fafc"
EXCHANGE = "#38bdf8"
DEMAG = "#f87171"
ANIS = "#c084fc"

MZ_CMAP = LinearSegmentedColormap.from_list(
    "spinvault_mz",
    [
        (0.0, "#0b2fa8"),
        (0.25, "#3b82f6"),
        (0.46, "#bfdbfe"),
        (0.5, "#f8fafc"),
        (0.54, "#fecaca"),
        (0.75, "#ef4444"),
        (1.0, "#7f1020"),
    ],
)
"""Diverging map with extra stops so mid-range values stay distinguishable."""

CONTRAST_PERCENTILE = 98.0
"""Percentile clip used wherever a panel is explicitly labeled adaptive."""


def _style() -> None:
    plt.rcParams.update(
        {
            "figure.facecolor": BG,
            "savefig.facecolor": BG,
            "axes.facecolor": PANEL,
            "axes.edgecolor": GRID,
            "axes.labelcolor": INK,
            "axes.titlecolor": INK,
            "text.color": INK,
            "xtick.color": MUTED,
            "ytick.color": MUTED,
            "grid.color": GRID,
            "grid.linewidth": 0.55,
            "axes.grid": True,
            "legend.framealpha": 0.0,
            "legend.labelcolor": INK,
            "font.size": 9,
            "axes.titlesize": 10,
            "axes.labelsize": 9,
            "xtick.labelsize": 8,
            "ytick.labelsize": 8,
            "figure.dpi": 110,
            "savefig.dpi": 170,
            "savefig.bbox": "tight",
        }
    )


def _as_dict(result: SimulationResult | dict[str, Any]) -> dict[str, Any]:
    if isinstance(result, SimulationResult):
        return result.model_dump(by_alias=True, mode="json")
    return result


def _series(result: dict[str, Any], series_id: str) -> tuple[np.ndarray, np.ndarray]:
    for item in result.get("series", []):
        if item.get("id") == series_id:
            points = item.get("points", [])
            return (
                np.asarray([point["x"] for point in points], dtype=float),
                np.asarray([point["y"] for point in points], dtype=float),
            )
    return np.asarray([], dtype=float), np.asarray([], dtype=float)


def _robust_limits(
    values: np.ndarray,
    percentile: float = CONTRAST_PERCENTILE,
) -> tuple[float, float]:
    """Percentile-clipped display limits so a narrow data range still uses full color."""
    data = np.asarray(values, dtype=np.float64).ravel()
    data = data[np.isfinite(data)]
    if data.size == 0:
        return -1.0, 1.0
    tail = (100.0 - percentile) / 2.0
    low = float(np.percentile(data, tail))
    high = float(np.percentile(data, 100.0 - tail))
    if high - low < 1e-12:
        center = 0.5 * (low + high)
        return center - 5e-4, center + 5e-4
    return low, high


def _robust_span(values: np.ndarray, percentile: float = CONTRAST_PERCENTILE) -> float:
    """Symmetric percentile-clipped half-range for a zero-centered quantity."""
    data = np.asarray(values, dtype=np.float64).ravel()
    data = data[np.isfinite(data)]
    if data.size == 0:
        return 1.0
    return max(float(np.percentile(np.abs(data), percentile)), 1e-9)


def _metric_map(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(item.get("id")): item for item in result.get("metrics", [])}


def _extent_nm(nx: int, ny: int, dx: float, dy: float) -> tuple[float, float, float, float]:
    return (-0.5 * nx * dx * 1e9, 0.5 * nx * dx * 1e9, -0.5 * ny * dy * 1e9, 0.5 * ny * dy * 1e9)


def _masked_component(field: np.ndarray, mask: np.ndarray, component: int) -> np.ma.MaskedArray:
    return np.ma.array(field[..., component], mask=~mask)


DISPLAY_UPSAMPLE = 8
"""Display-only resampling factor between computed cell centers."""


def _fill_vacuum(field: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Extend active values into vacuum cells so interpolation has no dark halo.

    Vacuum cells hold m = 0, which would otherwise be interpolated as a physical
    value along the device boundary. They are replaced by the nearest active
    neighbors; the alpha channel still hides them.
    """
    filled = np.asarray(field, dtype=np.float64).copy()
    known = np.asarray(mask, dtype=bool).copy()
    ny, nx = known.shape
    while not known.all():
        total = np.zeros_like(filled)
        count = np.zeros((ny, nx), dtype=np.float64)
        for shift_y, shift_x in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src_y = slice(max(0, -shift_y), ny - max(0, shift_y))
            dst_y = slice(max(0, shift_y), ny - max(0, -shift_y))
            src_x = slice(max(0, -shift_x), nx - max(0, shift_x))
            dst_x = slice(max(0, shift_x), nx - max(0, -shift_x))
            shifted = np.zeros_like(filled)
            shifted_known = np.zeros((ny, nx), dtype=bool)
            shifted[dst_y, dst_x] = filled[src_y, src_x]
            shifted_known[dst_y, dst_x] = known[src_y, src_x]
            total[shifted_known] += shifted[shifted_known]
            count += shifted_known
        newly = (~known) & (count > 0.0)
        if not np.any(newly):
            break
        filled[newly] = total[newly] / count[newly][:, None]
        known |= newly
    return filled


def _bilinear_upsample(values: np.ndarray, factor: int = DISPLAY_UPSAMPLE) -> np.ndarray:
    """Bilinearly resample a cell-centered array for display only."""
    data = np.asarray(values, dtype=np.float64)
    if factor <= 1:
        return data.copy()
    ny, nx = data.shape[:2]
    fine_y = np.clip((np.arange(ny * factor) + 0.5) / factor - 0.5, 0.0, ny - 1.0)
    fine_x = np.clip((np.arange(nx * factor) + 0.5) / factor - 0.5, 0.0, nx - 1.0)
    y0 = np.floor(fine_y).astype(int)
    x0 = np.floor(fine_x).astype(int)
    y1 = np.minimum(y0 + 1, ny - 1)
    x1 = np.minimum(x0 + 1, nx - 1)
    if data.ndim == 2:
        weight_y = (fine_y - y0)[:, None]
        weight_x = (fine_x - x0)[None, :]
    else:
        weight_y = (fine_y - y0)[:, None, None]
        weight_x = (fine_x - x0)[None, :, None]
    lower = data[y0][:, x0] * (1.0 - weight_x) + data[y0][:, x1] * weight_x
    upper = data[y1][:, x0] * (1.0 - weight_x) + data[y1][:, x1] * weight_x
    return lower * (1.0 - weight_y) + upper * weight_y


LIGHTNESS_MID = 0.56
LIGHTNESS_SWING = 0.28
"""Lightness band for mz. Bounded away from 0 and 1 so no orientation is invisible."""

SATURATION_GAMMA = 0.45
"""Saturation boost. <1 lifts small in-plane tilts into visible hue."""


def _orientation_rgb(field: np.ndarray) -> np.ndarray:
    """Continuous color for a full 3-D spin direction.

    Hue is the in-plane angle and lightness rises with mz, so every direction on
    the unit sphere maps to a distinct color and neighboring directions map to
    neighboring colors. Saturation follows the in-plane magnitude because hue is
    undefined at the poles; the lightness band keeps -z dark grey rather than
    black so a fully perpendicular state is still legible. Saturation is raised
    by a gamma so a few-degree tilt is still a visible hue rather than grey.
    """
    vectors = np.asarray(field, dtype=np.float64)
    norm = np.linalg.norm(vectors, axis=-1)
    unit = vectors / np.where(norm < 1e-12, 1.0, norm)[..., None]
    hue = (np.arctan2(unit[..., 1], unit[..., 0]) / (2.0 * np.pi)) % 1.0
    mz = np.clip(unit[..., 2], -1.0, 1.0)
    in_plane = np.sqrt(np.clip(1.0 - mz * mz, 0.0, 1.0)) ** SATURATION_GAMMA

    lightness = LIGHTNESS_MID + LIGHTNESS_SWING * mz
    value = lightness + in_plane * np.minimum(lightness, 1.0 - lightness)
    safe_value = np.where(value <= 1e-12, 1.0, value)
    saturation = np.where(value <= 1e-12, 0.0, 2.0 * (1.0 - lightness / safe_value))
    return hsv_to_rgb(
        np.stack([hue, np.clip(saturation, 0.0, 1.0), np.clip(value, 0.0, 1.0)], axis=-1)
    )


def _orientation_image(
    field: np.ndarray,
    mask: np.ndarray,
    factor: int = DISPLAY_UPSAMPLE,
) -> np.ndarray:
    """RGBA orientation image with gradual transitions between computed cells."""
    smooth = _bilinear_upsample(_fill_vacuum(field, mask), factor)
    alpha = np.clip(_bilinear_upsample(np.asarray(mask, dtype=np.float64), factor), 0.0, 1.0)
    return np.concatenate([_orientation_rgb(smooth), alpha[..., None]], axis=-1)


def _smooth_scalar(
    values: np.ndarray,
    mask: np.ndarray,
    factor: int = DISPLAY_UPSAMPLE,
) -> np.ma.MaskedArray:
    """Bilinearly resampled scalar field, still masked outside the device."""
    filled = _fill_vacuum(np.asarray(values, dtype=np.float64)[..., None], mask)[..., 0]
    alpha = _bilinear_upsample(np.asarray(mask, dtype=np.float64), factor)
    return np.ma.array(_bilinear_upsample(filled, factor), mask=alpha < 0.5)


def _draw_orientation_legend(ax: plt.Axes) -> None:
    """Color key for the continuous orientation mapping."""
    size = 192
    axis = np.linspace(-1.0, 1.0, size)
    gx, gy = np.meshgrid(axis, axis)
    radius = np.hypot(gx, gy)
    inside = radius <= 1.0
    mz = np.clip(1.0 - 2.0 * np.clip(radius, 0.0, 1.0), -1.0, 1.0)
    in_plane = np.sqrt(np.clip(1.0 - mz * mz, 0.0, 1.0))
    angle = np.arctan2(gy, gx)
    field = np.stack([in_plane * np.cos(angle), in_plane * np.sin(angle), mz], axis=-1)
    rgba = np.concatenate([_orientation_rgb(field), inside[..., None].astype(float)], axis=-1)
    ax.imshow(rgba, origin="lower", extent=(-1, 1, -1, 1), interpolation="bilinear")
    ax.set_xlim(-1.5, 1.5)
    ax.set_ylim(-1.5, 1.5)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_frame_on(False)
    ax.grid(False)
    ax.set_title("orientation key", fontsize=9, color=MUTED, pad=10)
    ax.text(0.0, 0.0, "+z", ha="center", va="center", color="#1f2937", fontsize=8, weight="bold")
    ax.text(0.0, -1.12, "−z at rim", ha="center", va="top", color=MUTED, fontsize=8)
    ax.text(1.08, 0.0, "+x", ha="left", va="center", color=MUTED, fontsize=8)
    ax.text(0.0, 1.08, "+y", ha="center", va="bottom", color=MUTED, fontsize=8)


def _draw_spin_glyphs(
    ax: plt.Axes,
    field: np.ndarray,
    mask: np.ndarray,
    extent: tuple[float, float, float, float],
    *,
    black_only: bool = False,
) -> list[Any]:
    """Draw visible in-plane arrows and explicit markers for near-normal spins."""
    ny, nx = mask.shape
    stride = max(1, int(np.ceil(max(nx / 16, ny / 8))))
    yy, xx = np.mgrid[0:ny:stride, 0:nx:stride]
    active = mask[yy, xx]
    if not np.any(active):
        return []
    artists: list[Any] = []
    cell_x = (extent[1] - extent[0]) / nx
    cell_y = (extent[3] - extent[2]) / ny
    x_nm = (xx + 0.5 - nx / 2.0) * cell_x
    y_nm = (yy + 0.5 - ny / 2.0) * cell_y
    mx, my, mz = (field[yy, xx, index] for index in range(3))
    in_plane = np.hypot(mx, my)
    arrows = active & (in_plane >= 0.08)
    if np.any(arrows):
        glyph_length = 0.6 * stride * min(cell_x, cell_y)
        u = glyph_length * mx[arrows] / in_plane[arrows]
        v = glyph_length * my[arrows] / in_plane[arrows]
        layers = (
            (("#030712", 0.0074, 5),)
            if black_only
            else (("#050b18", 0.0115, 4), ("#f8fafc", 0.0062, 5))
        )
        for color, width, zorder in layers:
            artists.append(ax.quiver(
                x_nm[arrows],
                y_nm[arrows],
                u,
                v,
                color=color,
                pivot="mid",
                angles="xy",
                scale_units="xy",
                scale=1,
                width=width,
                headwidth=3.6,
                headlength=4.2,
                headaxislength=3.7,
                zorder=zorder,
            ))
    normal = active & ~arrows
    for positive, marker in ((True, "^"), (False, "v")):
        selected = normal & ((mz >= 0) if positive else (mz < 0))
        if np.any(selected):
            artists.append(ax.scatter(
                x_nm[selected],
                y_nm[selected],
                marker=marker,
                s=22,
                facecolor="#030712" if black_only else "#f8fafc",
                edgecolor="#030712" if black_only else "#050b18",
                linewidth=0.7 if black_only else 1.1,
                zorder=5,
            ))
    return artists


def _draw_map(
    ax: plt.Axes,
    field: np.ndarray,
    mask: np.ndarray,
    extent: tuple[float, float, float, float],
    *,
    title: str,
    quiver: bool = True,
) -> Any:
    image = ax.imshow(
        _orientation_image(field, mask),
        origin="lower",
        extent=extent,
        interpolation="bilinear",
        aspect="equal",
    )
    if quiver:
        _draw_spin_glyphs(ax, field, mask, extent)
    ax.set_title(title)
    ax.set_xlabel("x [nm]")
    ax.set_ylabel("y [nm]")
    ax.grid(False)
    return image


def _save(fig: plt.Figure, path: Path) -> None:
    fig.savefig(path)
    plt.close(fig)


def _overview(
    path: Path,
    frames: np.ndarray,
    times: np.ndarray,
    mask: np.ndarray,
    extent: tuple[float, float, float, float],
) -> None:
    indices = np.unique(np.round(np.linspace(0, len(frames) - 1, 6)).astype(int))
    fig = plt.figure(figsize=(14.4, 6.8), constrained_layout=True)
    grid = fig.add_gridspec(2, 4, width_ratios=[1.0, 1.0, 1.0, 0.34])
    axes = [fig.add_subplot(grid[row, column]) for row in range(2) for column in range(3)]
    for ax, index in zip(axes, indices):
        _draw_map(
            ax,
            frames[index],
            mask,
            extent,
            title=f"frame {index}  ·  t = {times[index] * 1e12:.3f} ps",
        )
    for ax in axes[len(indices) :]:
        ax.set_visible(False)
    _draw_orientation_legend(fig.add_subplot(grid[:, 3]))
    fig.suptitle(
        f"SIMULATED · {frames.shape[2]}×{frames.shape[1]}×1 Python micromagnetic mesh frames\n"
        "continuous color = full spin orientation · arrows = in-plane direction · "
        "▲/▼ = near-normal ±z · bilinear display interpolation between computed cell centers",
        color=MUTED,
        fontsize=11,
    )
    _save(fig, path)


def _texture_contrast(
    path: Path,
    frames: np.ndarray,
    times: np.ndarray,
    mask: np.ndarray,
    extent: tuple[float, float, float, float],
) -> None:
    """Reveal computed nonuniformity with one shared, explicitly adaptive scale."""
    indices = np.unique(np.round(np.linspace(0, len(frames) - 1, 6)).astype(int))
    deviations = []
    for index in indices:
        mz = frames[index, ..., 2]
        deviations.append(mz - float(np.mean(mz[mask])))
    active_deviations = np.concatenate([item[mask] for item in deviations])
    span = _robust_span(active_deviations)

    fig, axes = plt.subplots(2, 3, figsize=(13.4, 6.8), constrained_layout=True)
    image = None
    for ax, index, deviation in zip(axes.flat, indices, deviations):
        image = ax.imshow(
            _smooth_scalar(deviation, mask),
            origin="lower",
            extent=extent,
            cmap=MZ_CMAP,
            vmin=-span,
            vmax=span,
            interpolation="bilinear",
            aspect="equal",
        )
        _draw_spin_glyphs(ax, frames[index], mask, extent, black_only=True)
        sigma = float(np.std(deviation[mask]))
        ax.set_title(
            f"t = {times[index] * 1e12:.3f} ps  ·  "
            rf"$\sigma(m_z)={sigma:.2e}$"
        )
        ax.set_xlabel("x [nm]")
        ax.set_ylabel("y [nm]")
        ax.grid(False)
    for ax in axes.flat[len(indices) :]:
        ax.set_visible(False)
    if image is not None:
        cbar = fig.colorbar(image, ax=axes, shrink=0.88, pad=0.012)
        cbar.set_label(r"$m_z-\langle m_z\rangle$  (shared adaptive scale)")
    fig.suptitle(
        "SIMULATED SPATIAL TEXTURE · contrast-enhanced deviation from each frame mean\n"
        f"shared {CONTRAST_PERCENTILE:g}th-percentile scale ±{span:.2e} · "
        "colors are not absolute magnetization",
        color="#fde68a",
        fontsize=11,
    )
    _save(fig, path)


def _length_nm(quantity: Any) -> float:
    factors = {"nm": 1.0, "um": 1e3, "m": 1e9}
    return float(quantity.value) * factors[str(quantity.unit)]


def _filled_footprint_shape(cell_shape: str) -> str:
    """Match the nz=1 mesh mask: nanowire/custom fill the rectangular extent."""
    if cell_shape in {"rectangle", "nanowire", "custom"}:
        return "rectangle"
    return "ellipse"


LOG_Y_MIN = 1e-20
LOG_Y_MAX = 1e80


def _finite_log_y(values: np.ndarray | float) -> np.ndarray:
    """Keep log-axis data inside matplotlib's finite tick range."""
    data = np.asarray(values, dtype=np.float64)
    data = np.where(np.isfinite(data) & (data > 0.0), data, LOG_Y_MIN)
    return np.clip(data, LOG_Y_MIN, LOG_Y_MAX)


def _device_chain(
    path: Path,
    request: SimulationRequest,
) -> dict[str, Any]:
    """Render analytical retention and leakage from this job's declared inputs."""
    geometry = request.geometry
    mumax = request.solver_drafts.mumax3  # type: ignore[union-attr]
    report = request.matplotlib_report
    if report is None or mumax.saturation_magnetization is None or mumax.anisotropy_constant is None:
        raise ValueError("Device-chain report requires explicit material and analytical inputs.")

    length_nm = _length_nm(geometry.free_layer_length)
    width_nm = _length_nm(geometry.free_layer_width)
    free_thickness_nm = _length_nm(geometry.free_layer_thickness)
    barrier_thickness_nm = _length_nm(geometry.barrier_thickness)
    temperature_k = float(request.controls.temperature.value)
    msat = float(mumax.saturation_magnetization.value)
    ku1 = float(mumax.anisotropy_constant.value)
    footprint_shape = _filled_footprint_shape(str(geometry.cell_shape))
    volume = free_layer_volume_m3(length_nm, width_nm, free_thickness_nm, footprint_shape)
    keff_info = effective_anisotropy(ku1, msat)
    keff = float(keff_info["effective_j_per_m3"])

    delta = float(thermal_stability(keff, volume, temperature_k)["delta"])
    retention = retention_from_delta(
        delta,
        elapsed_seconds=report.retention_window_years * SECONDS_PER_YEAR,
    )
    retention_years = float(np.asarray(retention["tau_years"]))
    flip_probability = float(np.asarray(retention["flip_probability"]))

    tunnel_fixed = {
        "barrier_height_ev": report.barrier_height_ev,
        "effective_mass_ratio": report.effective_mass_ratio,
        "temperature_k": temperature_k,
        "fermi_ev": report.fermi_ev,
        "energy_samples": 33,
    }
    tunnel = tunnel_current_density(
        barrier_thickness_nm=barrier_thickness_nm,
        bias_volts=report.read_bias_volts,
        **tunnel_fixed,
    )
    current_density = float(tunnel["current_density_a_per_m2"])
    junction_area = volume / (free_thickness_nm * 1e-9)
    leakage_current = current_density * junction_area

    fig, axes = plt.subplots(2, 2, figsize=(12.8, 8.2), constrained_layout=True)
    temperatures = np.linspace(max(100.0, temperature_k - 180.0), temperature_k + 220.0, 90)
    delta_t = thermal_stability(keff, volume, temperatures)["delta"]
    years_t = _finite_log_y(retention_from_delta(delta_t)["tau_years"])
    axes[0, 0].semilogy(temperatures, years_t, color=MZ, lw=2.1)
    axes[0, 0].axhline(report.retention_window_years, color="#fbbf24", ls="--", label="declared target")
    axes[0, 0].axvline(temperature_k, color="#f8fafc", ls=":")
    axes[0, 0].scatter(
        [temperature_k],
        _finite_log_y(retention_years),
        color="#f8fafc",
        zorder=4,
    )
    axes[0, 0].set_xlabel("temperature [K]")
    axes[0, 0].set_ylabel("Néel–Brown mean dwell time [years]")
    axes[0, 0].set_title("ANALYTICAL · retention vs temperature")
    axes[0, 0].legend()

    thickness_free = np.linspace(max(0.3, free_thickness_nm * 0.4), free_thickness_nm * 2.2, 90)
    volumes = np.array(
        [free_layer_volume_m3(length_nm, width_nm, value, footprint_shape) for value in thickness_free]
    )
    delta_d = thermal_stability(keff, volumes, temperature_k)["delta"]
    years_d = _finite_log_y(retention_from_delta(delta_d)["tau_years"])
    axes[0, 1].semilogy(thickness_free, years_d, color="#c084fc", lw=2.1)
    axes[0, 1].axhline(report.retention_window_years, color="#fbbf24", ls="--")
    axes[0, 1].axvline(free_thickness_nm, color="#f8fafc", ls=":")
    axes[0, 1].set_xlabel("free-layer thickness [nm]")
    axes[0, 1].set_ylabel("mean dwell time [years]")
    axes[0, 1].set_title("ANALYTICAL · thickness retention sweep")

    barrier_thicknesses = np.linspace(max(0.35, barrier_thickness_nm * 0.45), barrier_thickness_nm * 2.1, 48)
    current_density_sweep = _finite_log_y(
        leakage_sweep(
            barrier_thicknesses,
            sweep="barrier_thickness_nm",
            bias_volts=report.read_bias_volts,
            **tunnel_fixed,
        )
    )
    axes[1, 0].semilogy(barrier_thicknesses, current_density_sweep, color=DEMAG, lw=2.1)
    axes[1, 0].axvline(barrier_thickness_nm, color="#f8fafc", ls=":")
    axes[1, 0].scatter(
        [barrier_thickness_nm],
        _finite_log_y(abs(current_density)),
        color="#f8fafc",
        zorder=4,
    )
    axes[1, 0].set_xlabel("barrier thickness [nm]")
    axes[1, 0].set_ylabel(r"$|J|$ [A m$^{-2}$]")
    axes[1, 0].set_title("ANALYTICAL · Tsu–Esaki leakage")

    biases = np.linspace(0.005, max(0.5, abs(report.read_bias_volts) * 2.2), 42)
    current_bias = _finite_log_y(
        leakage_sweep(
            biases,
            sweep="bias_volts",
            barrier_thickness_nm=barrier_thickness_nm,
            **tunnel_fixed,
        )
    )
    axes[1, 1].semilogy(biases, current_bias, color=EXCHANGE, lw=2.1)
    axes[1, 1].axvline(abs(report.read_bias_volts), color="#f8fafc", ls=":")
    axes[1, 1].set_xlabel("|read bias| [V]")
    axes[1, 1].set_ylabel(r"$|J|$ [A m$^{-2}$]")
    axes[1, 1].set_title("ANALYTICAL · leakage bias sweep")

    fig.suptitle(
        "SAME JOB INPUTS · analytical pMTJ device chain (not micromagnetic mesh output)\n"
        rf"$\Delta={delta:.2f}$ · $\tau={retention_years:.3g}$ years · "
        rf"$P_{{flip}}({report.retention_window_years:g}\,\mathrm{{yr}})={flip_probability:.3g}$ · "
        rf"$I_{{leak}}={leakage_current:.3g}$ A",
        color="#fde68a",
        fontsize=11,
    )
    _save(fig, path)
    return {
        "delta": delta,
        "retentionYears": retention_years,
        "flipProbabilityAtTarget": flip_probability,
        "leakageCurrentDensityAPerM2": current_density,
        "leakageCurrentA": leakage_current,
        "losesPerpendicularEasyAxis": bool(keff_info["loses_perpendicular_easy_axis"]),
    }


def _dynamics(path: Path, result: dict[str, Any]) -> None:
    tm, mx = _series(result, "mx")
    _, my = _series(result, "my")
    _, mz = _series(result, "mz")
    te, e_total = _series(result, "e_total")
    _, e_ex = _series(result, "e_ex")
    _, e_demag = _series(result, "e_demag")
    _, e_anis = _series(result, "e_anis")

    fig, (ax_m, ax_e) = plt.subplots(1, 2, figsize=(12.8, 4.4), constrained_layout=True)
    for values, label, color in ((mx, "$m_x$", MX), (my, "$m_y$", MY), (mz, "$m_z$", MZ)):
        ax_m.plot(tm * 1e12, values, label=label, color=color, lw=1.8)
    ax_m.axhline(0, color=GRID, lw=0.8)
    ax_m.set_ylim(-1.05, 1.05)
    ax_m.set_xlabel("time [ps]")
    ax_m.set_ylabel(r"active-cell mean $\langle m_i \rangle$")
    ax_m.set_title("SIMULATED · spatial mean magnetization")
    ax_m.legend(ncol=3, loc="best")

    for values, label, color, lw in (
        (e_total, "total", TOTAL, 2.2),
        (e_ex, "exchange", EXCHANGE, 1.5),
        (e_demag, "demag", DEMAG, 1.5),
        (e_anis, "anisotropy", ANIS, 1.5),
    ):
        if len(values):
            ax_e.plot(te * 1e12, values, label=label, color=color, lw=lw)
    ax_e.set_xlabel("time [ps]")
    ax_e.set_ylabel(r"energy density [J m$^{-3}$]")
    ax_e.set_title("SIMULATED · energy decomposition")
    ax_e.legend(loc="best")
    fig.suptitle("Python finite-difference LLGS trajectory · values computed from returned mesh frames", color=MUTED)
    _save(fig, path)


def _components(
    path: Path,
    frame: np.ndarray,
    mask: np.ndarray,
    extent: tuple[float, float, float, float],
    time_s: float,
) -> None:
    fig, axes = plt.subplots(2, 3, figsize=(13.6, 7.6), constrained_layout=True)
    absolute_images = []
    for index, label in enumerate(("$m_x$", "$m_y$", "$m_z$")):
        smooth = _smooth_scalar(frame[..., index], mask)
        active = frame[..., index][mask]

        ax_absolute = axes[0, index]
        absolute_images.append(
            ax_absolute.imshow(
                smooth,
                origin="lower",
                extent=extent,
                cmap=MZ_CMAP,
                vmin=-1,
                vmax=1,
                interpolation="bilinear",
                aspect="equal",
            )
        )
        ax_absolute.set_title(f"{label} · absolute −1 … +1")

        low, high = _robust_limits(active)
        ax_adaptive = axes[1, index]
        adaptive = ax_adaptive.imshow(
            smooth,
            origin="lower",
            extent=extent,
            cmap=MZ_CMAP,
            vmin=low,
            vmax=high,
            interpolation="bilinear",
            aspect="equal",
        )
        ax_adaptive.set_title(
            f"{label} · adaptive {low:+.3g} … {high:+.3g}",
            color="#fde68a",
        )
        fig.colorbar(adaptive, ax=ax_adaptive, pad=0.015)

        for ax in (ax_absolute, ax_adaptive):
            ax.set_xlabel("x [nm]")
            ax.set_ylabel("y [nm]")
            ax.grid(False)

    cbar = fig.colorbar(absolute_images[-1], ax=axes[0, :], shrink=0.84, pad=0.012)
    cbar.set_label("unit magnetization component")
    fig.suptitle(
        f"SIMULATED · component maps at t = {time_s * 1e12:.3f} ps · bilinear display interpolation\n"
        f"top row: absolute −1 … +1 · bottom row: per-panel {CONTRAST_PERCENTILE:g}th-percentile "
        "contrast stretch (relative color, not absolute)",
        color=MUTED,
    )
    _save(fig, path)


def _cross_sections(
    path: Path,
    frames: np.ndarray,
    times: np.ndarray,
    mask: np.ndarray,
    dx: float,
) -> None:
    y = mask.shape[0] // 2
    x_nm = (np.arange(mask.shape[1]) + 0.5 - mask.shape[1] / 2.0) * dx * 1e9
    center_mask = mask[y]
    cut_mz = np.ma.array(frames[:, y, :, 2], mask=np.broadcast_to(~center_mask, (len(frames), len(center_mask))))
    extent = (x_nm[0], x_nm[-1], times[0] * 1e12, times[-1] * 1e12)

    low, high = _robust_limits(frames[:, y, :, 2][:, center_mask])
    fig, (ax_heat, ax_lines) = plt.subplots(1, 2, figsize=(12.8, 4.5), constrained_layout=True)
    image = ax_heat.imshow(
        cut_mz,
        origin="lower",
        extent=extent,
        aspect="auto",
        cmap=MZ_CMAP,
        vmin=low,
        vmax=high,
        interpolation="bilinear",
    )
    ax_heat.set_xlabel("x [nm]")
    ax_heat.set_ylabel("time [ps]")
    ax_heat.set_title(
        r"SIMULATED · center cut $m_z(x,t)$ at nz=1"
        f"\nadaptive {CONTRAST_PERCENTILE:g}th-percentile color {low:+.3g} … {high:+.3g}"
    )
    ax_heat.grid(False)
    cbar = fig.colorbar(image, ax=ax_heat, pad=0.015)
    cbar.set_label(r"$m_z$")

    indices = np.unique(np.round(np.linspace(0, len(frames) - 1, 6)).astype(int))
    for index in indices:
        ax_lines.plot(x_nm, cut_mz[index], label=f"{times[index] * 1e12:.2f} ps")
    ax_lines.set_ylim(-1.05, 1.05)
    ax_lines.set_xlabel("x [nm]")
    ax_lines.set_ylabel(r"$m_z$")
    ax_lines.set_title("same raw frames · no through-thickness structure")
    ax_lines.legend(ncol=2, loc="best")
    fig.suptitle("Lateral cross-section · one physical z cell only", color=MUTED)
    _save(fig, path)


def _diagnostics(
    path: Path,
    frames: np.ndarray,
    mask: np.ndarray,
    result: dict[str, Any],
    extent: tuple[float, float, float, float],
) -> None:
    final = frames[-1]
    norm = np.linalg.norm(final, axis=-1)
    gx = np.zeros(mask.shape, dtype=float)
    gy = np.zeros(mask.shape, dtype=float)
    gx[:, 1:] = np.linalg.norm(final[:, 1:] - final[:, :-1], axis=-1)
    gy[1:, :] = np.linalg.norm(final[1:] - final[:-1], axis=-1)
    gradient = np.maximum(gx, gy)
    metrics = _metric_map(result)

    # Tolerance window rather than a percentile stretch: a pure stretch here would
    # amplify 1e-8 round-off into a full-scale pattern that means nothing.
    drift = float(np.max(np.abs(norm[mask] - 1.0))) if np.any(mask) else 0.0
    half_window = max(drift, 1e-3)
    norm_low, norm_high = 1.0 - half_window, 1.0 + half_window
    fig, axes = plt.subplots(2, 2, figsize=(10.5, 8.0), constrained_layout=True)
    im_norm = axes[0, 0].imshow(
        np.ma.array(norm, mask=~mask),
        origin="lower",
        extent=extent,
        cmap="viridis",
        vmin=norm_low,
        vmax=norm_high,
        interpolation="nearest",
        aspect="equal",
    )
    axes[0, 0].set_title(
        r"final $|\mathbf{m}|$ · target 1"
        f"\ncolor window ±{half_window:.1e} · max drift {drift:.2e}"
    )
    axes[0, 0].grid(False)
    fig.colorbar(im_norm, ax=axes[0, 0], pad=0.015)

    gradient_high = float(np.percentile(gradient[mask], CONTRAST_PERCENTILE)) if np.any(mask) else 1.0
    im_grad = axes[0, 1].imshow(
        np.ma.array(gradient, mask=~mask),
        origin="lower",
        extent=extent,
        cmap="magma",
        vmin=0.0,
        vmax=max(gradient_high, 1e-9),
        interpolation="nearest",
        aspect="equal",
    )
    axes[0, 1].set_title(
        r"neighbor-vector difference $|\Delta\mathbf{m}|$"
        f"\nadaptive color 0 … {max(gradient_high, 1e-9):.3g}"
    )
    axes[0, 1].grid(False)
    fig.colorbar(im_grad, ax=axes[0, 1], pad=0.015)

    axes[1, 0].hist(frames[0, ..., 2][mask], bins=32, alpha=0.6, color=MX, label="initial")
    axes[1, 0].hist(final[..., 2][mask], bins=32, alpha=0.6, color=MZ, label="final")
    axes[1, 0].set_xlim(-1.05, 1.05)
    axes[1, 0].set_xlabel(r"cell $m_z$")
    axes[1, 0].set_ylabel("active-cell count")
    axes[1, 0].set_title("raw cell distribution")
    axes[1, 0].legend()

    axes[1, 1].axis("off")
    rows = [
        ("mesh", metrics.get("mesh", {}).get("displayValue", "unknown")),
        ("lex / dx", metrics.get("exchange-length", {}).get("displayValue", "unknown")),
        (r"$\gamma\Delta t B_{ex}$", metrics.get("timestep-criterion", {}).get("displayValue", "unknown")),
        ("max neighbor angle", metrics.get("max-neighbor-angle", {}).get("displayValue", "unknown") + " rad"),
        ("max norm drift", metrics.get("norm-drift", {}).get("displayValue", "unknown")),
        ("temperature", metrics.get("temperature", {}).get("displayValue", "unknown") + " K"),
        ("RNG seed", metrics.get("seed", {}).get("displayValue", "unknown")),
        ("solver", metrics.get("solver-engine", {}).get("displayValue", "python_micromagnetic")),
    ]
    axes[1, 1].text(0.02, 0.95, "NUMERICAL SAFEGUARDS", color=INK, fontsize=11, weight="bold", va="top")
    for row, (label, value) in enumerate(rows):
        y = 0.82 - row * 0.095
        axes[1, 1].text(0.02, y, label, color=MUTED, va="top")
        axes[1, 1].text(0.48, y, value, color=INK, va="top")
    axes[1, 1].text(
        0.02,
        0.03,
        "SIMULATED · Newell finite-cell FFT demag · stochastic Heun when T > 0\n"
        "nz=1: no through-thickness domains · not MuMax3 · not a measured device",
        color="#fde68a",
        fontsize=8.5,
        va="bottom",
    )
    fig.suptitle("Python micromagnetic numerical diagnostics", color=MUTED)
    _save(fig, path)


def _animation(
    path: Path,
    frames: np.ndarray,
    times: np.ndarray,
    mask: np.ndarray,
    extent: tuple[float, float, float, float],
    result: dict[str, Any],
) -> None:
    tm, mx = _series(result, "mx")
    _, my = _series(result, "my")
    _, mz = _series(result, "mz")

    fig = plt.figure(figsize=(11.6, 4.2), constrained_layout=True)
    grid = fig.add_gridspec(1, 3, width_ratios=[1.15, 1.0, 0.3])
    ax_map = fig.add_subplot(grid[0, 0])
    ax_trace = fig.add_subplot(grid[0, 1])
    image = ax_map.imshow(
        _orientation_image(frames[0], mask),
        origin="lower",
        extent=extent,
        interpolation="bilinear",
        aspect="equal",
    )
    ax_map.set_xlabel("x [nm]")
    ax_map.set_ylabel("y [nm]")
    ax_map.grid(False)
    _draw_orientation_legend(fig.add_subplot(grid[0, 2]))
    glyphs = _draw_spin_glyphs(ax_map, frames[0], mask, extent)

    ax_trace.plot(tm * 1e12, mx, color=MX, label="$m_x$")
    ax_trace.plot(tm * 1e12, my, color=MY, label="$m_y$")
    ax_trace.plot(tm * 1e12, mz, color=MZ, label="$m_z$")
    cursor = ax_trace.axvline(times[0] * 1e12, color="#f8fafc", lw=1.2)
    marker, = ax_trace.plot([times[0] * 1e12], [mz[0]], "o", color=MZ, ms=5)
    ax_trace.set_ylim(-1.05, 1.05)
    ax_trace.set_xlabel("time [ps]")
    ax_trace.set_ylabel(r"$\langle m_i\rangle$")
    ax_trace.set_title("spatial mean from the same frames")
    ax_trace.legend(ncol=3, loc="best")

    def update(index: int) -> tuple[Any, ...]:
        nonlocal glyphs
        image.set_data(_orientation_image(frames[index], mask))
        for artist in glyphs:
            artist.remove()
        glyphs = _draw_spin_glyphs(ax_map, frames[index], mask, extent)
        cursor.set_xdata([times[index] * 1e12, times[index] * 1e12])
        marker.set_data([times[index] * 1e12], [mz[index]])
        ax_map.set_title(
            f"SIMULATED · frame {index}/{len(frames) - 1} · {times[index] * 1e12:.3f} ps\n"
            "continuous orientation color · arrows: in-plane · ▲/▼: near-normal ±z"
        )
        return image, cursor, marker, *glyphs

    animation = FuncAnimation(fig, update, frames=len(frames), interval=80, blit=False, repeat=True)
    animation.save(path, writer=PillowWriter(fps=12), dpi=105)
    plt.close(fig)


def render_matplotlib_twin_report(
    job_dir: Path,
    result: SimulationResult | dict[str, Any],
    *,
    request: SimulationRequest | None = None,
    include_animation: bool = True,
) -> dict[str, Any]:
    """Render a complete scientific report from one completed mesh job."""
    _style()
    job_dir = Path(job_dir)
    result_dict = _as_dict(result)
    if result_dict.get("source") != "python_micromagnetic":
        raise ValueError("Matplotlib Twin reports require a python_micromagnetic result.")

    payload = load_magnetization_npz(job_dir / "magnetization.npz")
    frames = np.asarray(payload["m"], dtype=np.float32)
    times = np.asarray(payload["time_s"], dtype=np.float64)
    mask = np.asarray(payload["mask"], dtype=bool)
    if frames.ndim != 4 or frames.shape[-1] != 3:
        raise ValueError(f"Expected frames shaped (nt, ny, nx, 3); got {frames.shape}.")
    if len(frames) != len(times):
        raise ValueError("Frame and time counts do not match.")

    nt, ny, nx, _ = frames.shape
    extent = _extent_nm(nx, ny, payload["dx"], payload["dy"])
    output_dir = job_dir / REPORT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    assets = [
        {
            "id": "mesh-evolution",
            "label": "Mesh evolution",
            "path": "mesh_evolution.png",
            "mimeType": "image/png",
            "note": (
                "Six computed mesh frames. Continuous orientation color (hue = in-plane "
                "direction, light = +z, dark = -z) with bilinear display interpolation."
            ),
        },
        {
            "id": "dynamics",
            "label": "Magnetization and energy",
            "path": "dynamics.png",
            "mimeType": "image/png",
            "note": "Mean magnetization and energy components computed from returned frames.",
        },
        {
            "id": "spatial-texture",
            "label": "Contrast-enhanced spatial texture",
            "path": "spatial_texture.png",
            "mimeType": "image/png",
            "note": "Computed mz deviation from each frame mean on one shared adaptive scale; not absolute color.",
        },
        {
            "id": "components",
            "label": "Final component maps",
            "path": "components.png",
            "mimeType": "image/png",
            "note": (
                "Final mx, my, mz twice: absolute -1 to +1 on top, and a labeled "
                f"{CONTRAST_PERCENTILE:g}th-percentile contrast stretch below."
            ),
        },
        {
            "id": "cross-sections",
            "label": "nz=1 lateral cross-sections",
            "path": "cross_sections.png",
            "mimeType": "image/png",
            "note": (
                "Center-row mz(x,t) on a labeled adaptive color range. One physical z cell; "
                "no invented thickness structure."
            ),
        },
        {
            "id": "diagnostics",
            "label": "Numerical diagnostics",
            "path": "diagnostics.png",
            "mimeType": "image/png",
            "note": (
                "Raw per-cell values with no interpolation: norm, neighbor variation, "
                "cell distribution, and solver safeguards."
            ),
        },
    ]

    _overview(output_dir / "mesh_evolution.png", frames, times, mask, extent)
    _dynamics(output_dir / "dynamics.png", result_dict)
    _texture_contrast(output_dir / "spatial_texture.png", frames, times, mask, extent)
    _components(output_dir / "components.png", frames[-1], mask, extent, float(times[-1]))
    _cross_sections(output_dir / "cross_sections.png", frames, times, mask, float(payload["dx"]))
    _diagnostics(output_dir / "diagnostics.png", frames, mask, result_dict, extent)

    analytical_summary = None
    if request is not None and request.matplotlib_report is not None:
        analytical_summary = _device_chain(output_dir / "device_chain.png", request)
        assets.insert(
            3,
            {
                "id": "device-chain",
                "label": "Retention and barrier leakage",
                "path": "device_chain.png",
                "mimeType": "image/png",
                "note": (
                    "Néel–Brown and Tsu–Esaki analytical sweeps from this job's declared "
                    "geometry, material, barrier, temperature, and read bias."
                ),
            },
        )

    if include_animation:
        _animation(output_dir / "reversal.gif", frames, times, mask, extent, result_dict)
        assets.insert(
            0,
            {
                "id": "reversal-animation",
                "label": "Mesh trajectory animation",
                "path": "reversal.gif",
                "mimeType": "image/gif",
                "note": (
                    "Every sampled frame in continuous orientation color, synchronized "
                    "with mean m(t)."
                ),
            },
        )

    manifest = {
        "format": REPORT_FORMAT,
        "source": "python_micromagnetic",
        "mesh": {"nx": nx, "ny": ny, "nz": 1, "frames": nt},
        "timeRangeS": [float(times[0]), float(times[-1])],
        "assets": assets,
        "analyticalSummary": analytical_summary,
        "honesty": (
            "SIMULATED maps, traces, and energies rendered from the returned NumPy mesh. "
            "No prescribed reversal path and no synthetic spatial texture. Continuous color "
            "is a display mapping of the computed vectors (hue = in-plane direction, "
            "light = +z, dark = -z) drawn with bilinear interpolation between computed cell "
            "centers. Panels whose title says 'adaptive' use a percentile contrast stretch "
            f"({CONTRAST_PERCENTILE:g}th percentile) with the numeric range printed, so color "
            "is relative there; the diagnostics histogram and per-cell panels show the same "
            "data unstretched. "
            "nz=1 has no through-thickness domain structure. Not MuMax3. Not a measured device."
        ),
    }
    (output_dir / REPORT_MANIFEST).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
