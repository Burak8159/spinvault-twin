"""Honest NVIDIA/GPU capability detection. Never invents RTX/CUDA run acceleration."""

from __future__ import annotations

import shutil
import subprocess
from typing import Callable

from app.models.gpu import Acceleration, GpuInfo

CommandRunner = Callable[[list[str], float], tuple[int, str, str]]

# MuMax3 / CUDA runtime markers that indicate the solver used a GPU path.
_MUMAX_CUDA_MARKERS = (
    "cuda",
    "using cc=",
    "ptx",
    "gpu:",
    "openccl",
)


def _default_run(command: list[str], timeout: float) -> tuple[int, str, str]:
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            shell=False,
        )
        return completed.returncode, completed.stdout or "", completed.stderr or ""
    except FileNotFoundError:
        return 127, "", "executable not found"
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"


def detect_gpu(runner: CommandRunner | None = None) -> GpuInfo:
    """
    Probe NVIDIA tooling when present.

    Host detection never sets acceleration to cuda/rtx. Those labels are reserved for
    confirmed MuMax3 GPU execution (see run_acceleration_label). Detected hosts use
    host_gpu_available (or gpu_detected when device inventory is incomplete).
    """
    run = runner or _default_run
    if shutil.which("nvidia-smi") is None:
        return GpuInfo(
            gpu_available=False,
            acceleration="not_configured",
            details="No NVIDIA runtime detected (nvidia-smi not found).",
        )

    code, stdout, stderr = run(
        [
            "nvidia-smi",
            "--query-gpu=name,driver_version",
            "--format=csv,noheader",
        ],
        5.0,
    )
    if code != 0:
        return GpuInfo(
            gpu_available=False,
            acceleration="not_configured",
            details=f"nvidia-smi failed: {(stderr or stdout or 'unknown error').strip()}",
            raw={"returncode": code, "stderr": stderr, "stdout": stdout},
        )

    devices: list[str] = []
    driver_version: str | None = None
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [part.strip() for part in line.split(",")]
        if parts:
            devices.append(parts[0])
        if len(parts) > 1 and parts[1]:
            driver_version = parts[1]

    if not devices:
        return GpuInfo(
            gpu_available=False,
            acceleration="not_configured",
            details="nvidia-smi returned no GPU devices.",
            driver_version=driver_version,
            raw={"stdout": stdout},
        )

    cuda_version = None
    code2, out2, _err2 = run(["nvidia-smi"], 5.0)
    if code2 == 0:
        marker = "CUDA Version:"
        if marker in out2:
            cuda_version = out2.split(marker, 1)[1].strip().split()[0]

    has_named_rtx = any("rtx" in name.lower() for name in devices)
    details = f"Host GPU detected via nvidia-smi: {', '.join(devices)}"
    if has_named_rtx:
        details += " (RTX-class device name; not a confirmed MuMax3 CUDA run label)."
    else:
        details += " (host detection only; not a confirmed MuMax3 CUDA run label)."

    return GpuInfo(
        gpu_available=True,
        acceleration="host_gpu_available",
        details=details,
        devices=devices,
        driver_version=driver_version,
        cuda_version=cuda_version,
        raw={"nvidia_smi_csv": stdout},
    )


def mumax_cuda_execution_evidence(stdout: str = "", stderr: str = "") -> bool:
    """True only when MuMax3 logs indicate a CUDA/GPU execution path."""
    text = f"{stdout}\n{stderr}".lower()
    return any(marker in text for marker in _MUMAX_CUDA_MARKERS)


def run_acceleration_label(
    gpu: GpuInfo,
    *,
    success: bool,
    stdout: str = "",
    stderr: str = "",
) -> Acceleration:
    """
    Label a completed MuMax3 run.

    Returns cuda/rtx only when the process succeeded and logs show CUDA/GPU evidence.
    Host nvidia-smi detection alone is never enough for cuda/rtx.
    """
    if not success:
        return "not_configured"
    if not mumax_cuda_execution_evidence(stdout, stderr):
        return "not_configured"
    if not gpu.gpu_available:
        # Logs claim CUDA but host probe failed — keep unknown rather than inventing a device class.
        return "unknown"
    if any("rtx" in name.lower() for name in gpu.devices):
        return "rtx"
    return "cuda"


def acceleration_for_successful_run(gpu: GpuInfo) -> Acceleration:
    """Deprecated alias: host detection alone must not yield cuda/rtx."""
    if not gpu.gpu_available:
        return "not_configured"
    return "host_gpu_available"
