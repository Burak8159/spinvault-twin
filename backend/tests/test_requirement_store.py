import pytest
from app.services.requirement_store import RequirementStore, RevisionConflict

def example():
    return {'id':'P1','metric':'leakage','unit':'A','status':'UNSPECIFIED','target':None,'comparator':None,'source':'','conditions':{}}

def test_reopen_history_and_conflict(tmp_path):
    path=tmp_path/'requirements.sqlite';store=RequirementStore(path)
    req=example();first=store.save(req,0)
    req['source']='updated';second=store.save(req,1)
    assert first['sha256']!=second['sha256']
    reopened=RequirementStore(path)
    assert reopened.get('P1')['revision']==2
    assert reopened.get('P1',1)['requirement']['source']==''
    assert len(reopened.list())==1
    with pytest.raises(RevisionConflict): reopened.save(req,1)
    assert reopened.get('P1')['revision']==2

def test_api_revision_round_trip(client,tmp_path,monkeypatch):
    monkeypatch.setenv('SPINVAULT_REQUIREMENTS_DB',str(tmp_path/'requirements.sqlite'))
    response=client.post('/api/requirements',json={'requirement':example(),'expected_revision':0})
    assert response.status_code==200
    saved=response.json()
    assert saved['revision']==1
    assert client.get('/api/requirements/P1').json()==saved
    assert client.get('/api/requirements/P1?revision=1').json()==saved
    assert client.get('/api/requirements').json()['requirements']==[saved]
    assert client.post('/api/requirements',json={'requirement':example(),'expected_revision':0}).status_code==409

def test_schema_requires_target_evidence(client,tmp_path,monkeypatch):
    monkeypatch.setenv('SPINVAULT_REQUIREMENTS_DB',str(tmp_path/'r.sqlite'))
    req=example();req['status']='SPECIFIED'
    assert client.post('/api/requirements',json={'requirement':req,'expected_revision':0}).status_code==422

def test_bool_is_not_a_numeric_target(client,tmp_path,monkeypatch):
    monkeypatch.setenv('SPINVAULT_REQUIREMENTS_DB',str(tmp_path/'r.sqlite'))
    req=example();req.update(status='SPECIFIED',target=True,comparator='<=',source='fixture',conditions={'temperature_K':300})
    assert client.post('/api/requirements',json={'requirement':req,'expected_revision':0}).status_code==422

def test_saved_evaluation_binds_exact_requirement_revision(client,tmp_path,monkeypatch):
    import json,hashlib
    monkeypatch.setenv('SPINVAULT_REQUIREMENTS_DB',str(tmp_path/'r.sqlite'))
    monkeypatch.setenv('SPINVAULT_REQUIREMENT_EVIDENCE_ROOT',str(tmp_path))
    observation={'metric':'leakage','unit':'A','value':1e-7,'conditions':{'temperature_K':300}}
    artifact=tmp_path/'observation.json';artifact.write_text(json.dumps(observation))
    from app.services.review_signatures import signature
    key=b'fixture-key'*4;keyfile=tmp_path/'key';keyfile.write_bytes(key)
    monkeypatch.setenv('SPINVAULT_EVIDENCE_SIGNING_KEY_FILE',str(keyfile))
    record={'artifact':'observation.json','sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'review':{'status':'QUALIFIED','reviewer':'fixture reviewer','evidence_ref':'test only','scope':'test-only'}}
    record['signature']=signature(record,key)
    (tmp_path/'evidence.json').write_text(json.dumps(record))
    req=example();req.update(status='SPECIFIED',target=1e-6,comparator='<=',source='fixture',conditions={'temperature_K':300})
    first=client.post('/api/requirements',json={'requirement':req,'expected_revision':0}).json()
    req['target']=1e-8
    client.post('/api/requirements',json={'requirement':req,'expected_revision':1})
    a=client.post('/api/requirements/P1/evaluate',json={'revision':1,'evidence_id':'evidence'}).json()
    b=client.post('/api/requirements/P1/evaluate',json={'revision':2,'evidence_id':'evidence'}).json()
    assert a['verdict']=='PASS' and b['verdict']=='FAIL'
    assert a['requirement_sha256']==first['sha256'] and a['requirement_revision']==1

def test_private_requirements_reject_public_browser_origin(client,tmp_path,monkeypatch):
    monkeypatch.setenv('SPINVAULT_REQUIREMENTS_DB',str(tmp_path/'r.sqlite'))
    response=client.get('/api/requirements',headers={'Origin':'https://spinvault.biz'})
    assert response.status_code==403

def test_corrupt_revision_is_detected(tmp_path):
    import sqlite3
    path=tmp_path/'r.sqlite';store=RequirementStore(path);store.save(example(),0)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE requirement_revisions SET content='{}'")
    with pytest.raises(ValueError,match='hash'):store.get('P1')
