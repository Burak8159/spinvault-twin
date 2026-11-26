import json
import sqlite3

import pytest

from app.services.project_record_backup import backup_database, restore_database
from app.services.project_record_store import ProjectRecordStore


def test_backup_restore_preserves_record_and_hashes(tmp_path):
    source = tmp_path / "source.sqlite"
    store = ProjectRecordStore(source)
    record = {"schema_version": "1.0", "record_type": "device", "id": "backup-fixture", "title": "Fixture",
              "layers": [{"id": "layer-1", "name": "Unknown", "thickness": {"value": None, "unit": None,
                           "missing_reason": "fixture"}, "status": "unresolved"}], "source_refs": []}
    original = store.save("device", record, 0)
    bundle = tmp_path / "backup"
    manifest = backup_database(source, bundle)
    assert manifest["schema_version"] == 1
    destination = tmp_path / "restored.sqlite"
    restored_manifest = restore_database(bundle, destination)
    restored = ProjectRecordStore(destination).get("device", "backup-fixture")
    assert restored["record"] == original["record"]
    assert restored["sha256"] == original["sha256"]
    assert restored_manifest["database_sha256"] == manifest["database_sha256"]


def test_backup_refuses_overwrite_and_rejects_tampering(tmp_path):
    source = tmp_path / "source.sqlite"
    ProjectRecordStore(source)
    bundle = tmp_path / "backup"
    backup_database(source, bundle)
    with pytest.raises(FileExistsError):
        backup_database(source, bundle)
    with (bundle / "project_records.sqlite3").open("ab") as database:
        database.write(b"tamper")
    with pytest.raises(ValueError, match="hash or size"):
        restore_database(bundle, tmp_path / "restored.sqlite")


def test_restore_refuses_existing_destination(tmp_path):
    source = tmp_path / "source.sqlite"
    ProjectRecordStore(source)
    bundle = tmp_path / "backup"
    backup_database(source, bundle)
    destination = tmp_path / "existing.sqlite"
    destination.write_bytes(b"preserve")
    with pytest.raises(FileExistsError):
        restore_database(bundle, destination)
    assert destination.read_bytes() == b"preserve"
