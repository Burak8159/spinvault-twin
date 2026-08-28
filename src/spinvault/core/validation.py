"""Minimal validation helpers for transport smoke."""

from __future__ import annotations

from pathlib import Path


def require_existing_file(path: Path, label: str) -> Path:
    resolved = path.resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"{label} not found: {resolved}")
    return resolved


def require_executable(path: str | None, name: str) -> str:
    if not path:
        raise ValueError(f"{name} executable path is required")
    resolved = Path(path)
    if not resolved.is_file():
        raise FileNotFoundError(f"{name} executable not found: {resolved}")
    return str(resolved)
