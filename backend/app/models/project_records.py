"""Versioned, source-aware project records; unknown physics stays explicit."""
from __future__ import annotations

import json
import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RecordModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    schema_version: Literal["1.0"] = "1.0"
    id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(min_length=1, max_length=256)
    source_refs: list[str] = Field(default_factory=list, max_length=128)
    metadata: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def bounded_json(self):
        try:
            encoded = json.dumps(self.model_dump(mode="json"), allow_nan=False, separators=(",", ":"))
        except (TypeError, ValueError) as error:
            raise ValueError("Record contains non-JSON or non-finite values") from error
        if len(encoded.encode("utf-8")) > 2 * 1024 * 1024:
            raise ValueError("Project record exceeds the 2 MiB limit")
        return self


class Quantity(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    value: float | None = Field(default=None, strict=True)
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    missing_reason: str | None = Field(default=None, max_length=512)

    @model_validator(mode="after")
    def explicit_unknown(self):
        if self.value is None and not (self.missing_reason and self.missing_reason.strip()):
            raise ValueError("Unknown numeric values require a missing_reason")
        if self.value is not None and (self.unit is None or not math.isfinite(self.value)):
            raise ValueError("Known numeric values require a unit and must be finite")
        if self.value is not None and self.missing_reason is not None:
            raise ValueError("Known values cannot also have a missing_reason")
        return self


class Layer(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=128)
    material_ref: str | None = Field(default=None, max_length=256)
    thickness: Quantity
    magnetic_role: str | None = Field(default=None, max_length=128)
    status: Literal["known", "assumed", "unresolved"] = "unresolved"
    source_refs: list[str] = Field(default_factory=list, max_length=128)


class DeviceRecord(RecordModel):
    record_type: Literal["device"] = "device"
    layers: list[Layer] = Field(min_length=1, max_length=256)
    lateral_dimensions: dict = Field(default_factory=dict)
    operating_domain: dict = Field(default_factory=dict)


class StudyRecord(RecordModel):
    record_type: Literal["study"] = "study"
    device_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    device_revision: int = Field(ge=1)
    scientific_question: str = Field(min_length=1, max_length=4000)
    method: str = Field(min_length=1, max_length=128)
    parameter_set: dict = Field(default_factory=dict)
    status: Literal["draft", "prepared", "running", "complete", "failed"] = "draft"


RecordType = Literal["device", "study"]
RECORD_MODELS = {"device": DeviceRecord, "study": StudyRecord}
