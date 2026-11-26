"""Local device/study records with immutable revisions and hash-checked JSON bundles."""
import json
import hashlib
import os
import re
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import get_settings
from app.api.requirements import require_local_browser
from app.services.project_record_store import ProjectRecordConflict, ProjectRecordStore

router = APIRouter(dependencies=[Depends(require_local_browser)])
RecordType = Literal["device", "study", "structure", "material"]


def store():
    fallback = Path(get_settings().requirements_db).with_name("project_records.sqlite")
    return ProjectRecordStore(Path(os.environ.get("SPINVAULT_PROJECT_RECORDS_DB") or fallback))


class SaveProjectRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    record: dict
    expected_revision: int = Field(ge=0)

    @field_validator("record")
    @classmethod
    def bounded_record(cls, value):
        if len(json.dumps(value, allow_nan=False).encode("utf-8")) > 2 * 1024 * 1024:
            raise ValueError("Project record exceeds the 2 MiB limit")
        return value


class ImportBundle(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    bundle: dict

    @field_validator("bundle")
    @classmethod
    def bounded_bundle(cls, value):
        if len(json.dumps(value, allow_nan=False).encode("utf-8")) > 3 * 1024 * 1024:
            raise ValueError("Project-record bundle exceeds the 3 MiB limit")
        return value


class ImportStudyPackage(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    package: dict

    @field_validator("package")
    @classmethod
    def bounded_package(cls, value):
        if len(json.dumps(value, allow_nan=False).encode("utf-8")) > 6 * 1024 * 1024:
            raise ValueError("Study package exceeds the 6 MiB limit")
        return value


class ImportProjectArchive(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    archive: dict

    @field_validator("archive")
    @classmethod
    def bounded_archive(cls, value):
        if len(json.dumps(value, allow_nan=False).encode("utf-8")) > 12 * 1024 * 1024:
            raise ValueError("Project archive exceeds the 12 MiB limit")
        return value


class ImportQeStructureCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    catalog_json: str = Field(min_length=2, max_length=2 * 1024 * 1024)
    filename: str = Field(min_length=1, max_length=256)

    @field_validator("catalog_json")
    @classmethod
    def bounded_catalog_bytes(cls, value):
        if len(value.encode("utf-8")) > 2 * 1024 * 1024:
            raise ValueError("QE structure catalog exceeds the 2 MiB limit")
        return value


def qe_catalog_to_structure(catalog_text: str, filename: str) -> dict:
    try:
        source = json.loads(catalog_text)
    except (json.JSONDecodeError, TypeError) as error:
        raise ValueError("QE structure catalog is not valid JSON") from error
    if (not isinstance(source, dict) or source.get("schema_version") != 1
            or not isinstance(source.get("atoms"), list)
            or source.get("atom_count") != len(source["atoms"])
            or not isinstance(source.get("cell_angstrom"), list)
            or len(source["cell_angstrom"]) != 3):
        raise ValueError("Unsupported QE structure catalog format")
    identifier = source.get("id")
    if not isinstance(identifier, str) or not identifier or len(identifier) > 128:
        raise ValueError("QE structure catalog has an invalid ID")
    element_for_label = {"FeC": "Fe", "FeA": "Fe", "FeB": "Fe", "NiB": "Ni",
                         "Co": "Co", "Al": "Al", "Si": "Si", "O": "O"}
    nfo_labels = {"FeA", "FeB", "NiB", "O"}
    sublattice_for_label = {"FeA": "Fe(A)", "FeB": "Fe(B)", "NiB": "Ni(B)"}
    atoms = []
    species_counts = {}
    for expected_index, atom in enumerate(source["atoms"], start=1):
        if not isinstance(atom, dict) or atom.get("index") != expected_index:
            raise ValueError("QE atom indices must be contiguous and ordered from one")
        label = atom.get("species")
        element = element_for_label.get(label)
        position = atom.get("position_angstrom")
        if (element is None or not isinstance(position, list) or len(position) != 3
                or any(not isinstance(value, (int, float)) or isinstance(value, bool) for value in position)):
            raise ValueError(f"Invalid QE species or coordinates at atom {expected_index}")
        species_counts[label] = species_counts.get(label, 0) + 1
        atoms.append({"index": expected_index, "element": element, "species_label": label,
                      "position_angstrom": position,
                      "sublattice": sublattice_for_label.get(label),
                      "region": "NFO" if label in nfo_labels else "CFAS"})
    if species_counts != source.get("species_counts"):
        raise ValueError("QE species counts do not match the catalog summary")
    source_digest = hashlib.sha256(catalog_text.encode("utf-8")).hexdigest()
    declared_source_hash = source.get("source_sha256")
    if not isinstance(declared_source_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", declared_source_hash):
        raise ValueError("QE catalog is missing its declared source-input hash")
    return {
        "schema_version": "1.0", "record_type": "structure", "id": identifier,
        "title": f"{identifier} · source geometry",
        "source_refs": [f"catalog_file={filename}", f"catalog_sha256={source_digest}",
                        f"declared_source_input={source.get('source_input', '')}",
                        f"declared_source_input_sha256={declared_source_hash}"],
        "metadata": {"species_counts": species_counts, "legacy_schema_version": 1},
        "atom_count": source["atom_count"], "lattice_vectors_angstrom": source["cell_angstrom"],
        "periodic_axes": [True, True, True], "atoms": atoms,
        "initial_spin_by_species": source.get("initial_spin_parameters", {}),
        "magnetic_label": source.get("magnetic_label", "Unspecified"),
        "source_status": source.get("status", "UNSPECIFIED"), "transport_validated": False,
    }


@router.post("/project-records/import")
def import_record(request: ImportBundle):
    try:
        return store().import_bundle(request.bundle)
    except ProjectRecordConflict as error:
        raise HTTPException(409, str(error))
    except (ValueError, TypeError, KeyError) as error:
        raise HTTPException(422, str(error))


@router.get("/project-records/study/{identifier}/package")
def export_study_package(identifier: str, revision: int | None = None):
    try:
        package = store().export_study_package(identifier, revision)
    except ValueError as error:
        raise HTTPException(422, str(error))
    if package is None:
        raise HTTPException(404, "Project study revision unavailable")
    return package


@router.post("/project-records/study-package/import")
def import_study_package(request: ImportStudyPackage):
    try:
        return store().import_study_package(request.package)
    except ProjectRecordConflict as error:
        raise HTTPException(409, str(error))
    except (ValueError, TypeError, KeyError) as error:
        raise HTTPException(422, str(error))


@router.get("/project-records/archive")
def export_project_archive():
    try:
        return store().export_project_archive()
    except ValueError as error:
        raise HTTPException(413 if "limit" in str(error) else 422, str(error))


@router.post("/project-records/archive/import")
def import_project_archive(request: ImportProjectArchive):
    try:
        return store().import_project_archive(request.archive)
    except ProjectRecordConflict as error:
        raise HTTPException(409, str(error))
    except (ValueError, TypeError, KeyError) as error:
        raise HTTPException(422, str(error))


@router.post("/project-records/import-qe-structure")
def import_qe_structure(request: ImportQeStructureCatalog):
    try:
        record = qe_catalog_to_structure(request.catalog_json, request.filename)
        return store().save("structure", record, expected_revision=0)
    except ProjectRecordConflict as error:
        raise HTTPException(409, str(error))
    except (ValueError, TypeError, KeyError) as error:
        raise HTTPException(422, str(error))


@router.get("/project-records/{record_type}")
def list_records(record_type: RecordType):
    return {"records": store().list(record_type)}


@router.get("/project-records/{record_type}/{identifier}")
def get_record(record_type: RecordType, identifier: str, revision: int | None = None):
    result = store().get(record_type, identifier, revision)
    if result is None:
        raise HTTPException(404, "Project record revision unavailable")
    return result


@router.post("/project-records/{record_type}")
def save_record(record_type: RecordType, request: SaveProjectRecord):
    try:
        return store().save(record_type, request.record, request.expected_revision)
    except ProjectRecordConflict as error:
        raise HTTPException(409, str(error))
    except (ValueError, TypeError) as error:
        raise HTTPException(422, str(error))


@router.get("/project-records/{record_type}/{identifier}/export")
def export_record(record_type: RecordType, identifier: str, revision: int | None = None):
    bundle = store().export_bundle(record_type, identifier, revision)
    if bundle is None:
        raise HTTPException(404, "Project record revision unavailable")
    return bundle
