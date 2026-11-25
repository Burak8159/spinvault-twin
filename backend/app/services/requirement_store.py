"""Versioned local requirements with optimistic concurrency and atomic commits."""
from __future__ import annotations
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

class RevisionConflict(ValueError):
    pass

class RequirementStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS requirement_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(id,revision))')
    def connect(self):
        return sqlite3.connect(str(self.path), timeout=10)
    @staticmethod
    def record(row):
        return {'id':row[0], 'revision':row[1], 'requirement':json.loads(row[2]), 'sha256':row[3], 'created_at':row[4]}
    def save(self, requirement, expected_revision):
        content=json.dumps(requirement, sort_keys=True, separators=(',', ':'), allow_nan=False)
        digest=hashlib.sha256(content.encode()).hexdigest()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            latest=db.execute('SELECT MAX(revision) FROM requirement_revisions WHERE id=?', (requirement['id'],)).fetchone()[0] or 0
            if latest != expected_revision:
                raise RevisionConflict('Requirement changed; reload before saving')
            revision=latest+1
            created=datetime.now(timezone.utc).isoformat()
            db.execute('INSERT INTO requirement_revisions VALUES(?,?,?,?,?)',(requirement['id'],revision,content,digest,created))
        return self.get(requirement['id'],revision)
    def get(self, identifier, revision=None):
        with self.connect() as db:
            if revision is None:
                row=db.execute('SELECT * FROM requirement_revisions WHERE id=? ORDER BY revision DESC LIMIT 1',(identifier,)).fetchone()
            else:
                row=db.execute('SELECT * FROM requirement_revisions WHERE id=? AND revision=?',(identifier,revision)).fetchone()
        return self.record(row) if row else None
    def list(self):
        with self.connect() as db:
            rows=db.execute('SELECT r.* FROM requirement_revisions r JOIN (SELECT id,MAX(revision) revision FROM requirement_revisions GROUP BY id) latest ON r.id=latest.id AND r.revision=latest.revision ORDER BY r.id').fetchall()
        return [self.record(row) for row in rows]
