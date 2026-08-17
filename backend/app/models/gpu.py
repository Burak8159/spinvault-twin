"""GPU metadata model shared by jobs and workers."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.models.provenance import CamelModel

# Host detection uses host_gpu_available / gpu_detected.
# cuda / rtx are reserved for confirmed MuMax3 GPU execution evidence.
Acceleration = Literal[
    "not_configured",
    "host_gpu_available",
    "gpu_detected",
    "cuda",
    "rtx",
    "unknown",
]


class GpuInfo(CamelModel):
    gpu_available: bool = Field(alias="gpuAvailable")
    acceleration: Acceleration = "not_configured"
    details: str
    devices: list[str] = Field(default_factory=list)
    driver_version: str | None = Field(default=None, alias="driverVersion")
    cuda_version: str | None = Field(default=None, alias="cudaVersion")
    raw: dict[str, Any] = Field(default_factory=dict)
