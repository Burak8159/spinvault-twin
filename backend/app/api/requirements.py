"""Requirements revisions and explicitly configured evidence evaluation."""
import os
import re
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, HTTPException, Depends, Request
from urllib.parse import urlsplit
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.services.requirement_evidence import evaluate_verified, read_json
from app.services.requirement_store import RequirementStore, RevisionConflict
from app.config import get_settings

def require_local_browser(request: Request):
    origin=request.headers.get('origin')
    if origin:
        try:
            parsed=urlsplit(origin)
        except ValueError:
            raise HTTPException(403,'Invalid browser origin')
        if parsed.scheme not in ('http','https') or parsed.hostname not in ('localhost','127.0.0.1','::1'):
            raise HTTPException(403,'Requirements workspace is available only to local browser origins')

router = APIRouter(dependencies=[Depends(require_local_browser)])
class Requirement(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False, str_strip_whitespace=True)
    id: str = Field(min_length=1,max_length=128,pattern=r'^[A-Za-z0-9_-]+$')
    metric: str = Field(min_length=1,max_length=256)
    unit: str = Field(min_length=1,max_length=64)
    status: Literal['SPECIFIED','UNSPECIFIED']
    target: float | None = Field(default=None, strict=True)
    comparator: Literal['<','<=','==','>=','>','abs<'] | None = None
    source: str = Field(default='',max_length=2000)
    conditions: dict = Field(default_factory=dict)
    @model_validator(mode='after')
    def check_target(self):
        import json
        if len(json.dumps(self.conditions,allow_nan=False)) > 32768:
            raise ValueError('Operating conditions exceed size limit')
        if self.status=='SPECIFIED' and (self.target is None or self.comparator is None or not self.source.strip() or self.source.strip() == 'UNSPECIFIED' or not self.conditions):
            raise ValueError('Specified requirements need target, comparison, source and conditions')
        if self.status=='UNSPECIFIED' and (self.target is not None or self.comparator is not None):
            raise ValueError('Unspecified requirements must have null target and comparator')
        return self

class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requirement: Requirement
    evidence_id: str = Field(min_length=1,max_length=128)

class SaveRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requirement: Requirement
    expected_revision: int = Field(ge=0)

def store():
    path=os.environ.get('SPINVAULT_REQUIREMENTS_DB') or get_settings().requirements_db
    return RequirementStore(Path(path))

@router.get('/requirements')
def list_requirements():
    return {'requirements':store().list()}

@router.get('/requirements/{identifier}')
def get_requirement(identifier: str, revision: int | None = None):
    result=store().get(identifier,revision)
    if result is None: raise HTTPException(404,'Requirement revision unavailable')
    return result

@router.post('/requirements')
def save_requirement(request: SaveRequest):
    try:
        return store().save(request.requirement.model_dump(),request.expected_revision)
    except RevisionConflict as error:
        raise HTTPException(409,str(error))

@router.post('/requirements/evaluate')
def evaluate(request: EvaluationRequest):
    root=os.environ.get('SPINVAULT_REQUIREMENT_EVIDENCE_ROOT')
    if not root: raise HTTPException(503,'Reviewed evidence storage is not configured')
    try:
        return evaluate_verified(request.requirement.model_dump(),request.evidence_id,root)
    except FileNotFoundError:
        raise HTTPException(404,'Evidence unavailable')
    except (ValueError,KeyError,TypeError,UnicodeError):
        raise HTTPException(422,'Evidence is invalid, changed or incomplete')

class SavedEvaluationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=1)
    evidence_id: str = Field(min_length=1,max_length=128)

@router.post('/requirements/{identifier}/evaluate')
def evaluate_saved(identifier: str, request: SavedEvaluationRequest):
    record=store().get(identifier,request.revision)
    if record is None: raise HTTPException(404,'Requirement revision unavailable')
    result=evaluate(EvaluationRequest(requirement=Requirement(**record['requirement']),evidence_id=request.evidence_id))
    return {**result,'requirement_revision':record['revision'],'requirement_sha256':record['sha256']}

class CycleEvidenceRef(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requirement_id: str = Field(min_length=1,max_length=128,pattern=r'^[A-Za-z0-9_-]+$')
    revision: int = Field(ge=1)
    evidence_id: str = Field(min_length=1,max_length=128)

class CycleEvaluationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    profile: Literal['siesta_periodic','siesta_obc']
    evidence: list[CycleEvidenceRef] = Field(min_length=2,max_length=3)

def acceptance_policy():
    path=os.environ.get('SPINVAULT_ACCEPTANCE_POLICY_FILE')
    if not path:
        raise HTTPException(503,'Project acceptance policy is not configured')
    try:
        policy,_=read_json(Path(path))
    except (OSError,ValueError,KeyError,TypeError):
        raise HTTPException(503,'Project acceptance policy is unavailable or invalid')
    if not isinstance(policy.get('profiles'),dict) or not isinstance(policy.get('gate_requirement_ids'),dict):
        raise HTTPException(503,'Project acceptance policy is incomplete')
    return policy

@router.post('/requirements/evaluate-cycle')
def evaluate_cycle(request: CycleEvaluationRequest):
    evidence_root=os.environ.get('SPINVAULT_REQUIREMENT_EVIDENCE_ROOT')
    if not evidence_root:
        raise HTTPException(503,'Reviewed evidence storage is not configured')
    policy=acceptance_policy()
    profile=policy['profiles'].get(request.profile)
    if not isinstance(profile,dict):
        raise HTTPException(503,'Selected acceptance profile is unavailable')
    gate_ids=policy.get('gate_requirement_ids',{})
    metric_names=policy.get('gate_metric_names',{})
    conditions_expected=policy.get('gate_condition_statements',{})
    expected_keys=set(profile)
    if expected_keys not in ({'dD','dH'},{'dD','dH','dQ'}):
        raise HTTPException(503,'Acceptance profile has unsupported gates')
    by_id={item.requirement_id:item for item in request.evidence}
    expected_ids={gate_ids.get(key) for key in expected_keys}
    if len(by_id)!=len(request.evidence) or set(by_id)!=expected_ids:
        raise HTTPException(422,'Provide exactly one saved requirement revision and evidence record for every profile gate')
    expected_stage='obc' if request.profile=='siesta_obc' else 'periodic'
    observed=[];results={};run_identity=None;source_hash=None
    for key in ('dD','dH','dQ'):
        if key not in expected_keys:continue
        item=by_id[gate_ids[key]]
        saved=store().get(item.requirement_id,item.revision)
        if saved is None:raise HTTPException(404,f'Requirement revision unavailable for {item.requirement_id}')
        req=Requirement(**saved['requirement'])
        specification=profile[key]
        condition_statement=conditions_expected.get(key)
        expected={
            'metric':metric_names.get(key),'unit':specification.get('unit'),
            'status':'SPECIFIED','target':specification.get('value'),'comparator':specification.get('operator')}
        actual={field:getattr(req,field) for field in expected}
        if actual!=expected or not isinstance(condition_statement,str) or req.conditions.get('criteria_statement')!=condition_statement:
            raise HTTPException(422,f'Saved requirement {item.requirement_id} does not match the configured numerical gate')
        try:
            result=evaluate_verified(req.model_dump(),item.evidence_id,evidence_root)
        except FileNotFoundError:
            raise HTTPException(404,'Evidence unavailable')
        except (ValueError,KeyError,TypeError,UnicodeError):
            raise HTTPException(422,'Evidence is invalid, changed or incomplete')
        conditions=result.get('observation_conditions')
        if not isinstance(conditions,dict):
            raise HTTPException(422,'Evidence has no structured run conditions')
        identity=(conditions.get('run_id'),conditions.get('stage'),conditions.get('cycle'))
        if not isinstance(identity[0],str) or not identity[0] or identity[1]!=expected_stage or not isinstance(identity[2],int) or isinstance(identity[2],bool):
            raise HTTPException(422,'Evidence does not identify the required run stage and cycle')
        provenance=result.get('observation_provenance') or {}
        if conditions.get('criteria_statement')!=conditions_expected.get(key):
            raise HTTPException(422,'Evidence condition statement does not match the project gate')
        if not isinstance(provenance.get('source_log_sha256'),str) or not re.fullmatch(r'[0-9a-f]{64}',provenance['source_log_sha256']):
            raise HTTPException(422,'Evidence lacks source-log identity')
        if run_identity is None:
            run_identity=identity;source_hash=provenance['source_log_sha256']
        elif identity!=run_identity or provenance['source_log_sha256']!=source_hash:
            raise HTTPException(422,'Evidence records do not come from the same run, stage, cycle, and source log')
        results[key]={'requirement_id':item.requirement_id,'revision':item.revision,'evidence_id':item.evidence_id,
                      'verdict':result['verdict'],'value':result.get('observation_value'),'unit':result.get('observation_unit'),
                      'review_integrity_verified':result.get('review_integrity_verified',False),
                      'source_artifact_sha256':result.get('artifact_sha256'),'source_line':provenance.get('row_line')}
        observed.append((result,provenance))
    gates_pass=all(item['verdict']=='PASS' for item in results.values())
    signed=all(result.get('review_integrity_verified') is True for result,_ in observed)
    terminal=all(prov.get('same_cycle_convergence_announcement') is True and prov.get('continued_after_announcement') is not True for _,prov in observed)
    runtime_verified=policy.get('runtime_semantics_verified') is True
    return {
        'profile':request.profile,'run_id':run_identity[0],'stage':run_identity[1],'cycle':run_identity[2],
        'source_log_sha256':source_hash,'gates':results,
        'same_run_cycle_and_log_verified':True,'all_review_signatures_verified':signed,
        'scf_convergence_announced_for_cycle':terminal,'numerical_gate_values_pass':gates_pass,
        'numerical_cycle_criteria_satisfied':bool(gates_pass and signed and terminal and runtime_verified),
        'runtime_semantics_verified':runtime_verified,
        'device_acceptance':'NOT_EVALUATED','accepted':False,
        'reason':'This endpoint checks same-cycle numerical gates only; it does not perform physical, magnetic, screening, restart, or device acceptance.'}
