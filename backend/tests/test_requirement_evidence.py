import json, hashlib
import pytest
from app.services.requirement_evidence import evaluate_verified

def test_changed_artifact_and_review_gate(tmp_path,monkeypatch):
    from app.services.review_signatures import signature
    key=b"fixture-key"*4;keyfile=tmp_path/"key";keyfile.write_bytes(key)
    monkeypatch.setenv("SPINVAULT_EVIDENCE_SIGNING_KEY_FILE",str(keyfile))
    obs={'metric':'leakage','unit':'A','value':1e-7,'conditions':{'temperature_K':300}}
    artifact=tmp_path/'observation.json';artifact.write_text(json.dumps(obs))
    record={'artifact':'observation.json','sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'review':{'status':'QUALIFIED','reviewer':'test-fixture-reviewer','evidence_ref':'synthetic test only','scope':'test-only'}}
    record['signature']=signature(record,key)
    p=tmp_path/'example.json';p.write_text(json.dumps(record))
    req={'id':'P1','metric':'leakage','unit':'A','target':1e-6,'comparator':'<=','status':'SPECIFIED','source':'fixture','conditions':{'temperature_K':300}}
    assert evaluate_verified(req,'example',tmp_path)['verdict']=='PASS'
    record['review']['status']='UNREVIEWED';record['signature']=signature(record,key);p.write_text(json.dumps(record))
    assert evaluate_verified(req,'example',tmp_path)['verdict']=='NOT_EVALUATED'
    record['review']['status']='QUALIFIED';p.write_text(json.dumps(record))
    with pytest.raises(ValueError,match='signature'):evaluate_verified(req,'example',tmp_path)
    record['signature']=signature(record,key);p.write_text(json.dumps(record))
    artifact.write_text('{}')
    with pytest.raises(ValueError):evaluate_verified(req,'example',tmp_path)

def test_no_client_supplied_observation(client):
    response=client.post('/api/requirements/evaluate',json={'requirement':{'id':'P1','metric':'leakage','unit':'A','status':'UNSPECIFIED'},'evidence_id':'example'})
    assert response.status_code==503

def test_reject_traversal(tmp_path):
    with pytest.raises(ValueError):evaluate_verified({},'../outside',tmp_path)

def test_oversized_and_nonobject_records(tmp_path):
    from app.services.requirement_evidence import MAX_JSON_BYTES
    path=tmp_path/'example.json'
    for content in ['[]', 'x' * (MAX_JSON_BYTES + 1)]:
        path.write_text(content)
        with pytest.raises(ValueError):evaluate_verified({},'example',tmp_path)

def test_api_rejects_client_qualification(client):
    response=client.post('/api/requirements/evaluate',json={'requirement':{},'evidence_id':'example','qualified':True})
    assert response.status_code==422

def test_unsigned_local_review_cannot_pass(tmp_path,monkeypatch):
    monkeypatch.delenv('SPINVAULT_EVIDENCE_SIGNING_KEY_FILE',raising=False)
    artifact=tmp_path/'observation.json';artifact.write_text(json.dumps({'metric':'leakage','unit':'A','value':1e-7,'conditions':{'temperature_K':300}}))
    (tmp_path/'example.json').write_text(json.dumps({'artifact':'observation.json','sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'review':{'status':'QUALIFIED','reviewer':'unverified','evidence_ref':'unverified'}}))
    req={'id':'P1','metric':'leakage','unit':'A','status':'SPECIFIED','target':1e-6,'comparator':'<=','source':'fixture','conditions':{'temperature_K':300}}
    result=evaluate_verified(req,'example',tmp_path)
    assert result['verdict']=='NOT_EVALUATED' and not result['review_integrity_verified']

def test_source_log_provenance_is_rechecked_after_review(tmp_path,monkeypatch):
    from app.services.review_signatures import signature
    keyfile=tmp_path/'key';keyfile.write_bytes(b'k'*32)
    monkeypatch.setenv('SPINVAULT_EVIDENCE_SIGNING_KEY_FILE',str(keyfile))
    source=tmp_path/'source.log';source.write_bytes(b'completed solver row\n')
    observation={'metric':'SIESTA dD','unit':'dimensionless','value':0.00001,
        'conditions':{'run_id':'r1','stage':'periodic','cycle':7},
        'provenance':{'source_log_file':'source.log','source_log_sha256':hashlib.sha256(source.read_bytes()).hexdigest()}}
    artifact=tmp_path/'observation.json';artifact.write_text(json.dumps(observation))
    record={'artifact':'observation.json','sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),
        'review':{'status':'QUALIFIED','reviewer':'test-reviewer','evidence_ref':'fixture','scope':'numerical-log-review'}}
    record['signature']=signature(record,b'k'*32)
    (tmp_path/'example.json').write_text(json.dumps(record))
    req={'id':'N01','metric':'SIESTA dD','unit':'dimensionless','target':1e-4,'comparator':'<','status':'SPECIFIED','source':'fixture',
        'conditions':{'run_id':'r1','stage':'periodic','cycle':7}}
    assert evaluate_verified(req,'example',tmp_path)['verdict']=='PASS'
    source.write_text('changed after sign-off\n')
    with pytest.raises(ValueError,match='Source log checksum'):
        evaluate_verified(req,'example',tmp_path)

def test_source_log_path_cannot_escape_evidence_root(tmp_path):
    from app.services.requirement_evidence import _verify_source_log
    with pytest.raises(ValueError,match='escapes'):
        _verify_source_log(tmp_path.resolve(),{'source_log_file':'../outside.log','source_log_sha256':'0'*64})
