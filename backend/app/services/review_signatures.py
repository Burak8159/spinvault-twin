"""Integrity signatures for administrator-controlled local review records.

A signature proves control of the local signing key, not a scientist's identity
or the truth of the reviewed physical claim.
"""
import hashlib
import hmac
import json
from pathlib import Path


def canonical_review(record):
    unsigned={key:value for key,value in record.items() if key!='signature'}
    return json.dumps(unsigned,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def read_key(path):
    with Path(path).open('rb') as stream:key=stream.read(129)
    if not 32<=len(key)<=128:
        raise ValueError('Signing key must contain 32 to 128 bytes')
    return key


def signature(record,key):
    return hmac.new(key,canonical_review(record),hashlib.sha256).hexdigest()


def verify(record,key_path):
    value=record.get('signature')
    if not isinstance(value,str) or len(value)!=64:
        return False
    return hmac.compare_digest(value,signature(record,read_key(key_path)))
