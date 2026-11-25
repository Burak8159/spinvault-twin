"""Requirements revisions and explicitly configured evidence evaluation."""
import os
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, HTTPException, Depends, Request
from urllib.parse import urlsplit
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.services.requirement_evidence import evaluate_verified
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
