"""Transactional append-only storage and bounded JSON round-trip for device/study records."""
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

    def save(self, record_type, payload, expected_revision):
        if record_type not in RECORD_MODELS:
            raise ValueError("Unsupported project record type")
        record = RECORD_MODELS[record_type].model_validate(payload).model_dump(mode="json")
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
        body = {"package_schema_version": "1.0", "package_type": "study_with_device_revision",
                "device": {"source_revision": device["revision"], "record": device["record"], "record_sha256": device["sha256"]},
                "study": {"source_revision": study["revision"], "record": study["record"], "record_sha256": study["sha256"]}}
        body["package_sha256"] = hashlib.sha256(self.canonical(body).encode("utf-8")).hexdigest()
        return body

    def import_study_package(self, package):
        if not isinstance(package, dict) or package.get("package_schema_version") != "1.0" or package.get("package_type") != "study_with_device_revision":
            raise ValueError("Unsupported study package")
        supplied_hash = package.get("package_sha256")
        body = {key: value for key, value in package.items() if key != "package_sha256"}
        if not isinstance(supplied_hash, str) or hashlib.sha256(self.canonical(body).encode("utf-8")).hexdigest() != supplied_hash:
            raise ValueError("Study package integrity check failed")
        records = {}
        for kind in ("device", "study"):
            item = package.get(kind)
            if not isinstance(item, dict):
                raise ValueError(f"Study package is missing its {kind} revision")
            source_revision = item.get("source_revision")
            if not isinstance(source_revision, int) or isinstance(source_revision, bool) or source_revision < 1:
                raise ValueError(f"Study package has an invalid {kind} revision")
            record = json.loads(self.canonical(RECORD_MODELS[kind].model_validate(item.get("record")).model_dump(mode="json")))
            digest = hashlib.sha256(self.canonical(record).encode("utf-8")).hexdigest()
            if digest != item.get("record_sha256"):
                raise ValueError(f"Study package {kind} hash mismatch")
            records[kind] = (source_revision, record, digest)
        device_revision, device, _ = records["device"]
        study_revision, study, _ = records["study"]
        if study["device_id"] != device["id"] or study["device_revision"] != device_revision:
            raise ValueError("Study package does not contain the exact parent device revision")
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
        canonical_payload = self.canonical(RECORD_MODELS[record_type].model_validate(payload).model_dump(mode="json"))
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
            created = datetime.now(timezone.utc).isoformat()
            db.execute("INSERT INTO project_record_revisions VALUES(?,?,?,?,?,?)",
                       (record_type, record["id"], source_revision, canonical_payload,
                        hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest(), created))
        return self.get(record_type, record["id"], source_revision)
