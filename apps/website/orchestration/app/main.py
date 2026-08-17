from __future__ import annotations

import time
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import PredictionResponse, SimulationRequest, ValidationJobResponse
from .physics import predict_metrics
from .storage import archive_validation, get_job, list_runs, save_job, save_run


app = FastAPI(title="SpinVault Orchestration Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:4191", "http://localhost:4191", "http://127.0.0.1:4173", "http://localhost:4173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BUDGET_UNITS_PER_JOB = 4
MAX_VALIDATION_BUDGET_UNITS = 40


def build_prediction(request: SimulationRequest, run_id: str | None = None) -> PredictionResponse:
    metrics = predict_metrics(
        mode=request.mode,
        bit_state=request.bit_state,
        barrier_height_ev=request.barrier_height_ev,
        electron_energy_ev=request.electron_energy_ev,
        barrier_nm=request.barrier_nm,
        spin_polarization=request.spin_polarization,
        temperature_k=request.temperature_k,
        disturbance=request.disturbance,
    )
    return PredictionResponse(
        run_id=run_id or f"run_{uuid4().hex[:12]}",
        mode=request.mode,
        bit_state=request.bit_state,
        tunnel_probability=metrics.tunnel_probability,
        retention_margin=metrics.retention_margin,
        leakage_pressure=metrics.leakage_pressure,
        attack_exposure=metrics.attack_exposure,
        tmr_ratio=metrics.tmr_ratio,
        thermal_stability_delta=metrics.thermal_stability_delta,
        design_window=metrics.design_window,
        model_path="surrogate.v0.physics_formula",
        notes=metrics.notes,
    )


def run_validation_job(job_id: str, request: SimulationRequest, prediction: PredictionResponse) -> None:
    save_job(job_id, prediction.run_id, "running", BUDGET_UNITS_PER_JOB)
    time.sleep(1)
    payload = {
        "job_id": job_id,
        "run_id": prediction.run_id,
        "validation_level": "stub_high_fidelity",
        "engines_requested": [
            "finite_barrier_transport",
            "future_mumax3_llgs",
            "future_quantum_transport",
        ],
        "input": request.model_dump(),
        "surrogate_prediction": prediction.model_dump(),
        "result": {
            "status": "completed_stub",
            "message": "High-fidelity solver hook is ready. Replace this stub with Ray/CUDA/solver execution.",
        },
    }
    archive_path = archive_validation(job_id, payload)
    save_job(job_id, prediction.run_id, "completed", BUDGET_UNITS_PER_JOB, archive_path)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "spinvault-orchestrator"}


@app.post("/api/predict", response_model=PredictionResponse)
def predict(request: SimulationRequest) -> PredictionResponse:
    prediction = build_prediction(request)
    save_run(prediction.run_id, request.model_dump(), prediction.model_dump())
    return prediction


@app.post("/api/validate", response_model=ValidationJobResponse)
def validate(request: SimulationRequest, background_tasks: BackgroundTasks) -> ValidationJobResponse:
    prediction = build_prediction(request)
    save_run(prediction.run_id, request.model_dump(), prediction.model_dump(), status="queued_for_validation")
    job_id = f"job_{uuid4().hex[:12]}"
    save_job(job_id, prediction.run_id, "queued", BUDGET_UNITS_PER_JOB)
    background_tasks.add_task(run_validation_job, job_id, request, prediction)
    return ValidationJobResponse(
        job_id=job_id,
        run_id=prediction.run_id,
        status="queued",
        estimated_seconds=5,
        budget_units_reserved=BUDGET_UNITS_PER_JOB,
    )


@app.get("/api/jobs/{job_id}")
def job(job_id: str) -> dict:
    result = get_job(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="Job not found")
    return result


@app.get("/api/runs")
def runs(limit: int = 25) -> dict:
    return {"runs": list_runs(limit=limit)}


@app.get("/api/budget")
def budget() -> dict:
    return {
        "budget_units_per_validation_job": BUDGET_UNITS_PER_JOB,
        "max_validation_budget_units": MAX_VALIDATION_BUDGET_UNITS,
        "governance_note": "The current prototype exposes budget settings; production should enforce quotas per user/project.",
    }
