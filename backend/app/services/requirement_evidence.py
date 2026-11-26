"""Resolve a comparison against controlled local evidence records."""
import hashlib
import json
import os
from app.services.review_signatures import verify
from pathlib import Path
from app.physics.requirements import evaluate_requirement

MAX_JSON_BYTES = 1024 * 1024
MAX_SOURCE_LOG_BYTES = 512 * 1024 * 1024

def _verify_source_log(root, provenance):
    if not isinstance(provenance, dict):
        return
    relative = provenance.get('source_log_file')
    expected = provenance.get('source_log_sha256')
    if relative is None and expected is None:
        return
    if not isinstance(relative, str) or not isinstance(expected, str) or len(expected) != 64:
        raise ValueError('Incomplete source-log provenance')
    source = (root / relative).resolve()
    if not source.is_relative_to(root) or not source.is_file():
        raise ValueError('Source log escapes evidence storage or is unavailable')
    if source.stat().st_size > MAX_SOURCE_LOG_BYTES:
        raise ValueError('Source log exceeds size limit')
    hasher = hashlib.sha256()
    with source.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    if hasher.hexdigest() != expected:
        raise ValueError('Source log checksum mismatch')

def read_json(path):
    with path.open('rb') as stream:
        data = stream.read(MAX_JSON_BYTES + 1)
    if len(data) > MAX_JSON_BYTES:
        raise ValueError('Evidence JSON exceeds size limit')
    value = json.loads(data)
    if not isinstance(value, dict):
        raise ValueError('Expected an evidence object')
    return value, data


def evaluate_verified(requirement, evidence_id, root):
    if not evidence_id or len(evidence_id) > 128 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in evidence_id):
        raise ValueError('Invalid evidence identifier')
    root = Path(root).resolve()
    record_path = (root / (evidence_id + '.json')).resolve()
    if not record_path.is_relative_to(root):
        raise ValueError('Evidence path escapes configured storage')
    record, _ = read_json(record_path)
    review = record.get('review')
    if not isinstance(review, dict) or not isinstance(record.get('artifact'), str):
        raise ValueError('Invalid evidence record')
    artifact = (root / record['artifact']).resolve()
    if not artifact.is_relative_to(root) or not artifact.is_file():
        raise ValueError('Evidence artifact unavailable')
    observation, data = read_json(artifact)
    digest = hashlib.sha256(data).hexdigest()
    if digest != record.get('sha256'):
        raise ValueError('Evidence artifact checksum mismatch')
    _verify_source_log(root, observation.get('provenance'))
    key_path=os.environ.get('SPINVAULT_EVIDENCE_SIGNING_KEY_FILE')
    authenticated=bool(key_path) and verify(record,key_path)
    if key_path and not authenticated:
        raise ValueError('Review signature missing or invalid')
    observation['qualified'] = authenticated and review.get('status') == 'QUALIFIED' and isinstance(review.get('reviewer'),str) and bool(review['reviewer'].strip()) and isinstance(review.get('evidence_ref'),str) and bool(review['evidence_ref'].strip()) and isinstance(review.get('scope'),str) and bool(review['scope'].strip())
    observation['source'] = 'sha256:' + digest
    result = evaluate_requirement(requirement, observation)
    return {**result, 'evidence_id': evidence_id, 'artifact_sha256': digest,
            'review_integrity_verified': authenticated, 'review_scope':review.get('scope','unspecified'), 'reviewer': review.get('reviewer'), 'review_evidence_ref': review.get('evidence_ref')}
