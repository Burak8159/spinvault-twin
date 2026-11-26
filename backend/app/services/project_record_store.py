"""Transactional append-only storage and bounded JSON round-trip for project records."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.models.project_records import RECORD_MODELS


class ProjectRecordConflict(ValueError):
    pass


class ProjectRecordStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
            current = db.execute("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").fetchone()[0]
            if current < 1:
                db.execute("BEGIN IMMEDIATE")
                db.execute("CREATE TABLE IF NOT EXISTS project_record_revisions (record_type TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(record_type,id,revision))")
                db.execute("INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)", (datetime.now(timezone.utc).isoformat(),))

    def connect(self):
        connection = sqlite3.connect(str(self.path), timeout=15)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def canonical(payload):
        return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)

    @classmethod
    def record(cls, row):
        if hashlib.sha256(row["content"].encode("utf-8")).hexdigest() != row["sha256"]:
            raise ValueError("Stored project record failed its content hash check")
        return {"record_type": row["record_type"], "id": row["id"], "revision": row["revision"],
                "record": json.loads(row["content"]), "sha256": row["sha256"], "created_at": row["created_at"]}

    @staticmethod
    def normalize_record(record_type, payload):
        """Validate a record while preserving old v1 study hashes when links were absent."""
        model = RECORD_MODELS[record_type].model_validate(payload)
        record = model.model_dump(mode="json")
        if record_type == "study":
            for field in ("structure_id", "structure_revision"):
                if field not in payload:
                    record.pop(field, None)
        return record

    def save(self, record_type, payload, expected_revision):
        if record_type not in RECORD_MODELS:
            raise ValueError("Unsupported project record type")
        record = self.normalize_record(record_type, payload)
        if record["record_type"] != record_type:
            raise ValueError("Record type does not match the requested collection")
        content = self.canonical(record)
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            latest = db.execute("SELECT MAX(revision) FROM project_record_revisions WHERE record_type=? AND id=?",
                                (record_type, record["id"])).fetchone()[0] or 0
            if latest != expected_revision:
                raise ProjectRecordConflict("Project record changed; reload before saving")
            if record_type == "study":
                parent = db.execute("SELECT 1 FROM project_record_revisions WHERE record_type='device' AND id=? AND revision=?",
                                    (record["device_id"], record["device_revision"])).fetchone()
                if parent is None:
                    raise ValueError("Study must reference an existing immutable device revision")
                if record.get("structure_id") is not None:
                    structure = db.execute("SELECT 1 FROM project_record_revisions WHERE record_type='structure' AND id=? AND revision=?",
                                           (record["structure_id"], record["structure_revision"])).fetchone()
                    if structure is None:
                        raise ValueError("Study must reference an existing immutable structure revision")
            revision = latest + 1
            created = datetime.now(timezone.utc).isoformat()
            db.execute("INSERT INTO project_record_revisions VALUES(?,?,?,?,?,?)",
                       (record_type, record["id"], revision, content, digest, created))
        return self.get(record_type, record["id"], revision)

    def get(self, record_type, identifier, revision=None):
        with self.connect() as db:
            if revision is None:
                row = db.execute("SELECT * FROM project_record_revisions WHERE record_type=? AND id=? ORDER BY revision DESC LIMIT 1",
                                 (record_type, identifier)).fetchone()
            else:
                row = db.execute("SELECT * FROM project_record_revisions WHERE record_type=? AND id=? AND revision=?",
                                 (record_type, identifier, revision)).fetchone()
        return self.record(row) if row else None

    def list(self, record_type):
        with self.connect() as db:
            rows = db.execute("SELECT r.* FROM project_record_revisions r JOIN (SELECT record_type,id,MAX(revision) revision FROM project_record_revisions WHERE record_type=? GROUP BY record_type,id) latest ON r.record_type=latest.record_type AND r.id=latest.id AND r.revision=latest.revision ORDER BY r.id",
                               (record_type,)).fetchall()
        return [self.record(row) for row in rows]

    def export_bundle(self, record_type, identifier, revision=None):
        record = self.get(record_type, identifier, revision)
        if record is None:
            return None
        body = {"bundle_schema_version": "1.0", "record_type": record_type,
                "source_revision": record["revision"], "record": record["record"],
                "record_sha256": record["sha256"]}
        body["bundle_sha256"] = hashlib.sha256(self.canonical(body).encode("utf-8")).hexdigest()
        return body

    def export_study_package(self, identifier, revision=None):
        study = self.get("study", identifier, revision)
        if study is None:
            return None
        device = self.get("device", study["record"]["device_id"], study["record"]["device_revision"])
        if device is None:
            raise ValueError("Study's exact device revision is unavailable")
        package_type = "study_with_device_revision"
        body = {"package_schema_version": "1.0", "package_type": package_type,
                "device": {"source_revision": device["revision"], "record": device["record"], "record_sha256": device["sha256"]},
                "study": {"source_revision": study["revision"], "record": study["record"], "record_sha256": study["sha256"]}}
        if study["record"].get("structure_id") is not None:
            structure = self.get("structure", study["record"]["structure_id"], study["record"]["structure_revision"])
            if structure is None:
                raise ValueError("Study's exact structure revision is unavailable")
            body["package_type"] = "study_with_device_and_structure"
            body["structure"] = {"source_revision": structure["revision"], "record": structure["record"],
                                  "record_sha256": structure["sha256"]}
        body["package_sha256"] = hashlib.sha256(self.canonical(body).encode("utf-8")).hexdigest()
        return body

    def export_project_archive(self):
        """Export all project-record revisions as one content-hashed JSON archive."""
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM project_record_revisions ORDER BY record_type,id,revision"
            ).fetchall()
        if len(rows) > 5000:
            raise ValueError("Project archive exceeds the 5,000 revision limit")
        records = [self.record(row) for row in rows]
        body = {
            "archive_schema_version": "1.0",
            "archive_type": "project_records",
            "records": records,
        }
        body["archive_sha256"] = hashlib.sha256(self.canonical(body).encode("utf-8")).hexdigest()
        if len(self.canonical(body).encode("utf-8")) > 12 * 1024 * 1024:
            raise ValueError("Project archive exceeds the 12 MiB limit")
        return body

    def import_project_archive(self, archive):
        """Atomically import previously unseen record IDs and all their revisions."""
        if (not isinstance(archive, dict) or archive.get("archive_schema_version") != "1.0"
                or archive.get("archive_type") != "project_records"):
            raise ValueError("Unsupported project archive")
        supplied_hash = archive.get("archive_sha256")
        body = {key: value for key, value in archive.items() if key != "archive_sha256"}
        if (not isinstance(supplied_hash, str)
                or hashlib.sha256(self.canonical(body).encode("utf-8")).hexdigest() != supplied_hash):
            raise ValueError("Project archive integrity check failed")
        entries = archive.get("records")
        if not isinstance(entries, list) or len(entries) > 5000:
            raise ValueError("Project archive has an invalid record list")
        prepared = []
        seen = set()
        revisions_by_id = {}
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("Project archive contains an invalid record entry")
            kind = entry.get("record_type")
            if kind not in RECORD_MODELS:
                raise ValueError("Project archive contains an unsupported record type")
            revision = entry.get("revision")
            if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
                raise ValueError("Project archive contains an invalid revision number")
            record = self.normalize_record(kind, entry.get("record"))
            if record["record_type"] != kind:
                raise ValueError("Project archive record type does not match its content")
            key = (kind, record["id"], revision)
            if key in seen:
                raise ValueError("Project archive contains a duplicate revision")
            seen.add(key)
            digest = hashlib.sha256(self.canonical(record).encode("utf-8")).hexdigest()
            if digest != entry.get("sha256"):
                raise ValueError("Project archive record hash mismatch")
            created_at = entry.get("created_at")
            if not isinstance(created_at, str) or len(created_at) > 64:
                raise ValueError("Project archive contains an invalid creation timestamp")
            try:
                datetime.fromisoformat(created_at)
            except ValueError as error:
                raise ValueError("Project archive contains an invalid creation timestamp") from error
            prepared.append((kind, record["id"], revision, self.canonical(record), digest, created_at))
            revisions_by_id.setdefault((kind, record["id"]), set()).add(revision)

        for (kind, identifier), revisions in revisions_by_id.items():
            if revisions != set(range(1, max(revisions) + 1)):
                raise ValueError(f"Project archive has a revision gap for {kind} {identifier}")
        packaged_devices = {
            (identifier, revision) for kind, identifier, revision, *_ in prepared if kind == "device"
        }
        packaged_structures = {
            (identifier, revision) for kind, identifier, revision, *_ in prepared if kind == "structure"
        }
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for kind, identifier in revisions_by_id:
                if db.execute(
                    "SELECT 1 FROM project_record_revisions WHERE record_type=? AND id=? LIMIT 1",
                    (kind, identifier),
                ).fetchone():
                    raise ProjectRecordConflict(
                        f"Project archive {kind} ID {identifier} already exists; nothing was imported"
                    )
            existing_devices = {
                (row[0], row[1]) for row in db.execute(
                    "SELECT id,revision FROM project_record_revisions WHERE record_type='device'"
                )
            }
            existing_structures = {
                (row[0], row[1]) for row in db.execute(
                    "SELECT id,revision FROM project_record_revisions WHERE record_type='structure'"
                )
            }
            for kind, _identifier, _revision, content, _digest, _created_at in prepared:
                if kind == "study":
                    study = json.loads(content)
                    parent = (study["device_id"], study["device_revision"])
                    if parent not in packaged_devices and parent not in existing_devices:
                        raise ValueError("Project archive study references a missing device revision")
                    if study.get("structure_id") is not None:
                        structure_parent = (study["structure_id"], study["structure_revision"])
                        if structure_parent not in packaged_structures and structure_parent not in existing_structures:
                            raise ValueError("Project archive study references a missing structure revision")
            db.executemany(
                "INSERT INTO project_record_revisions VALUES(?,?,?,?,?,?)",
                [(kind, identifier, revision, content, digest, created_at)
                 for kind, identifier, revision, content, digest, created_at in prepared],
            )
        return {"imported_records": len(revisions_by_id), "imported_revisions": len(prepared)}

    def import_study_package(self, package):
        if (not isinstance(package, dict) or package.get("package_schema_version") != "1.0"
                or package.get("package_type") not in {"study_with_device_revision", "study_with_device_and_structure"}):
            raise ValueError("Unsupported study package")
        supplied_hash = package.get("package_sha256")
        body = {key: value for key, value in package.items() if key != "package_sha256"}
        if not isinstance(supplied_hash, str) or hashlib.sha256(self.canonical(body).encode("utf-8")).hexdigest() != supplied_hash:
            raise ValueError("Study package integrity check failed")
        records = {}
        kinds = ("device", "study", "structure") if package["package_type"] == "study_with_device_and_structure" else ("device", "study")
        for kind in kinds:
            item = package.get(kind)
            if not isinstance(item, dict):
                raise ValueError(f"Study package is missing its {kind} revision")
            source_revision = item.get("source_revision")
            if not isinstance(source_revision, int) or isinstance(source_revision, bool) or source_revision < 1:
                raise ValueError(f"Study package has an invalid {kind} revision")
            record = self.normalize_record(kind, item.get("record"))
            record = json.loads(self.canonical(record))
            digest = hashlib.sha256(self.canonical(record).encode("utf-8")).hexdigest()
            if digest != item.get("record_sha256"):
                raise ValueError(f"Study package {kind} hash mismatch")
            records[kind] = (source_revision, record, digest)
        device_revision, device, _ = records["device"]
        study_revision, study, _ = records["study"]
        if study["device_id"] != device["id"] or study["device_revision"] != device_revision:
            raise ValueError("Study package does not contain the exact parent device revision")
        if study.get("structure_id") is not None:
            if "structure" in records:
                structure_revision, structure, _ = records["structure"]
                if study["structure_id"] != structure["id"] or study["structure_revision"] != structure_revision:
                    raise ValueError("Study package does not contain the exact linked structure revision")
            else:
                with self.connect() as db:
                    exists = db.execute("SELECT 1 FROM project_record_revisions WHERE record_type='structure' AND id=? AND revision=?",
                                        (study["structure_id"], study["structure_revision"])).fetchone()
                if exists is None:
                    raise ValueError("Study package requires its exact structure revision")
        elif "structure" in records:
            raise ValueError("Study package includes an unlinked structure revision")
        created = datetime.now(timezone.utc).isoformat()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for kind, (_, record, _) in records.items():
                exists = db.execute("SELECT 1 FROM project_record_revisions WHERE record_type=? AND id=? LIMIT 1",
                                    (kind, record["id"])).fetchone()
                if exists:
                    raise ProjectRecordConflict(f"Study package {kind} ID already exists; nothing was imported")
            for kind, (source_revision, record, digest) in records.items():
                db.execute("INSERT INTO project_record_revisions VALUES(?,?,?,?,?,?)",
                           (kind, record["id"], source_revision, self.canonical(record), digest, created))
        return self.get("study", study["id"], study_revision)

    def import_bundle(self, bundle):
        if not isinstance(bundle, dict) or bundle.get("bundle_schema_version") != "1.0":
            raise ValueError("Unsupported project-record bundle schema")
        supplied_hash = bundle.get("bundle_sha256")
        body = {key: value for key, value in bundle.items() if key != "bundle_sha256"}
        if not isinstance(supplied_hash, str) or hashlib.sha256(self.canonical(body).encode("utf-8")).hexdigest() != supplied_hash:
            raise ValueError("Project-record bundle integrity check failed")
        record_type = bundle.get("record_type")
        payload = bundle.get("record")
        if record_type not in RECORD_MODELS or not isinstance(payload, dict):
            raise ValueError("Invalid project-record bundle contents")
        source_revision = bundle.get("source_revision")
        if not isinstance(source_revision, int) or isinstance(source_revision, bool) or source_revision < 1:
            raise ValueError("Project-record bundle has an invalid source revision")
        canonical_payload = self.canonical(self.normalize_record(record_type, payload))
        if hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest() != bundle.get("record_sha256"):
            raise ValueError("Project-record content hash mismatch")
        record = json.loads(canonical_payload)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            exists = db.execute("SELECT 1 FROM project_record_revisions WHERE record_type=? AND id=? LIMIT 1",
                                 (record_type, record["id"])).fetchone()
            if exists:
                raise ProjectRecordConflict("Import would collide with an existing record; no data was overwritten")
            if record_type == "study":
                parent = db.execute("SELECT 1 FROM project_record_revisions WHERE record_type='device' AND id=? AND revision=?",
                                    (record["device_id"], record["device_revision"])).fetchone()
                if parent is None:
                    raise ValueError("Study bundle requires its exact device revision to be imported first")
                if record.get("structure_id") is not None:
                    structure = db.execute("SELECT 1 FROM project_record_revisions WHERE record_type='structure' AND id=? AND revision=?",
                                           (record["structure_id"], record["structure_revision"])).fetchone()
                    if structure is None:
                        raise ValueError("Study bundle requires its exact structure revision to be imported first")
            created = datetime.now(timezone.utc).isoformat()
            db.execute("INSERT INTO project_record_revisions VALUES(?,?,?,?,?,?)",
                       (record_type, record["id"], source_revision, canonical_payload,
                        hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest(), created))
        return self.get(record_type, record["id"], source_revision)
