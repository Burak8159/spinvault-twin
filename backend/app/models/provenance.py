"""Shared provenance metadata."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class CamelModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        extra="forbid",
    )


class Provenance(CamelModel):
    created_at: datetime = Field(default_factory=utc_now, alias="createdAt")
    created_by: Literal["user", "system", "demo_fixture"] = Field(
        default="system", alias="createdBy"
    )
    solver: Literal["none", "demo", "mumax3", "kwant", "surrogate", "python_llg", "python_micromagnetic"] = "none"
    solver_version: str | None = Field(default=None, alias="solverVersion")
    input_hash: str | None = Field(default=None, alias="inputHash")
    notes: list[str] = Field(default_factory=list)
