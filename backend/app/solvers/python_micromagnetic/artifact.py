"""Versioned magnetization NPZ artifacts. Not OVF and not MuMax3."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

FRAME_FORMAT = "spinvault-magnetization-npz-v1"
ARTIFACT_NAME = "magnetization.npz"


def save_magnetization_npz(
    path: Path,
    *,
    frames: np.ndarray,
    times: np.ndarray,
    mask: np.ndarray,
    dx: float,
    dy: float,
    dz: float,
    extra: dict[str, Any] | None = None,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "format": np.asarray(FRAME_FORMAT),
        "m": np.asarray(frames, dtype=np.float32),
        "time_s": np.asarray(times, dtype=np.float64),
        "mask": np.asarray(mask, dtype=np.uint8),
        "dx": np.float64(dx),
        "dy": np.float64(dy),
        "dz": np.float64(dz),
    }
    if extra:
        for key, value in extra.items():
            payload[key] = value
    np.savez_compressed(path, **payload)
    return path


def load_magnetization_npz(path: Path) -> dict[str, Any]:
    with np.load(path, allow_pickle=False) as data:
        fmt = str(data["format"]) if "format" in data.files else FRAME_FORMAT
        if fmt != FRAME_FORMAT:
            raise ValueError(f"Unsupported magnetization artifact format '{fmt}'.")
        return {
            "format": fmt,
            "m": np.asarray(data["m"], dtype=np.float32),
            "time_s": np.asarray(data["time_s"], dtype=np.float64),
            "mask": np.asarray(data["mask"], dtype=np.uint8),
            "dx": float(data["dx"]) if "dx" in data.files else 0.0,
            "dy": float(data["dy"]) if "dy" in data.files else 0.0,
            "dz": float(data["dz"]) if "dz" in data.files else 0.0,
        }


def frame_catalog(path: Path, *, times: np.ndarray | None = None) -> list[dict[str, Any]]:
    """Metadata-only frame list for the job result payload."""
    payload = load_magnetization_npz(path)
    m = payload["m"]
    nt, ny, nx, _ = m.shape
    times = payload["time_s"] if times is None else times
    bytes_total = path.stat().st_size if path.exists() else 0
    xmin = -0.5 * nx * payload["dx"]
    ymin = -0.5 * ny * payload["dy"]
    zmin = -0.5 * payload["dz"]
    frames: list[dict[str, Any]] = []
    for index in range(nt):
        frames.append(
            {
                "id": f"frame-{index}",
                "path": path.name,
                "label": f"m[{index}]",
                "index": index,
                "bytes": bytes_total,
                "format": FRAME_FORMAT,
                "metadata": {
                    "xnodes": int(nx),
                    "ynodes": int(ny),
                    "znodes": 1,
                    "xstepsize": payload["dx"],
                    "ystepsize": payload["dy"],
                    "zstepsize": payload["dz"],
                    "xmin": xmin,
                    "xmax": xmin + nx * payload["dx"],
                    "ymin": ymin,
                    "ymax": ymin + ny * payload["dy"],
                    "zmin": zmin,
                    "zmax": zmin + payload["dz"],
                    "valuedim": 3,
                    "time": float(times[index]) if index < len(times) else None,
                    "format": FRAME_FORMAT,
                },
            }
        )
    return frames


def load_npz_frame(job_dir: Path, frame: Any, *, max_vectors: int = 20_000) -> dict[str, Any]:
    """Load one mesh frame into the solver-neutral vector payload used by the UI."""
    if isinstance(frame, dict):
        relative = str(frame.get("path") or ARTIFACT_NAME)
        index = int(frame.get("index") or 0)
        frame_id = frame.get("id")
        label = frame.get("label")
        metadata = dict(frame.get("metadata") or {})
    else:
        relative = ARTIFACT_NAME
        index = int(frame)
        frame_id = f"frame-{index}"
        label = f"m[{index}]"
        metadata = {}

    path = (job_dir / relative).resolve()
    root = job_dir.resolve()
    if path != root and root not in path.parents:
        raise ValueError("Frame path escapes the job directory.")
    if not path.exists():
        raise FileNotFoundError(f"Magnetization artifact not found: {relative}")

    payload = load_magnetization_npz(path)
    m = payload["m"]
    mask = payload["mask"].astype(bool)
    nt, ny, nx, _ = m.shape
    if index < 0 or index >= nt:
        raise ValueError(f"Frame index {index} is out of range for {nt} mesh frame(s).")
    field = m[index]
    dx, dy, dz = payload["dx"], payload["dy"], payload["dz"]
    xmin = -0.5 * nx * dx
    ymin = -0.5 * ny * dy
    zmin = -0.5 * dz
    time_s = float(payload["time_s"][index]) if index < len(payload["time_s"]) else None
    metadata.update(
        {
            "xnodes": int(nx),
            "ynodes": int(ny),
            "znodes": 1,
            "xstepsize": dx,
            "ystepsize": dy,
            "zstepsize": dz,
            "xmin": xmin,
            "xmax": xmin + nx * dx,
            "ymin": ymin,
            "ymax": ymin + ny * dy,
            "zmin": zmin,
            "zmax": zmin + dz,
            "valuedim": 3,
            "time": time_s,
            "format": FRAME_FORMAT,
        }
    )
    vectors: list[dict[str, Any]] = []
    warnings: list[str] = []
    total = ny * nx
    count = 0
    active = 0
    mean = np.zeros(3, dtype=np.float64)
    for y in range(ny):
        for x in range(nx):
            mx, my, mz = (float(field[y, x, 0]), float(field[y, x, 1]), float(field[y, x, 2]))
            magnitude = float(np.sqrt(mx * mx + my * my + mz * mz))
            if mask[y, x]:
                active += 1
                mean += (mx, my, mz)
            if count < max_vectors:
                vectors.append(
                    {
                        "index": count,
                        "x": x,
                        "y": y,
                        "z": 0,
                        "mx": mx,
                        "my": my,
                        "mz": mz,
                        "magnitude": magnitude,
                        "xMeters": xmin + (x + 0.5) * dx,
                        "yMeters": ymin + (y + 0.5) * dy,
                        "zMeters": zmin + 0.5 * dz,
                        "active": bool(mask[y, x]),
                    }
                )
            count += 1
    if total > max_vectors:
        warnings.append(f"Frame has {total} vectors; preview was capped at {max_vectors}.")
    if active:
        mean /= active
    sanity = {
        "activeCellCount": active,
        "totalCellCount": total,
        "meanMx": float(mean[0]),
        "meanMy": float(mean[1]),
        "meanMz": float(mean[2]),
        "meanNorm": float(np.mean(np.linalg.norm(field[mask], axis=1))) if active else 0.0,
        "normFailureCount": int(np.sum(np.abs(np.linalg.norm(field[mask], axis=1) - 1.0) > 0.08)) if active else 0,
        "normOk": True,
        "axisOrder": "x fastest, then y (python_micromagnetic nz=1)",
        "componentOrder": "mx, my, mz",
        "format": FRAME_FORMAT,
    }
    sanity["normOk"] = sanity["normFailureCount"] == 0
    return {
        "id": frame_id or f"frame-{index}",
        "path": relative,
        "label": label or f"m[{index}]",
        "index": index,
        "bytes": path.stat().st_size,
        "format": FRAME_FORMAT,
        "metadata": metadata,
        "vectors": vectors,
        "warnings": warnings,
        "sanity": sanity,
        "note": "Raw Python micromagnetic mesh vectors. Not OVF. Not MuMax3.",
    }
