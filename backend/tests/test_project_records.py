import copy
import hashlib
import json
import sqlite3

import pytest

from app.services.project_record_store import (
    ProjectRecordConflict,
    ProjectRecordStore,
    UnsupportedProjectSchema,
)
from app.api.project_records import structure_catalog_to_record


def device_record(identifier="stack-alpha"):
    return {"schema_version": "1.0", "record_type": "device", "id": identifier,
            "title": "Synthetic unratified stack", "source_refs": ["synthetic fixture"],
            "metadata": {"scientific_status": "draft"},
            "layers": [
                {"id": "layer-a", "name": "Layer A", "material_ref": None,
                 "thickness": {"value": None, "unit": None, "missing_reason": "Synthetic unresolved thickness"},
                 "magnetic_role": None, "status": "unresolved", "source_refs": []},
                {"id": "layer-b", "name": "Layer B", "material_ref": None,
                 "thickness": {"value": None, "unit": None, "missing_reason": "Synthetic unresolved thickness"},
                 "magnetic_role": None, "status": "unresolved", "source_refs": []}],
            "lateral_dimensions": {}, "operating_domain": {}}


def structure_record(identifier="cfas-nfo-structure"):
    atoms = [{"index": 1, "element": "Fe", "species_label": "FeA",
              "position_angstrom": [0.0, 0.0, 0.0], "sublattice": "A", "region": "NFO"},
             {"index": 2, "element": "O", "species_label": "O",
              "position_angstrom": [1.0, 1.0, 1.0], "region": "NFO"}]
    return {"schema_version": "1.0", "record_type": "structure", "id": identifier,
            "title": "Prepared interface geometry", "source_refs": ["source structure hash: " + "a" * 64],
            "metadata": {}, "atom_count": 2,
            "lattice_vectors_angstrom": [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 8.0]],
            "periodic_axes": [True, True, True], "atoms": atoms,
            "initial_spin_by_species": {"FeA": -0.4},
            "magnetic_label": "ferrimagnetic seeds; not converged",
            "source_status": "PREPARED_NOT_EXECUTED", "transport_validated": False}


def material_record(identifier="nfo-material"):
    return {"schema_version": "1.0", "record_type": "material", "id": identifier,
            "title": "Source-qualified nickel ferrite record", "source_refs": ["synthetic test fixture"],
            "metadata": {}, "composition": {"Ni": 1, "Fe": 2, "O": 4},
            "composition_missing_reason": None, "phase": "inverse spinel (test label)",
            "phase_missing_reason": None,
            "properties": [{"id": "lattice-param-a", "name": "Lattice parameter a",
                            "quantity": {"value": 8.34, "unit": "angstrom"},
                            "conditions": {"temperature": {"value": 300, "unit": "K"}},
                            "source_refs": ["synthetic test fixture"]}],
            "validity_domain": {"temperature": {"value": None, "unit": None,
                                                   "missing_reason": "Not established by this fixture"}}}


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


def test_store_refuses_newer_schema_without_modifying_database(tmp_path):
    path = tmp_path / "future-project.sqlite"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
        db.execute("INSERT INTO schema_migrations(version, applied_at) VALUES(2, 'future-fixture')")
        db.execute("CREATE TABLE future_records (id TEXT PRIMARY KEY)")
        journal_mode = db.execute("PRAGMA journal_mode").fetchone()[0]

    with pytest.raises(UnsupportedProjectSchema, match="newer than supported version 1"):
        ProjectRecordStore(path)

    with sqlite3.connect(path) as db:
        assert db.execute("SELECT version, applied_at FROM schema_migrations").fetchall() == [(2, "future-fixture")]
        assert db.execute("PRAGMA journal_mode").fetchone()[0] == journal_mode
        assert db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall() == [("future_records",), ("schema_migrations",)]


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
             "scientific_question": "Does the synthetic fixture preserve linked revisions?", "method": "synthetic test method",
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
    study = {"schema_version": "1.0", "record_type": "study", "id": "api-study",
             "title": "Synthetic API study", "source_refs": [], "metadata": {},
             "device_id": "api-stack", "device_revision": 1,
             "scientific_question": "Does the test route preserve the parent?", "method": "synthetic",
             "parameter_set": {}, "status": "draft"}
    saved_study = client.post("/api/project-records/study", json={"record": study, "expected_revision": 0})
    assert saved_study.status_code == 200
    package = client.get("/api/project-records/study/api-study/package")
    assert package.status_code == 200 and package.json()["device"]["source_revision"] == 1
    monkeypatch.setenv("SPINVAULT_PROJECT_RECORDS_DB", str(tmp_path / "package-import.sqlite"))
    imported_package = client.post("/api/project-records/study-package/import", json={"package": package.json()})
    assert imported_package.status_code == 200, imported_package.json()
    assert imported_package.json()["record"]["device_revision"] == 1


def test_material_record_round_trip_provenance_validation_and_archive(client, tmp_path, monkeypatch):
    source_path = tmp_path / "material-source.sqlite"
    monkeypatch.setenv("SPINVAULT_PROJECT_RECORDS_DB", str(source_path))
    record = material_record()
    saved = client.post("/api/project-records/material", json={"record": record, "expected_revision": 0})
    assert saved.status_code == 200, saved.json()
    assert saved.json()["record"]["composition"] == {"Ni": 1.0, "Fe": 2.0, "O": 4.0}
    assert client.get("/api/project-records/material").json()["records"][0]["id"] == "nfo-material"

    exported = client.get("/api/project-records/material/nfo-material/export")
    assert exported.status_code == 200 and "bundle_sha256" in exported.json()
    monkeypatch.setenv("SPINVAULT_PROJECT_RECORDS_DB", str(tmp_path / "material-import.sqlite"))
    imported = client.post("/api/project-records/import", json={"bundle": exported.json()})
    assert imported.status_code == 200, imported.json()
    assert imported.json()["record"] == saved.json()["record"]

    archive = client.get("/api/project-records/archive")
    assert archive.status_code == 200 and archive.json()["records"][0]["record_type"] == "material"
    monkeypatch.setenv("SPINVAULT_PROJECT_RECORDS_DB", str(tmp_path / "material-archive-import.sqlite"))
    archive_import = client.post("/api/project-records/archive/import", json={"archive": archive.json()})
    assert archive_import.status_code == 200, archive_import.json()
    assert archive_import.json()["imported_records"] == 1

    missing_source = material_record("missing-source")
    missing_source["source_refs"] = []
    assert client.post("/api/project-records/material", json={"record": missing_source,
                       "expected_revision": 0}).status_code == 422
    unknown_without_reason = material_record("unknown-composition")
    unknown_without_reason.update(composition={}, composition_missing_reason=None)
    assert client.post("/api/project-records/material", json={"record": unknown_without_reason,
                       "expected_revision": 0}).status_code == 422
    unknown_property = material_record("unsourced-property")
    unknown_property["properties"][0]["source_refs"] = []
    assert client.post("/api/project-records/material", json={"record": unknown_property,
                       "expected_revision": 0}).status_code == 422
    unsourced_condition = material_record("unsourced-condition")
    unsourced_condition["properties"][0]["quantity"] = {
        "value": None, "unit": None, "missing_reason": "Synthetic unknown property"
    }
    unsourced_condition["properties"][0]["source_refs"] = []
    assert client.post("/api/project-records/material", json={"record": unsourced_condition,
                       "expected_revision": 0}).status_code == 422


def test_study_package_preserves_exact_parent_revision_atomically(tmp_path):
    source = ProjectRecordStore(tmp_path / "source.sqlite")
    device_v1 = source.save("device", device_record("package-parent"), 0)
    device_v2_payload = copy.deepcopy(device_v1["record"])
    device_v2_payload["metadata"]["note"] = "later revision"
    source.save("device", device_v2_payload, 1)
    study = {"schema_version": "1.0", "record_type": "study", "id": "package-study",
             "title": "Synthetic package fixture", "source_refs": [], "metadata": {},
             "device_id": "package-parent", "device_revision": 1,
             "scientific_question": "Can this package preserve its exact parent?", "method": "synthetic test",
             "parameter_set": {}, "status": "draft"}
    source.save("study", study, 0)
    package = source.export_study_package("package-study")
    assert package["device"]["source_revision"] == 1
    destination = ProjectRecordStore(tmp_path / "destination.sqlite")
    imported_study = destination.import_study_package(package)
    assert imported_study["record"]["device_revision"] == 1
    assert destination.get("device", "package-parent", 1)["sha256"] == device_v1["sha256"]
    assert destination.get("device", "package-parent", 2) is None
    with pytest.raises(ProjectRecordConflict):
        destination.import_study_package(package)
    assert len(destination.list("device")) == 1 and len(destination.list("study")) == 1

    forged = copy.deepcopy(package)
    forged["study"]["record"]["device_revision"] = 2
    forged["study"]["record_sha256"] = hashlib.sha256(
        source.canonical(forged["study"]["record"]).encode("utf-8")).hexdigest()
    forged_body = {key: value for key, value in forged.items() if key != "package_sha256"}
    forged["package_sha256"] = hashlib.sha256(source.canonical(forged_body).encode("utf-8")).hexdigest()
    with pytest.raises(ValueError, match="exact parent"):
        ProjectRecordStore(tmp_path / "forged.sqlite").import_study_package(forged)


def test_study_package_preserves_exact_structure_revision_too(tmp_path):
    source = ProjectRecordStore(tmp_path / "source-with-structure.sqlite")
    source.save("device", device_record("structure-parent-device"), 0)
    structure_v1 = source.save("structure", structure_record("structure-parent-geometry"), 0)
    structure_v2_payload = copy.deepcopy(structure_v1["record"])
    structure_v2_payload["metadata"]["later"] = "must not replace linked r1"
    source.save("structure", structure_v2_payload, 1)
    study = {"schema_version": "1.0", "record_type": "study", "id": "structure-linked-study",
             "title": "Exact structure link", "source_refs": [], "metadata": {},
             "device_id": "structure-parent-device", "device_revision": 1,
             "structure_id": "structure-parent-geometry", "structure_revision": 1,
             "scientific_question": "Does the exact structure travel with its study?", "method": "synthetic test",
             "parameter_set": {}, "status": "draft"}
    source.save("study", study, 0)
    package = source.export_study_package("structure-linked-study")
    assert package["package_type"] == "study_with_device_and_structure"
    assert package["structure"]["source_revision"] == 1
    destination = ProjectRecordStore(tmp_path / "destination-with-structure.sqlite")
    imported = destination.import_study_package(package)
    assert imported["record"]["structure_revision"] == 1
    assert destination.get("structure", "structure-parent-geometry", 1)["sha256"] == structure_v1["sha256"]
    assert destination.get("structure", "structure-parent-geometry", 2) is None


def test_study_structure_link_requires_exact_existing_revision_and_archive_parent(tmp_path):
    source = ProjectRecordStore(tmp_path / "source-link-check.sqlite")
    source.save("device", device_record("link-check-device"), 0)
    study = {"schema_version": "1.0", "record_type": "study", "id": "link-check-study",
             "title": "Structure parent validation", "source_refs": [], "metadata": {},
             "device_id": "link-check-device", "device_revision": 1,
             "structure_id": "missing-geometry", "structure_revision": 1,
             "scientific_question": "Are structure parents checked?", "method": "synthetic test",
             "parameter_set": {}, "status": "draft"}
    with pytest.raises(ValueError, match="existing immutable structure revision"):
        source.save("study", study, 0)
    with pytest.raises(ValueError, match="set together"):
        source.save("study", {**study, "structure_revision": None}, 0)

    geometry = source.save("structure", structure_record("archive-link-geometry"), 0)
    study.update(id="archive-link-study", structure_id="archive-link-geometry")
    source.save("study", study, 0)
    archive = source.export_project_archive()
    archive["records"] = [entry for entry in archive["records"] if not (
        entry["record_type"] == "structure" and entry["id"] == "archive-link-geometry")]
    body = {key: value for key, value in archive.items() if key != "archive_sha256"}
    archive["archive_sha256"] = hashlib.sha256(source.canonical(body).encode("utf-8")).hexdigest()
    destination = ProjectRecordStore(tmp_path / "atomic-link-check.sqlite")
    with pytest.raises(ValueError, match="missing structure revision"):
        destination.import_project_archive(archive)
    assert destination.list("device") == [] and destination.list("study") == [] and destination.list("structure") == []
    assert geometry["record"]["id"] == "archive-link-geometry"


def test_project_archive_round_trip_preserves_all_revisions_and_links(tmp_path):
    source = ProjectRecordStore(tmp_path / "source.sqlite")
    device_v1 = source.save("device", device_record("archive-device"), 0)
    device_v2_payload = copy.deepcopy(device_v1["record"])
    device_v2_payload["metadata"]["revision_note"] = "second revision"
    device_v2 = source.save("device", device_v2_payload, 1)
    study = {"schema_version": "1.0", "record_type": "study", "id": "archive-study",
             "title": "Archive fixture", "source_refs": [], "metadata": {},
             "device_id": "archive-device", "device_revision": 1,
             "scientific_question": "Does a project archive preserve exact revisions?",
             "method": "synthetic test", "parameter_set": {}, "status": "draft"}
    source.save("study", study, 0)

    archive = source.export_project_archive()
    destination = ProjectRecordStore(tmp_path / "restored.sqlite")
    imported = destination.import_project_archive(archive)
    assert imported == {"imported_records": 2, "imported_revisions": 3}
    assert destination.get("device", "archive-device", 1)["sha256"] == device_v1["sha256"]
    assert destination.get("device", "archive-device", 2)["sha256"] == device_v2["sha256"]
    assert destination.get("study", "archive-study")["record"]["device_revision"] == 1


def test_project_archive_rejects_tampering_collision_and_missing_parent_atomically(tmp_path):
    source = ProjectRecordStore(tmp_path / "source.sqlite")
    source.save("device", device_record("archive-parent"), 0)
    source.save("device", device_record("archive-unconflicted"), 0)
    archive = source.export_project_archive()

    tampered = copy.deepcopy(archive)
    tampered["records"][0]["record"]["title"] = "tampered"
    with pytest.raises(ValueError, match="integrity"):
        ProjectRecordStore(tmp_path / "tampered.sqlite").import_project_archive(tampered)

    destination = ProjectRecordStore(tmp_path / "destination.sqlite")
    destination.save("device", device_record("archive-parent"), 0)
    with pytest.raises(ProjectRecordConflict):
        destination.import_project_archive(archive)
    assert len(destination.list("device")) == 1
    assert destination.get("device", "archive-unconflicted") is None

    study_only = copy.deepcopy(archive)
    orphan = {"schema_version": "1.0", "record_type": "study", "id": "orphan",
                   "title": "Orphan", "source_refs": [], "metadata": {},
                   "device_id": "absent-device", "device_revision": 1,
                   "scientific_question": "Missing parent test", "method": "test",
                   "parameter_set": {}, "status": "draft"}
    study_only["records"] = [{"record_type": "study", "id": "orphan", "revision": 1,
        "record": orphan, "sha256": hashlib.sha256(source.canonical(orphan).encode()).hexdigest(),
        "created_at": "2026-11-26T10:00:00+00:00"}]
    study_only["archive_sha256"] = hashlib.sha256(
        source.canonical({key: value for key, value in study_only.items() if key != "archive_sha256"}).encode()
    ).hexdigest()
    with pytest.raises(ValueError, match="missing device"):
        ProjectRecordStore(tmp_path / "orphan.sqlite").import_project_archive(study_only)


def test_project_archive_api_import_is_atomic_and_hash_checked(client, tmp_path, monkeypatch):
    source_path = tmp_path / "archive-source.sqlite"
    source = ProjectRecordStore(source_path)
    source.save("device", device_record("api-archive-device"), 0)
    archive = source.export_project_archive()
    monkeypatch.setenv("SPINVAULT_PROJECT_RECORDS_DB", str(tmp_path / "archive-target.sqlite"))
    response = client.post("/api/project-records/archive/import", json={"archive": archive})
    assert response.status_code == 200, response.json()
    assert response.json() == {"imported_records": 1, "imported_revisions": 1}
    exported = client.get("/api/project-records/archive")
    assert exported.status_code == 200
    assert exported.json()["archive_sha256"] == archive["archive_sha256"]
    duplicate = client.post("/api/project-records/archive/import", json={"archive": archive})
    assert duplicate.status_code == 409


def test_source_backed_structure_record_preserves_geometry_and_status(tmp_path):
    source = ProjectRecordStore(tmp_path / "source-structures.sqlite")
    saved = source.save("structure", structure_record(), 0)
    restored = ProjectRecordStore(tmp_path / "restored-structures.sqlite")
    restored.import_bundle(source.export_bundle("structure", saved["id"]))
    record = restored.get("structure", saved["id"])
    assert record["record"]["atom_count"] == 2
    assert record["record"]["atoms"][0]["position_angstrom"] == [0.0, 0.0, 0.0]
    assert record["record"]["source_status"] == "PREPARED_NOT_EXECUTED"
    assert record["record"]["transport_validated"] is False


@pytest.mark.parametrize("changes", [
    {"atom_count": 3},
    {"lattice_vectors_angstrom": [[1, 0, 0], [2, 0, 0], [0, 0, 1]]},
    {"atoms": [{"index": 1, "element": "Fe", "species_label": "FeA", "position_angstrom": [0, 0, 0]},
               {"index": 1, "element": "O", "species_label": "O", "position_angstrom": [1, 1, 1]}]},
])
def test_structure_rejects_inconsistent_atom_mapping_or_cell(tmp_path, changes):
    store = ProjectRecordStore(tmp_path / "invalid-structure.sqlite")
    with pytest.raises(ValueError):
        store.save("structure", {**structure_record(), **changes}, 0)


def test_structure_api_supports_list_get_and_export(client, tmp_path, monkeypatch):
    monkeypatch.setenv("SPINVAULT_PROJECT_RECORDS_DB", str(tmp_path / "structure-api.sqlite"))
    saved = client.post("/api/project-records/structure", json={"record": structure_record("api-structure"), "expected_revision": 0})
    assert saved.status_code == 200, saved.json()
    listing = client.get("/api/project-records/structure")
    assert listing.status_code == 200
    assert listing.json()["records"][0]["record"]["source_status"] == "PREPARED_NOT_EXECUTED"
    assert client.get("/api/project-records/structure/api-structure/export").status_code == 200


def test_qe_structure_catalog_conversion_keeps_source_status_and_magnetic_labels():
    catalog = {"schema_version": 1, "id": "qe-small-test", "atom_count": 2,
        "cell_angstrom": [[4,0,0],[0,4,0],[0,0,6]],
        "atoms": [{"index": 1, "species": "FeA", "position_angstrom": [0,0,0]},
                  {"index": 2, "species": "O", "position_angstrom": [1,1,1]}],
        "species_counts": {"FeA": 1, "O": 1}, "initial_spin_parameters": {"FeA": -0.4},
        "magnetic_label": "seed only", "source_input": "qe.in", "source_sha256": "a" * 64,
        "status": "PREPARED_NOT_EXECUTED", "transport_validated": False}
    converted = structure_catalog_to_record(json.dumps(catalog), "qe-small-test.json")
    assert converted["source_status"] == "PREPARED_NOT_EXECUTED"
    assert converted["transport_validated"] is False
    assert converted["atoms"][0]["element"] == "Fe"
    assert converted["atoms"][0]["sublattice"] == "Fe(A)"
    assert converted["atoms"][0]["region"] == "NFO"
    assert converted["initial_spin_by_species"] == {"FeA": -0.4}
    assert any(ref.startswith("catalog_sha256=") for ref in converted["source_refs"])


def test_siesta_candidate_catalog_preserves_regions_atom_seeds_and_source_hashes(tmp_path):
    catalog = {"schema_version": 1, "id": "candidate-152", "atom_count": 2,
        "cell_angstrom": [[5,0,0],[0,5,0],[0,0,20]],
        "atoms": [{"index": 1, "species": "FeCFAS", "position_angstrom": [0,0,0],
                   "region": "left_electrode"},
                  {"index": 2, "species": "FeA", "position_angstrom": [1,1,1],
                   "region": "central_scattering"}],
        "species_counts": {"FeCFAS": 1, "FeA": 1}, "initial_spin_parameters": {},
        "periodic_axes": [True, True, False],
        "initial_spin_by_atom": {"1": 1.2, "2": -4.1},
        "structure_metadata": {"partition": {"left_electrode": [1,1],
                                               "central_scattering": [2,2]}},
        "related_sources": [{"path": "RUN.fdf", "sha256": "b" * 64}],
        "magnetic_label": "input seeds only; candidate is unconverged",
        "source_input": "geometry_152_partitioned.xyz", "source_sha256": "a" * 64,
        "status": "UNCONVERGED_DIAGNOSTIC", "transport_validated": False}
    converted = structure_catalog_to_record(json.dumps(catalog), "152-siesta.json")
    assert converted["atoms"][0]["element"] == "Fe"
    assert converted["atoms"][0]["species_label"] == "FeCFAS"
    assert converted["atoms"][0]["region"] == "left_electrode"
    assert converted["atoms"][1]["region"] == "central_scattering"
    assert converted["metadata"]["initial_spin_by_atom"] == {"1": 1.2, "2": -4.1}
    assert converted["periodic_axes"] == [True, True, False]
    assert converted["metadata"]["structure_metadata"] == catalog["structure_metadata"]
    assert any("RUN.fdf" in ref and "b" * 64 in ref for ref in converted["source_refs"])
    store = ProjectRecordStore(tmp_path / "siesta-structure.sqlite")
    saved = store.save("structure", converted, expected_revision=0)
    loaded = store.get("structure", "candidate-152")
    assert saved["sha256"] == loaded["sha256"]
    assert loaded["record"]["transport_validated"] is False
    assert loaded["record"]["source_status"] == "UNCONVERGED_DIAGNOSTIC"


def test_structure_catalog_api_uses_generic_route_and_never_accepts_transport(client, tmp_path, monkeypatch):
    monkeypatch.setenv("SPINVAULT_PROJECT_RECORDS_DB", str(tmp_path / "catalog-api.sqlite"))
    catalog = {"schema_version": 1, "id": "siesta-api-candidate", "atom_count": 1,
        "cell_angstrom": [[4,0,0],[0,4,0],[0,0,6]],
        "atoms": [{"index": 1, "species": "FeCFAS", "position_angstrom": [0,0,0],
                   "region": "left_electrode"}],
        "species_counts": {"FeCFAS": 1}, "initial_spin_parameters": {},
        "magnetic_label": "input seed only", "source_input": "geometry.xyz",
        "source_sha256": "d" * 64, "status": "PREPARED_NOT_EXECUTED",
        "transport_validated": True}
    response = client.post("/api/project-records/import-structure-catalog", json={
        "catalog_json": json.dumps(catalog), "filename": "siesta-candidate.json"})
    assert response.status_code == 200, response.json()
    assert response.json()["record"]["transport_validated"] is False
    assert response.json()["record"]["atoms"][0]["region"] == "left_electrode"


def test_structure_catalog_rejects_incomplete_or_nonfinite_atom_spin_map():
    catalog = {"schema_version": 1, "id": "bad-spin-map", "atom_count": 1,
        "cell_angstrom": [[4,0,0],[0,4,0],[0,0,6]],
        "atoms": [{"index": 1, "species": "FeCFAS", "position_angstrom": [0,0,0]}],
        "species_counts": {"FeCFAS": 1}, "initial_spin_parameters": {},
        "initial_spin_by_atom": {"1": float("nan")}, "magnetic_label": "seed",
        "source_input": "geometry.xyz", "source_sha256": "c" * 64, "status": "INCOMPLETE"}
    with pytest.raises(ValueError, match="Per-atom initial spin"):
        structure_catalog_to_record(json.dumps(catalog, allow_nan=True), "bad-spin-map.json")


def test_qe_structure_catalog_conversion_rejects_species_count_and_atom_order_errors():
    catalog = {"schema_version": 1, "id": "bad-catalog", "atom_count": 1,
        "cell_angstrom": [[4,0,0],[0,4,0],[0,0,6]],
        "atoms": [{"index": 1, "species": "FeA", "position_angstrom": [0,0,0]}],
        "species_counts": {"O": 1}, "initial_spin_parameters": {},
        "magnetic_label": "seed", "source_sha256": "a" * 64, "status": "INCOMPLETE"}
    with pytest.raises(ValueError, match="species counts"):
        structure_catalog_to_record(json.dumps(catalog), "bad.json")
