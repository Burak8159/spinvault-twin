"""Catalog MuMax3 OVF magnetization frames without inventing image data."""

from __future__ import annotations

import math
import re
import struct
from pathlib import Path, PurePosixPath
from typing import Any


_META_PATTERNS = {
    "xnodes": re.compile(r"#\s*xnodes:\s*(\d+)", re.IGNORECASE),
    "ynodes": re.compile(r"#\s*ynodes:\s*(\d+)", re.IGNORECASE),
    "znodes": re.compile(r"#\s*znodes:\s*(\d+)", re.IGNORECASE),
    "xstepsize": re.compile(r"#\s*xstepsize:\s*([0-9.eE+-]+)", re.IGNORECASE),
    "ystepsize": re.compile(r"#\s*ystepsize:\s*([0-9.eE+-]+)", re.IGNORECASE),
    "zstepsize": re.compile(r"#\s*zstepsize:\s*([0-9.eE+-]+)", re.IGNORECASE),
    "xmin": re.compile(r"#\s*xmin:\s*([0-9.eE+-]+)", re.IGNORECASE),
    "xmax": re.compile(r"#\s*xmax:\s*([0-9.eE+-]+)", re.IGNORECASE),
    "ymin": re.compile(r"#\s*ymin:\s*([0-9.eE+-]+)", re.IGNORECASE),
    "ymax": re.compile(r"#\s*ymax:\s*([0-9.eE+-]+)", re.IGNORECASE),
    "zmin": re.compile(r"#\s*zmin:\s*([0-9.eE+-]+)", re.IGNORECASE),
    "zmax": re.compile(r"#\s*zmax:\s*([0-9.eE+-]+)", re.IGNORECASE),
    "valuedim": re.compile(r"#\s*valuedim:\s*(\d+)", re.IGNORECASE),
    "valueunits": re.compile(r"#\s*valueunits:\s*(.+)", re.IGNORECASE),
    "time": re.compile(
        r"#\s*(?:Desc:\s*)?Time:\s*([0-9.eE+-]+)(?:\s+s)?",
        re.IGNORECASE,
    ),
}

# Cells with |m| below this are treated as outside SetGeom (MuMax3 writes m=0 there).
ACTIVE_MAGNITUDE_FLOOR = 0.05
NORM_SANITY_TOLERANCE = 0.08

_BEGIN_DATA_TEXT = re.compile(r"#\s*Begin:\s*Data\s+Text", re.IGNORECASE)
_END_DATA_TEXT = re.compile(r"#\s*End:\s*Data\s+Text", re.IGNORECASE)
_BEGIN_DATA_BINARY = re.compile(r"#\s*Begin:\s*Data\s+Binary\s+([48])", re.IGNORECASE)
_BEGIN_DATA_BINARY_BYTES = re.compile(rb"#\s*Begin:\s*Data\s+Binary\s+([48])", re.IGNORECASE)
_END_DATA_BINARY_BYTES = re.compile(rb"\r?\n#\s*End:\s*Data\s+Binary(?:\s+[48])?", re.IGNORECASE)


def _read_header(path: Path, limit: int = 32_000) -> str:
    data = path.read_bytes()[:limit]
    return data.decode("utf-8", errors="replace")


def _frame_index(path: Path) -> int:
    match = re.search(r"(\d+)(?=\.ovf$)", path.name, re.IGNORECASE)
    return int(match.group(1)) if match else 0


def _metadata(path: Path) -> dict[str, Any]:
    header = _read_header(path)
    meta: dict[str, Any] = {}
    for key, pattern in _META_PATTERNS.items():
        match = pattern.search(header)
        if not match:
            continue
        raw = match.group(1).strip()
        if key.endswith("nodes") or key == "valuedim":
            meta[key] = int(raw)
        elif key.endswith("stepsize") or key.endswith("min") or key.endswith("max") or key == "time":
            meta[key] = float(raw)
        else:
            meta[key] = raw
    if {"xnodes", "ynodes", "znodes"}.issubset(meta):
        meta["cellCount"] = int(meta["xnodes"]) * int(meta["ynodes"]) * int(meta["znodes"])
    return meta


def find_ovf_frames(job_dir: Path) -> list[dict[str, Any]]:
    """Return real OVF frame references from the stable outputs/ artifact folder."""
    outputs = job_dir / "outputs"
    roots = [outputs] if outputs.exists() else [path for path in sorted(job_dir.glob("*.out")) if path.is_dir()]

    seen: set[Path] = set()
    frames: list[dict[str, Any]] = []
    for root in roots:
        for path in sorted(root.rglob("*.ovf")):
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            relative = path.relative_to(job_dir)
            frames.append(
                {
                    "id": f"frame-{len(frames)}",
                    "path": relative.as_posix(),
                    "label": path.name,
                    "index": _frame_index(path),
                    "bytes": path.stat().st_size,
                    "format": "ovf",
                    "metadata": _metadata(path),
                }
            )

    return sorted(frames, key=lambda item: (item.get("index", 0), item.get("path", "")))


def _frame_get(frame: Any, key: str, default: Any = None) -> Any:
    if isinstance(frame, dict):
        return frame.get(key, default)
    return getattr(frame, key, default)


def _safe_relative_frame_path(job_dir: Path, relative_path: str) -> Path:
    normalized = relative_path.replace("\\", "/").strip()
    if not normalized:
        raise ValueError("Frame path is empty.")
    if "\x00" in normalized or re.match(r"^[A-Za-z]:/", normalized):
        raise ValueError("Frame path escapes the job directory.")
    relative = PurePosixPath(normalized)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Frame path escapes the job directory.")
    candidate = (job_dir / Path(*relative.parts)).resolve()
    root = job_dir.resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Frame path escapes the job directory.")
    if candidate.suffix.lower() != ".ovf":
        raise ValueError("Frame path is not an OVF file.")
    return candidate


def _grid_shape(metadata: dict[str, Any]) -> tuple[int, int, int, int]:
    try:
        xnodes = int(metadata["xnodes"])
        ynodes = int(metadata["ynodes"])
        znodes = int(metadata["znodes"])
        value_dim = int(metadata["valuedim"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("OVF frame is missing valid xnodes, ynodes, znodes, or valuedim metadata.") from exc
    if xnodes <= 0 or ynodes <= 0 or znodes <= 0:
        raise ValueError("OVF frame grid dimensions must be positive.")
    if value_dim < 3:
        raise ValueError(f"OVF frame valuedim={value_dim}; expected at least 3 magnetization components.")
    return xnodes, ynodes, znodes, value_dim


def _parse_data_text(path: Path, metadata: dict[str, Any]) -> list[tuple[float, float, float]]:
    xnodes, ynodes, znodes, value_dim = _grid_shape(metadata)
    values: list[float] = []
    in_data = False
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    for raw_line in lines:
        line = raw_line.strip()
        if _BEGIN_DATA_TEXT.search(line):
            in_data = True
            continue
        if in_data and _END_DATA_TEXT.search(line):
            break
        if not in_data or not line or line.startswith("#"):
            continue
        try:
            values.extend(float(value) for value in line.split())
        except ValueError as exc:
            raise ValueError("OVF Data Text contains a non-numeric value.") from exc

    expected_values = xnodes * ynodes * znodes * value_dim
    if len(values) != expected_values:
        raise ValueError(
            f"OVF Data Text size does not match its grid: expected {expected_values} value(s), found {len(values)}."
        )
    return [
        (values[offset], values[offset + 1], values[offset + 2])
        for offset in range(0, len(values), value_dim)
    ]


def _parse_data_binary(path: Path, metadata: dict[str, Any]) -> list[tuple[float, float, float]]:
    data = path.read_bytes()
    match = _BEGIN_DATA_BINARY_BYTES.search(data)
    if not match:
        return []

    newline = data.find(b"\n", match.end())
    if newline < 0:
        raise ValueError("OVF binary frame is missing the data-line terminator.")

    binary_size = int(match.group(1))
    payload = data[newline + 1 :]
    if binary_size == 4:
        fmt_char = "f"
        check_value = 1234567.0
    else:
        fmt_char = "d"
        check_value = 123456789012345.0
    item_size = struct.calcsize(fmt_char)
    if len(payload) < item_size:
        raise ValueError("OVF binary frame does not include the required binary check value.")

    endian = None
    for candidate in ("<", ">"):
        value = struct.unpack(f"{candidate}{fmt_char}", payload[:item_size])[0]
        if value == check_value:
            endian = candidate
            break
    if endian is None:
        raise ValueError("OVF binary frame check value is invalid or unsupported.")

    xnodes, ynodes, znodes, value_dim = _grid_shape(metadata)
    cell_count = xnodes * ynodes * znodes
    body = payload[item_size:]
    value_count = cell_count * value_dim
    byte_count = value_count * item_size
    footer = _END_DATA_BINARY_BYTES.search(body)
    available_bytes = footer.start() if footer else len(body)
    if available_bytes < byte_count:
        raise ValueError(
            f"OVF binary frame is truncated: expected {byte_count} data byte(s), found {available_bytes}."
        )
    values = struct.unpack(f"{endian}{value_count}{fmt_char}", body[:byte_count])
    rows: list[tuple[float, float, float]] = []
    for offset in range(0, len(values), value_dim):
        rows.append((float(values[offset]), float(values[offset + 1]), float(values[offset + 2])))
    return rows


def summarize_magnetization(
    rows: list[tuple[float, float, float]],
    *,
    active_floor: float = ACTIVE_MAGNITUDE_FLOOR,
    norm_tolerance: float = NORM_SANITY_TOLERANCE,
) -> dict[str, Any]:
    """Spatial averages and |m| sanity from raw OVF cells. Empty geom cells are skipped."""
    active: list[tuple[float, float, float, float]] = []
    for mx, my, mz in rows:
        magnitude = math.sqrt(mx * mx + my * my + mz * mz)
        if magnitude >= active_floor:
            active.append((mx, my, mz, magnitude))
    count = len(active)
    if count == 0:
        return {
            "activeCellCount": 0,
            "totalCellCount": len(rows),
            "meanMx": 0.0,
            "meanMy": 0.0,
            "meanMz": 0.0,
            "stdMz": 0.0,
            "meanNorm": 0.0,
            "normFailureCount": 0,
            "normOk": True,
            "axisOrder": "x fastest, then y, then z (OVF)",
            "componentOrder": "mx, my, mz",
        }
    mean_mx = sum(item[0] for item in active) / count
    mean_my = sum(item[1] for item in active) / count
    mean_mz = sum(item[2] for item in active) / count
    mean_norm = sum(item[3] for item in active) / count
    variance = sum((item[2] - mean_mz) ** 2 for item in active) / count
    norm_failures = sum(1 for item in active if abs(item[3] - 1.0) > norm_tolerance)
    return {
        "activeCellCount": count,
        "totalCellCount": len(rows),
        "meanMx": mean_mx,
        "meanMy": mean_my,
        "meanMz": mean_mz,
        "stdMz": math.sqrt(variance),
        "meanNorm": mean_norm,
        "normFailureCount": norm_failures,
        "normOk": norm_failures == 0,
        "axisOrder": "x fastest, then y, then z (OVF)",
        "componentOrder": "mx, my, mz",
    }


def load_ovf_frame(job_dir: Path, frame: Any, *, max_vectors: int = 20_000) -> dict[str, Any]:
    """Parse one OVF frame into raw per-cell magnetization vectors."""
    relative_path = str(_frame_get(frame, "path", ""))
    path = _safe_relative_frame_path(job_dir, relative_path)
    if not path.exists():
        raise FileNotFoundError(f"OVF frame not found: {relative_path}")

    metadata = _metadata(path)
    header = _read_header(path)
    if _BEGIN_DATA_BINARY.search(header) and not _BEGIN_DATA_TEXT.search(header):
        rows = _parse_data_binary(path, metadata)
    else:
        rows = _parse_data_text(path, metadata)
    warnings: list[str] = []
    if not rows:
        raise ValueError(
            "Only MuMax3 OVF frames with parseable magnetization vectors are previewable; no raw vector rows were found."
        )

    xnodes, ynodes, znodes, _ = _grid_shape(metadata)

    expected = xnodes * ynodes * znodes
    if expected != len(rows):
        raise ValueError(f"OVF header declares {expected} cells but data contains {len(rows)} vectors.")

    dx = float(metadata.get("xstepsize") or 0.0)
    dy = float(metadata.get("ystepsize") or 0.0)
    dz = float(metadata.get("zstepsize") or 0.0)
    x0 = float(metadata["xmin"]) if "xmin" in metadata else 0.0
    y0 = float(metadata["ymin"]) if "ymin" in metadata else 0.0
    z0 = float(metadata["zmin"]) if "zmin" in metadata else 0.0
    sanity = summarize_magnetization(rows)
    if not sanity["normOk"]:
        warnings.append(
            f"{sanity['normFailureCount']} active cell(s) have |m| outside 1±{NORM_SANITY_TOLERANCE}."
        )

    vectors: list[dict[str, Any]] = []
    for index, (mx, my, mz) in enumerate(rows[:max_vectors]):
        xy = max(1, xnodes * ynodes)
        z = index // xy
        remainder = index % xy
        y = remainder // max(1, xnodes)
        x = remainder % max(1, xnodes)
        magnitude = math.sqrt(mx * mx + my * my + mz * mz)
        vector: dict[str, Any] = {
            "index": index,
            "x": x,
            "y": y,
            "z": z,
            "mx": mx,
            "my": my,
            "mz": mz,
            "magnitude": magnitude,
        }
        if dx:
            vector["xMeters"] = x0 + (x + 0.5) * dx
        if dy:
            vector["yMeters"] = y0 + (y + 0.5) * dy
        if dz:
            vector["zMeters"] = z0 + (z + 0.5) * dz
        vectors.append(vector)
    if len(rows) > max_vectors:
        warnings.append(f"Frame has {len(rows)} vectors; preview was capped at {max_vectors}.")

    return {
        "id": _frame_get(frame, "id"),
        "path": relative_path,
        "label": _frame_get(frame, "label") or path.name,
        "index": int(_frame_get(frame, "index") or _frame_index(path)),
        "bytes": path.stat().st_size,
        "format": "ovf",
        "metadata": metadata,
        "vectors": vectors,
        "warnings": warnings,
        "sanity": sanity,
    }
