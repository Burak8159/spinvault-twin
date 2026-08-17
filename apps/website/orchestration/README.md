# SpinVault Orchestration Layer

> Note: The production Twin API for Prompt #2 lives in `backend/` at the repo root.
> This `apps/website/orchestration` folder is an earlier website experiment (predict/validate stubs).

This folder is the first buildable version of the architecture shown in the system diagram.

What is implemented now:
- FastAPI gateway for simulation requests.
- Physics-informed surrogate prediction endpoint.
- SQLite experiment metadata database.
- High-fidelity validation job queue stub.
- JSON archive output for completed validation jobs.
- Budget guardrails for queued validation jobs.

Run locally:

```bash
cd orchestration
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Useful endpoints:
- `GET /health`
- `POST /api/predict`
- `POST /api/validate`
- `GET /api/jobs/{job_id}`
- `GET /api/runs`

The website can call `http://127.0.0.1:8000/api/predict` when this server is running. If it is not running, the browser simulator continues to work locally.

Future production upgrades:
- Replace the in-process queue with Ray/Celery.
- Replace the surrogate formula with a trained physics-informed model.
- Add real micromagnetic and quantum transport engines.
- Move metadata to Postgres and archives to object storage.
- Add authentication and pre-signed result URLs.
