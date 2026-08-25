"""Detect the production container contract: siesta + tbtrans, optional sisl."""

from __future__ import annotations

from dataclasses import dataclass
import shutil
import subprocess


@dataclass(frozen=True)
class SolverEnvironment:
    siesta: str | None
    tbtrans: str | None
    sisl_available: bool
    transiesta_binary: str | None
    configured: bool
    message: str


def _which(name: str) -> str | None:
    return shutil.which(name)


def _sisl_available() -> bool:
    try:
        import sisl  # noqa: F401
    except ImportError:
        return False
    return True


def probe_environment() -> SolverEnvironment:
    siesta = _which("siesta")
    tbtrans = _which("tbtrans")
    leftover = _which("transiesta")
    sisl_ok = _sisl_available()
    if siesta and tbtrans:
        message = (
            "siesta and tbtrans are present. TranSIESTA must be a SolutionMethod "
            "inside this siesta build, not a separate executable."
        )
        configured = True
    else:
        missing = [name for name, path in (("siesta", siesta), ("tbtrans", tbtrans)) if path is None]
        message = (
            "not_configured: required executable(s) missing: "
            + ", ".join(missing)
            + ". Do not look for a modern standalone transiesta binary."
        )
        configured = False
    return SolverEnvironment(
        siesta=siesta,
        tbtrans=tbtrans,
        sisl_available=sisl_ok,
        transiesta_binary=leftover,
        configured=configured,
        message=message,
    )


def version_line(executable: str) -> str | None:
    try:
        completed = subprocess.run(
            [executable, "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    text = (completed.stdout or completed.stderr or "").strip()
    return text.splitlines()[0] if text else None
