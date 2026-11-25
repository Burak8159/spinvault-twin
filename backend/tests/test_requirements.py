from app.physics.requirements import evaluate_requirement


def sample():
    requirement = {'id':'P06', 'metric':'leakage', 'unit':'A', 'target':1e-6,
        'status':'SPECIFIED', 'comparator':'<=', 'source':'test fixture',
        'conditions':{'temperature_K':300, 'bias_V':0.1}}
    observation = {'metric':'leakage', 'unit':'A', 'value':5e-7,
        'conditions':{'temperature_K':300, 'bias_V':0.1},
        'qualified':True, 'source':'test fixture observation'}
    return requirement, observation


def test_matching_qualified_observation():
    req, obs = sample()
    assert evaluate_requirement(req,obs)['verdict'] == 'PASS'
    obs['value'] = 2e-6
    assert evaluate_requirement(req,obs)['verdict'] == 'FAIL'


def test_unspecified_requirement_is_not_a_pass():
    req, obs = sample(); req.update(status='UNSPECIFIED', target=None)
    assert evaluate_requirement(req,obs)['verdict'] == 'NOT_EVALUATED'


def test_wrong_conditions_units_or_evidence_cannot_pass():
    for key, value in [('unit','mA'),('conditions',{'temperature_K':350,'bias_V':0.1}),
                       ('qualified',False),('source',''),('value',float('nan'))]:
        req, obs = sample(); obs[key] = value
        assert evaluate_requirement(req,obs)['verdict'] == 'NOT_EVALUATED'


def test_boundary_and_identity():
    req, obs = sample(); obs['value'] = req['target']; req['comparator'] = '<'
    assert evaluate_requirement(req,obs)['verdict'] == 'FAIL'
    req['comparator'] = '<='
    assert evaluate_requirement(req,obs)['verdict'] == 'PASS'
    del req['id']
    assert evaluate_requirement(req,obs)['verdict'] == 'NOT_EVALUATED'


def test_uncertainty_crossing_target_does_not_false_pass():
    req, obs = sample(); obs.update(value=9e-7,uncertainty=2e-7)
    assert evaluate_requirement(req,obs)['verdict']=='NOT_EVALUATED'
    obs.update(value=5e-7,uncertainty=1e-7)
    assert evaluate_requirement(req,obs)['verdict']=='PASS'
    obs.update(value=2e-6,uncertainty=1e-7)
    assert evaluate_requirement(req,obs)['verdict']=='FAIL'


def test_invalid_uncertainty_rejected():
    req, obs=sample();obs['uncertainty']=-1
    assert evaluate_requirement(req,obs)['verdict']=='NOT_EVALUATED'
