import pytest
from app.services.requirement_store import RequirementStore, RevisionConflict

def example():
    return {'id':'P1','metric':'leakage','unit':'A','status':'UNSPECIFIED','target':None,'comparator':None,'source':'','conditions':{}}

def synthetic_cycle_policy():
    return {'runtime_semantics_verified':False,
        'profiles':{'siesta_periodic':{'dD':{'operator':'<','value':1.0,'unit':'arb'},'dH':{'operator':'<=','value':0.5,'unit':'arb'}},
                    'siesta_obc':{'dD':{'operator':'<','value':1.0,'unit':'arb'},'dH':{'operator':'<=','value':0.5,'unit':'arb'},'dQ':{'operator':'abs<','value':0.5,'unit':'arb'}}},
        'gate_requirement_ids':{'dD':'TEST_DENSITY','dH':'TEST_HAMILTONIAN','dQ':'TEST_CHARGE'},
        'gate_metric_names':{'dD':'synthetic density residual','dH':'synthetic Hamiltonian residual','dQ':'synthetic charge deviation'},
        'gate_condition_statements':{'dD':'same completed applicable iteration','dH':'same completed applicable iteration','dQ':'same completed open-boundary iteration'}}

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

def test_cycle_evaluation_requires_one_signed_run_cycle_and_never_accepts_device(client,tmp_path,monkeypatch):
    import json,hashlib
    from app.services.review_signatures import signature
    monkeypatch.setenv('SPINVAULT_REQUIREMENTS_DB',str(tmp_path/'cycle.sqlite'))
    monkeypatch.setenv('SPINVAULT_REQUIREMENT_EVIDENCE_ROOT',str(tmp_path))
    policy=synthetic_cycle_policy()
    policy_file=tmp_path/'policy.json';policy_file.write_text(json.dumps(policy))
    monkeypatch.setenv('SPINVAULT_ACCEPTANCE_POLICY_FILE',str(policy_file))
    key=b'cycle-fixture-key'*2;keyfile=tmp_path/'cycle.key';keyfile.write_bytes(key)
    monkeypatch.setenv('SPINVAULT_EVIDENCE_SIGNING_KEY_FILE',str(keyfile))
    source=tmp_path/'source.log';source.write_text('fixture completed OBC row\n')
    source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    reqspec={
        'TEST_DENSITY':('synthetic density residual','arb',1.0,'<','dD'),
        'TEST_HAMILTONIAN':('synthetic Hamiltonian residual','arb',0.5,'<=','dH'),
        'TEST_CHARGE':('synthetic charge deviation','arb',0.5,'abs<','dQ'),
    }
    evidence=[]
    for rid,(metric,unit,target,comparator,key_name) in reqspec.items():
        statement=policy['gate_condition_statements'][key_name]
        requirement={'id':rid,'metric':metric,'unit':unit,'status':'SPECIFIED','target':target,'comparator':comparator,
            'source':'owner project criterion','conditions':{'criteria_statement':statement}}
        saved=client.post('/api/requirements',json={'requirement':requirement,'expected_revision':0})
        assert saved.status_code==200
        evidence_id=f'cycle-{rid}'
        obs={'metric':metric,'unit':unit,'value':{'dD':.1,'dH':.25,'dQ':.1}[key_name],
            'conditions':{'run_id':'synthetic-run','stage':'obc','cycle':4,'criteria_statement':statement},
            'provenance':{'source_log_file':'source.log','source_log_sha256':source_hash,
                'same_cycle_convergence_announcement':True,'continued_after_announcement':False,'row_line':3}}
        artifact=tmp_path/f'{evidence_id}-artifact.json';artifact.write_text(json.dumps(obs,sort_keys=True))
        record={'artifact':artifact.name,'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),
            'review':{'status':'QUALIFIED','reviewer':'test-reviewer','evidence_ref':'synthetic fixture','scope':'test-only'}}
        record['signature']=signature(record,key)
        (tmp_path/f'{evidence_id}.json').write_text(json.dumps(record))
        evidence.append({'requirement_id':rid,'revision':1,'evidence_id':evidence_id})
    response=client.post('/api/requirements/evaluate-cycle',json={'profile':'siesta_obc','evidence':evidence})
    assert response.status_code==200
    result=response.json()
    assert result['same_run_cycle_and_log_verified'] is True
    assert result['all_review_signatures_verified'] is True
    assert result['scf_convergence_announced_for_cycle'] is True
    assert result['numerical_gate_values_pass'] is True
    assert result['numerical_cycle_criteria_satisfied'] is False
    assert result['runtime_semantics_verified'] is False
    assert result['device_acceptance']=='NOT_EVALUATED' and result['accepted'] is False

def test_cycle_evaluation_rejects_mixed_iterations(client,tmp_path,monkeypatch):
    import json,hashlib
    from app.services.review_signatures import signature
    monkeypatch.setenv('SPINVAULT_REQUIREMENTS_DB',str(tmp_path/'cycle.sqlite'))
    monkeypatch.setenv('SPINVAULT_REQUIREMENT_EVIDENCE_ROOT',str(tmp_path))
    policy=synthetic_cycle_policy()
    policy_path=tmp_path/'policy.json';policy_path.write_text(json.dumps(policy))
    monkeypatch.setenv('SPINVAULT_ACCEPTANCE_POLICY_FILE',str(policy_path))
    key=b'mixed-cycle-fixture-key-material';keyfile=tmp_path/'key';keyfile.write_bytes(key)
    monkeypatch.setenv('SPINVAULT_EVIDENCE_SIGNING_KEY_FILE',str(keyfile))
    source=tmp_path/'source.log';source.write_text('row\n');digest=hashlib.sha256(source.read_bytes()).hexdigest()
    metrics=[('TEST_DENSITY','synthetic density residual','arb',1.0,'<','same completed applicable iteration',.1,15),
             ('TEST_HAMILTONIAN','synthetic Hamiltonian residual','arb',.5,'<=','same completed applicable iteration',.25,14)]
    evidence=[]
    for rid,metric,unit,target,op,statement,value,cycle in metrics:
        requirement={'id':rid,'metric':metric,'unit':unit,'status':'SPECIFIED','target':target,'comparator':op,'source':'owner criterion','conditions':{'criteria_statement':statement}}
        assert client.post('/api/requirements',json={'requirement':requirement,'expected_revision':0}).status_code==200
        eid=f'e-{rid}';obs={'metric':metric,'unit':unit,'value':value,'conditions':{'run_id':'same','stage':'periodic','cycle':cycle,'criteria_statement':statement},'provenance':{'source_log_file':'source.log','source_log_sha256':digest,'same_cycle_convergence_announcement':True,'continued_after_announcement':False}}
        a=tmp_path/f'{eid}-a.json';a.write_text(json.dumps(obs,sort_keys=True));record={'artifact':a.name,'sha256':hashlib.sha256(a.read_bytes()).hexdigest(),'review':{'status':'QUALIFIED','reviewer':'test','evidence_ref':'fixture','scope':'test'}};record['signature']=signature(record,key);(tmp_path/f'{eid}.json').write_text(json.dumps(record))
        evidence.append({'requirement_id':rid,'revision':1,'evidence_id':eid})
    response=client.post('/api/requirements/evaluate-cycle',json={'profile':'siesta_periodic','evidence':evidence})
    assert response.status_code==422 and 'same run, stage, cycle' in response.json()['detail']
