"""Resolve a comparison against controlled local evidence records."""
import hashlib
import json
from pathlib import Path
from app.physics.requirements import evaluate_requirement

MAX_JSON_BYTES = 1024 * 1024

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
    observation['qualified'] = review.get('status') == 'QUALIFIED' and bool(review.get('reviewer')) and bool(review.get('evidence_ref'))
    observation['source'] = 'sha256:' + digest
    result = evaluate_requirement(requirement, observation)
    return {**result, 'evidence_id': evidence_id, 'artifact_sha256': digest,
            'reviewer': review.get('reviewer'), 'review_evidence_ref': review.get('evidence_ref')}
