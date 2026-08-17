# Orchestration / API Gateway

Purpose:

- Receive simulation parameter requests.
- Validate parameters.
- Decide whether a request should use the fast surrogate or queue a high-fidelity validation job.
- Store experiment metadata.
- Return traceable run IDs to the client.

Current implementation:

- `../orchestration/app/main.py`
- `POST /api/predict`
- `POST /api/validate`
- `GET /api/jobs/{job_id}`
- `GET /api/runs`

Production direction:

- Add authentication.
- Add request signing for partner/private reports.
- Split public demo requests from advisor/lab validation requests.
