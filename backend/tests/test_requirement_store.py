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
