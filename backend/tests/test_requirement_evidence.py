import json, hashlib
import pytest
from app.services.requirement_evidence import evaluate_verified

def test_changed_artifact_and_review_gate(tmp_path):
    obs={'metric':'leakage','unit':'A','value':1e-7,'conditions':{'temperature_K':300}}
    artifact=tmp_path/'observation.json';artifact.write_text(json.dumps(obs))
    record={'artifact':'observation.json','sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'review':{'status':'QUALIFIED','reviewer':'test-fixture-reviewer','evidence_ref':'synthetic test only'}}
    p=tmp_path/'example.json';p.write_text(json.dumps(record))
    req={'id':'P1','metric':'leakage','unit':'A','target':1e-6,'comparator':'<=','status':'SPECIFIED','source':'fixture','conditions':{'temperature_K':300}}
    assert evaluate_verified(req,'example',tmp_path)['verdict']=='PASS'
    record['review']['status']='UNREVIEWED';p.write_text(json.dumps(record))
    assert evaluate_verified(req,'example',tmp_path)['verdict']=='NOT_EVALUATED'
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
