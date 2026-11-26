import copy
import sqlite3

import pytest

from app.services.project_record_store import ProjectRecordConflict, ProjectRecordStore


def device_record(identifier="stack-alpha"):
    return {"schema_version": "1.0", "record_type": "device", "id": identifier,
            "title": "Unratified research stack", "source_refs": ["owner-supplied draft"],
            "metadata": {"scientific_status": "draft"},
            "layers": [
                {"id": "bottom-electrode", "name": "CFAS", "material_ref": None,
                 "thickness": {"value": None, "unit": None, "missing_reason": "Exact composition and thickness are not ratified"},
                 "magnetic_role": None, "status": "unresolved", "source_refs": []},
                {"id": "barrier", "name": "oxide barrier", "material_ref": None,
                 "thickness": {"value": None, "unit": None, "missing_reason": "Phase and measured thickness are unresolved"},
                 "magnetic_role": None, "status": "unresolved", "source_refs": []}],
            "lateral_dimensions": {}, "operating_domain": {}}


def test_project_record_store_versions_parent_relations_and_integrity(tmp_path):
    path = tmp_path / "project.sqlite"
    store = ProjectRecordStore(path)
    first = store.save("device", device_record(), expected_revision=0)
    changed = copy.deepcopy(first["record"])
    changed["metadata"]["note"] = "revision two"
    second = store.save("device", changed, expected_revision=1)
    assert (first["revision"], second["revision"]) == (1, 2)
    assert store.get("device", "stack-alpha", 1)["sha256"] == first["sha256"]
    assert store.list("device")[0]["revision"] == 2
    with pytest.raises(ProjectRecordConflict):
        store.save("device", changed, expected_revision=1)
    study = {"schema_version": "1.0", "record_type": "study", "id": "study-a",
             "title": "Interface benchmark", "source_refs": [], "metadata": {},
             "device_id": "stack-alpha", "device_revision": 2,
             "scientific_question": "Does the selected interface structure reach a stable electronic state?",
             "method": "PBE+U periodic SCF", "parameter_set": {}, "status": "draft"}
    stored_study = store.save("study", study, expected_revision=0)
    assert stored_study["record"]["device_revision"] == 2
    reopened = ProjectRecordStore(path)
    assert reopened.get("study", "study-a")["sha256"] == stored_study["sha256"]
    with reopened.connect() as db:
        assert [row["version"] for row in db.execute("SELECT version FROM schema_migrations")] == [1]


def test_record_unknowns_require_reason_and_known_values_require_units(tmp_path):
    store = ProjectRecordStore(tmp_path / "project.sqlite")
    bad = device_record()
    bad["layers"][0]["thickness"] = {"value": None, "unit": None}
    with pytest.raises(ValueError, match="missing_reason"):
        store.save("device", bad, 0)
    bad = device_record()
    bad["layers"][0]["thickness"] = {"value": 1.0, "unit": None}
    with pytest.raises(ValueError, match="require a unit"):
        store.save("device", bad, 0)


def test_failed_project_record_transaction_leaves_no_partial_revision(tmp_path):
    store = ProjectRecordStore(tmp_path / "project.sqlite")
    with store.connect() as db:
        db.execute("CREATE TRIGGER reject_test_insert BEFORE INSERT ON project_record_revisions BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
    with pytest.raises(sqlite3.IntegrityError, match="injected failure"):
        store.save("device", device_record("transaction-test"), 0)
    assert store.get("device", "transaction-test") is None


def test_study_requires_exact_device_revision_and_export_import_round_trip(tmp_path):
    source = ProjectRecordStore(tmp_path / "source.sqlite")
    device = source.save("device", device_record("roundtrip-stack"), 0)
    revised_device = copy.deepcopy(device["record"])
    revised_device["metadata"]["revision_note"] = "verified source revision two"
    device = source.save("device", revised_device, 1)
    study = {"schema_version": "1.0", "record_type": "study", "id": "roundtrip-study",
             "title": "Study package", "source_refs": [], "metadata": {},
             "device_id": "roundtrip-stack", "device_revision": device["revision"],
             "scientific_question": "Record a future study", "method": "unspecified pending selection",
             "parameter_set": {}, "status": "draft"}
    with pytest.raises(ValueError, match="existing immutable device revision"):
        source.save("study", {**study, "device_revision": 9}, 0)
    source.save("study", study, 0)
    destination = ProjectRecordStore(tmp_path / "imported.sqlite")
    device_bundle = source.export_bundle("device", "roundtrip-stack")
    imported_device = destination.import_bundle(device_bundle)
    study_bundle = source.export_bundle("study", "roundtrip-study")
    imported_study = destination.import_bundle(study_bundle)
    assert imported_device["revision"] == 2
    assert imported_device["record"] == source.get("device", "roundtrip-stack")["record"]
    assert imported_study["record"] == source.get("study", "roundtrip-study")["record"]
    tampered = copy.deepcopy(device_bundle)
    tampered["record"]["title"] = "altered"
    with pytest.raises(ValueError, match="bundle integrity"):
        destination.import_bundle(tampered)
    with pytest.raises(ProjectRecordConflict):
        destination.import_bundle(device_bundle)


def test_project_record_api_roundtrip(client, tmp_path, monkeypatch):
    monkeypatch.setenv("SPINVAULT_PROJECT_RECORDS_DB", str(tmp_path / "records.sqlite"))
    payload = device_record("api-stack")
    saved = client.post("/api/project-records/device", json={"record": payload, "expected_revision": 0})
    assert saved.status_code == 200
    assert saved.json()["record"]["layers"][0]["thickness"]["missing_reason"]
    listing = client.get("/api/project-records/device")
    assert listing.status_code == 200 and listing.json()["records"][0]["id"] == "api-stack"
    exported = client.get("/api/project-records/device/api-stack/export")
    assert exported.status_code == 200 and "bundle_sha256" in exported.json()
    other = tmp_path / "other.sqlite"
    monkeypatch.setenv("SPINVAULT_PROJECT_RECORDS_DB", str(other))
    imported = client.post("/api/project-records/import", json={"bundle": exported.json()})
    assert imported.status_code == 200, imported.json()
    bad = client.post("/api/project-records/device", json={"record": {**payload, "id": "bad/id"}, "expected_revision": 0})
    assert bad.status_code == 422
