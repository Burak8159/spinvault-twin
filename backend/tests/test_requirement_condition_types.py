from app.physics.requirements import evaluate_requirement

def test_boolean_condition_does_not_match_numeric_condition():
    req={'id':'example','metric':'value','unit':'A','status':'SPECIFIED','target':2,'comparator':'<=','source':'fixture','conditions':{'bias_V':1}}
    obs={'metric':'value','unit':'A','value':1,'conditions':{'bias_V':True},'qualified':True,'source':'fixture'}
    assert evaluate_requirement(req,obs)['verdict']=='NOT_EVALUATED'
