"""HTTP routes for simulation jobs."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.api.deps import get_job_service, get_local_worker, get_simulation_queue
from app.config import get_settings
from app.models.jobs import JobCreateResponse, JobRecord, JobResultResponse
from app.models.simulation import SimulationRequest
from app.services.jobs import JobService
from app.solvers.mumax3.adapter import Mumax3Adapter
from app.solvers.mumax3.frames import load_ovf_frame
from app.solvers.python_micromagnetic.artifact import FRAME_FORMAT, load_npz_frame
from app.solvers.python_micromagnetic.matplotlib_report import REPORT_DIR, REPORT_MANIFEST
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
                "CPU macrospin LLG twin. Not a mesh, not OVF, not calibrated."
            ),
        },
        "pythonMicromagnetic": {
            "configured": True,
            "asyncWorker": True,
            "note": (
                "Local CPU 64×32×1 finite-difference LLGS with Newell FFT demagnetization. "
                "Not MuMax3. Not a measured-device prediction."
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
    if job.result.source not in {"mumax3", "python_micromagnetic"}:
        raise HTTPException(
            status_code=422,
            detail="Mesh frame preview is only available for MuMax3 or Python micromagnetic results.",
        )
    if job.result.artifacts is None:
        raise HTTPException(status_code=404, detail="No solver frame artifacts are attached to this job.")

    frames = job.result.artifacts.frames or []
    if not frames:
        raise HTTPException(status_code=404, detail="No magnetization frames are attached to this job.")
    if frame_index < 0 or frame_index >= len(frames):
        raise HTTPException(
            status_code=404,
            detail=f"Frame index {frame_index} is out of range for {len(frames)} attached frame(s).",
        )

    job_dir = get_settings().job_root / job.job_id
    frame_meta = frames[frame_index]
    fmt = str(frame_meta.get("format") if isinstance(frame_meta, dict) else getattr(frame_meta, "format", ""))
    try:
        if job.result.source == "python_micromagnetic" or fmt == FRAME_FORMAT:
            frame = load_npz_frame(job_dir, frame_meta)
            note = "Raw Python micromagnetic mesh vectors. Not OVF. Not MuMax3."
        else:
            frame = load_ovf_frame(job_dir, frame_meta)
            note = "Raw MuMax3 OVF Data Text vectors only; no interpolation, smoothing, or inferred device metrics."
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "jobId": job.job_id,
        "frame": frame,
        "note": note,
    }


def _matplotlib_report(job_id: str, jobs: JobService) -> tuple[JobRecord, dict, Path]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.result is None or job.result.source != "python_micromagnetic":
        raise HTTPException(
            status_code=422,
            detail="A matplotlib Twin report is only available for Python micromagnetic results.",
        )
    report_dir = get_settings().job_root / job.job_id / REPORT_DIR
    manifest_path = report_dir / REPORT_MANIFEST
    if not manifest_path.exists():
        raise HTTPException(
            status_code=404,
            detail="The matplotlib report is not available for this job.",
        )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read matplotlib report: {exc}") from exc
    return job, manifest, report_dir


@router.get("/simulations/{job_id}/matplotlib")
def get_simulation_matplotlib_report(
    job_id: str,
    jobs: JobService = Depends(get_job_service),
) -> dict:
    """Metadata for matplotlib assets rendered only from the completed NumPy mesh."""
    job, manifest, _ = _matplotlib_report(job_id, jobs)
    return {
        "jobId": job.job_id,
        "report": manifest,
    }


@router.get("/simulations/{job_id}/matplotlib/{asset_name}")
def get_simulation_matplotlib_asset(
    job_id: str,
    asset_name: str,
    jobs: JobService = Depends(get_job_service),
) -> FileResponse:
    """Serve one allow-listed report image or animation from the local job."""
    _, manifest, report_dir = _matplotlib_report(job_id, jobs)
    assets = manifest.get("assets", [])
    selected = next((asset for asset in assets if asset.get("path") == asset_name), None)
    if selected is None:
        raise HTTPException(status_code=404, detail="Matplotlib report asset not found.")
    path = (report_dir / asset_name).resolve()
    root = report_dir.resolve()
    if path.parent != root or not path.is_file():
        raise HTTPException(status_code=404, detail="Matplotlib report asset not found.")
    return FileResponse(
        path,
        media_type=str(selected.get("mimeType") or "application/octet-stream"),
        filename=path.name,
        headers={"Cache-Control": "no-store"},
    )


@router.post("/simulations/{job_id}/cancel", response_model=JobRecord)
def cancel_simulation(
    job_id: str,
    jobs: JobService = Depends(get_job_service),
) -> JobRecord:
    job = jobs.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
