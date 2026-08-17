"""HTTP routes for simulation jobs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_job_service, get_local_worker, get_simulation_queue
from app.config import get_settings
from app.models.jobs import JobCreateResponse, JobRecord, JobResultResponse
from app.models.simulation import SimulationRequest
from app.services.jobs import JobService
from app.solvers.mumax3.adapter import Mumax3Adapter
from app.solvers.mumax3.frames import load_ovf_frame
from app.workers.gpu import detect_gpu
from app.workers.local_worker import LocalWorker
from app.workers.queue import SimulationQueue

router = APIRouter()


@router.get("/solvers")
def list_solvers() -> dict:
    """Report which solver backends are configured on this machine."""
    settings = get_settings()
    mumax = Mumax3Adapter(settings=settings)
    gpu = detect_gpu()
    return {
        "demo": {"configured": True, "note": "Deterministic fixture executor."},
        "mumax3": {
            "configured": mumax.is_available(),
            "binary": settings.mumax3_binary,
            "message": mumax.availability_message(),
            "asyncWorker": True,
        },
        "pythonLlg": {
            "configured": True,
            "note": (
                "CPU macrospin LLG twin. Used automatically when MuMax3 is not configured. "
                "Not a mesh, not OVF, not calibrated."
            ),
        },
        "kwant": {"configured": False, "note": "Kwant integration pending."},
        "surrogate": {"configured": False, "note": "Surrogate model not connected."},
        "gpu": gpu.model_dump(by_alias=True),
    }


@router.get("/worker")
def worker_status(
    queue: SimulationQueue = Depends(get_simulation_queue),
    worker: LocalWorker = Depends(get_local_worker),
) -> dict:
    settings = get_settings()
    gpu = detect_gpu()
    return {
        "workerId": worker.worker_id,
        "enabled": settings.worker_enabled,
        "pendingJobs": queue.pending_count(),
        "gpu": gpu.model_dump(by_alias=True),
    }


@router.post(
    "/simulations",
    response_model=JobCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_simulation(
    request: SimulationRequest,
    jobs: JobService = Depends(get_job_service),
) -> JobCreateResponse:
    job = jobs.submit(request)
    return JobCreateResponse(job=job)


@router.get("/simulations/{job_id}", response_model=JobRecord)
def get_simulation(
    job_id: str,
    jobs: JobService = Depends(get_job_service),
) -> JobRecord:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/simulations/{job_id}/result", response_model=JobResultResponse)
def get_simulation_result(
    job_id: str,
    jobs: JobService = Depends(get_job_service),
) -> JobResultResponse:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != "complete" or job.result is None:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Result is not available yet.",
                "jobId": job.job_id,
                "status": job.status,
                "progressPhase": job.progress_phase,
                "errors": [error.model_dump(by_alias=True) for error in job.errors],
            },
        )

    return JobResultResponse(
        job_id=job.job_id,
        status=job.status,
        result=job.result,
        errors=job.errors,
        provenance=job.provenance,
    )


@router.get("/simulations/{job_id}/frames/{frame_index}")
def get_simulation_frame(
    job_id: str,
    frame_index: int,
    jobs: JobService = Depends(get_job_service),
) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.result is None:
        raise HTTPException(status_code=404, detail="No result is attached to this job.")
    if job.result.source != "mumax3":
        raise HTTPException(
            status_code=422,
            detail="OVF frame preview is only available for MuMax3 results.",
        )
    if job.result.artifacts is None:
        raise HTTPException(status_code=404, detail="No solver frame artifacts are attached to this job.")

    frames = job.result.artifacts.frames or []
    if not frames:
        raise HTTPException(status_code=404, detail="No OVF frames are attached to this job.")
    if frame_index < 0 or frame_index >= len(frames):
        raise HTTPException(
            status_code=404,
            detail=f"Frame index {frame_index} is out of range for {len(frames)} attached OVF frame(s).",
        )

    job_dir = get_settings().job_root / job.job_id
    try:
        frame = load_ovf_frame(job_dir, frames[frame_index])
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "jobId": job.job_id,
        "frame": frame,
        "note": "Raw MuMax3 OVF Data Text vectors only; no interpolation, smoothing, or inferred device metrics.",
    }


@router.post("/simulations/{job_id}/cancel", response_model=JobRecord)
def cancel_simulation(
    job_id: str,
    jobs: JobService = Depends(get_job_service),
) -> JobRecord:
    job = jobs.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
