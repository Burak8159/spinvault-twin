from fastapi.testclient import TestClient

from tests.conftest import sample_demo_payload


def test_valid_demo_submission(client: TestClient) -> None:
    response = client.post("/api/simulations", json=sample_demo_payload())
    assert response.status_code == 201
    body = response.json()
    job = body["job"]
    assert job["status"] == "complete"
    assert job["requestedSolver"] == "demo"
    assert job["result"]["source"] == "demo_fixture"
    assert job["result"]["isPhysicalSimulation"] is False
    assert job["provenance"]["createdBy"] == "demo_fixture"
    assert any("Demo output" in note for note in job["provenance"]["notes"])


def test_mumax3_missing_binary_is_not_configured_without_fallback(client: TestClient) -> None:
    from tests.conftest import drain_worker

    response = client.post(
        "/api/simulations",
        json=sample_demo_payload(requestedSolver="mumax3"),
    )
    assert response.status_code == 201
    job = response.json()["job"]
    assert job["status"] == "queued"
    drain_worker(client)
    job = client.get(f"/api/simulations/{job['jobId']}").json()
    assert job["status"] == "not_configured"
    assert job["result"] is None
    assert job["provenance"]["solver"] == "mumax3"
    assert any(error["code"] == "mumax3_not_configured" for error in job["errors"])
    assert any("no python llg" in note.lower() for note in job["provenance"]["notes"])


def test_not_configured_kwant_and_surrogate(client: TestClient) -> None:
    for solver in ("kwant", "surrogate"):
        response = client.post(
            "/api/simulations",
            json=sample_demo_payload(requestedSolver=solver),
        )
        assert response.status_code == 201
        job = response.json()["job"]
        assert job["status"] == "not_configured"
        assert job["result"] is None
        assert any(error["code"] == "solver_not_configured" for error in job["errors"])


def test_job_retrieval(client: TestClient) -> None:
    created = client.post("/api/simulations", json=sample_demo_payload()).json()["job"]
    response = client.get(f"/api/simulations/{created['jobId']}")
    assert response.status_code == 200
    assert response.json()["jobId"] == created["jobId"]
    assert response.json()["status"] == "complete"


def test_result_retrieval_before_completion(client: TestClient) -> None:
    from tests.conftest import drain_worker

    created = client.post(
        "/api/simulations",
        json=sample_demo_payload(requestedSolver="mumax3"),
    ).json()["job"]
    # Before worker drain, result is not ready.
    response = client.get(f"/api/simulations/{created['jobId']}/result")
    assert response.status_code == 409
    drain_worker(client)
    response = client.get(f"/api/simulations/{created['jobId']}/result")
    assert response.status_code == 409
    assert response.json()["detail"]["status"] == "not_configured"


def test_result_retrieval_after_demo_completion(client: TestClient) -> None:
    created = client.post("/api/simulations", json=sample_demo_payload()).json()["job"]
    response = client.get(f"/api/simulations/{created['jobId']}/result")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["result"]["source"] == "demo_fixture"
    assert body["result"]["isPhysicalSimulation"] is False
    assert body["provenance"]["solver"] == "demo"
    assert body["provenance"]["inputHash"]


def test_invalid_payload_returns_422(client: TestClient) -> None:
    payload = sample_demo_payload()
    payload["geometry"]["freeLayerThickness"]["value"] = "bad"
    response = client.post("/api/simulations", json=payload)
    assert response.status_code == 422


def test_cancel_terminal_job(client: TestClient) -> None:
    created = client.post("/api/simulations", json=sample_demo_payload()).json()["job"]
    response = client.post(f"/api/simulations/{created['jobId']}/cancel")
    assert response.status_code == 200
    body = response.json()
    # Demo completes synchronously, so cancel leaves the terminal complete job unchanged.
    assert body["status"] == "complete"
    assert body["result"]["source"] == "demo_fixture"


def test_cancel_queued_job(client: TestClient) -> None:
    from app.api.deps import get_job_service
    from app.models.jobs import JobRecord
    from app.models.provenance import Provenance, utc_now

    service = client.app.dependency_overrides[get_job_service]()
    job = JobRecord(
        job_id="job_queued_test",
        scenario_id="queued",
        title="Queued fixture",
        requested_solver="demo",
        status="queued",
        created_at=utc_now(),
        updated_at=utc_now(),
        provenance=Provenance(created_by="system", solver="demo", notes=["queued for cancel test"]),
    )
    service.store.create(job)
    response = client.post("/api/simulations/job_queued_test/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert response.json()["result"] is None


def test_missing_job_404(client: TestClient) -> None:
    assert client.get("/api/simulations/missing").status_code == 404
    assert client.get("/api/simulations/missing/result").status_code == 404
    assert client.post("/api/simulations/missing/cancel").status_code == 404
