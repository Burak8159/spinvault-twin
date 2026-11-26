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
    structure_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    structure_revision: int | None = Field(default=None, ge=1)
    scientific_question: str = Field(min_length=1, max_length=4000)
    method: str = Field(min_length=1, max_length=128)
    parameter_set: dict = Field(default_factory=dict)
    status: Literal["draft", "prepared", "running", "complete", "failed"] = "draft"

    @model_validator(mode="after")
    def paired_structure_reference(self):
        if (self.structure_id is None) != (self.structure_revision is None):
            raise ValueError("Study structure_id and structure_revision must be set together")
        return self


class StructureAtom(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    index: int = Field(ge=1)
    element: str = Field(min_length=1, max_length=3, pattern=r"^[A-Z][a-z]?$" )
    species_label: str = Field(min_length=1, max_length=64)
    position_angstrom: tuple[float, float, float]
    sublattice: str | None = Field(default=None, max_length=64)
    region: str | None = Field(default=None, max_length=128)


class StructureRecord(RecordModel):
    record_type: Literal["structure"] = "structure"
    atom_count: int = Field(ge=1, le=50000)
    lattice_vectors_angstrom: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]
    periodic_axes: tuple[bool, bool, bool]
    atoms: list[StructureAtom] = Field(min_length=1, max_length=50000)
    initial_spin_by_species: dict[str, float] = Field(default_factory=dict)
    magnetic_label: str = Field(min_length=1, max_length=512)
    source_status: str = Field(min_length=1, max_length=128)
    transport_validated: bool = False

    @model_validator(mode="after")
    def consistent_geometry(self):
        if self.atom_count != len(self.atoms):
            raise ValueError("atom_count must match the atom list length")
        indices = [atom.index for atom in self.atoms]
        if len(indices) != len(set(indices)) or set(indices) != set(range(1, self.atom_count + 1)):
            raise ValueError("atom indices must be unique and contiguous from 1 through atom_count")
        a, b, c = self.lattice_vectors_angstrom
        determinant = (
            a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0])
        )
        if abs(determinant) < 1e-9:
            raise ValueError("lattice vectors must span a nonzero cell")
        if any(not math.isfinite(value) for atom in self.atoms for value in atom.position_angstrom):
            raise ValueError("atomic coordinates must be finite")
        if any(not math.isfinite(value) for value in self.initial_spin_by_species.values()):
            raise ValueError("initial magnetic seeds must be finite")
        return self


RecordType = Literal["device", "study", "structure"]
RECORD_MODELS = {"device": DeviceRecord, "study": StudyRecord, "structure": StructureRecord}
