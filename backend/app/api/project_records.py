"""Local device/study records with immutable revisions and hash-checked JSON bundles."""
import json
import os
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import get_settings
from app.api.requirements import require_local_browser
from app.services.project_record_store import ProjectRecordConflict, ProjectRecordStore

router = APIRouter(dependencies=[Depends(require_local_browser)])
RecordType = Literal["device", "study"]


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
