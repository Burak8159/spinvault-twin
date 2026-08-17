"""Shared fixtures for API tests."""

from __future__ import annotations

import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

# Force memory store / disable background worker thread before app import caches settings.
os.environ["SPINVAULT_JOB_STORE"] = "memory"
os.environ["SPINVAULT_WORKER_ENABLED"] = "false"

from app.api.deps import (  # noqa: E402
    get_job_service,
    get_job_store,
    get_local_worker,
    get_simulation_queue,
    reset_runtime,
)
from app.main import create_app  # noqa: E402
from app.services.jobs import JobService  # noqa: E402
from app.services.solver_router import SolverRouter  # noqa: E402
from app.storage.memory_store import InMemoryJobStore  # noqa: E402
from app.workers.local_worker import LocalWorker  # noqa: E402
from app.workers.queue import InMemorySimulationQueue  # noqa: E402


def sample_demo_payload(**overrides: object) -> dict:
    payload: dict = {
        "scenarioId": "mtj-pillar-demo",
        "title": "MTJ pillar review",
        "requestedSolver": "demo",
        "geometry": {
            "freeLayerThickness": {"value": 1.2, "unit": "nm", "source": "preset"},
            "freeLayerLength": {"value": 80, "unit": "nm", "source": "preset"},
            "freeLayerWidth": {"value": 40, "unit": "nm", "source": "preset"},
            "barrierThickness": {"value": 1.0, "unit": "nm", "source": "preset"},
            "referenceLayerThickness": {"value": 2.0, "unit": "nm", "source": "preset"},
            "cellShape": "ellipse",
        },
        "materials": {
            "freeLayerId": "cofeb-example",
            "referenceLayerId": "cofeb-example",
            "barrierId": "mgo-example",
        },
        "controls": {
            "mode": "time_domain",
            "recordTimeline": True,
            "pauseOnWarning": False,
            "duration": {"value": 5, "unit": "ns", "source": "user"},
            "temperature": {"value": 300, "unit": "K", "source": "user"},
            "currentDirection": "positive_z",
            "selectedRegion": "free",
            "viewportZoom": 1.0,
        },
        "initialMagnetization": {
            "mode": "uniform",
            "vector": {"x": 0.0, "y": 0.0, "z": 1.0},
        },
        "externalField": {
            "x": {"value": 0.0, "unit": "T", "source": "user"},
            "y": {"value": 0.0, "unit": "T", "source": "user"},
            "z": {"value": 0.01, "unit": "T", "source": "user"},
        },
        "solverDrafts": {
            "mumax3": {
                "meshCellSize": {
                    "x": {"value": 2, "unit": "nm"},
                    "y": {"value": 2, "unit": "nm"},
                    "z": {"value": 0.6, "unit": "nm"},
                },
                "gridSize": {"nx": 8, "ny": 4, "nz": 1},
                "saturationMagnetization": {"value": 1000000, "unit": "A/m"},
                "exchangeStiffness": {"value": 1e-11, "unit": "J/m"},
                "dampingAlpha": {"value": 0.01, "unit": "dimensionless"},
                "simulationTime": {"value": 0.1, "unit": "ns"},
            },
            "kwant": {"latticeModel": "placeholder_1d"},
            "surrogate": {"connectionStatus": "not_connected"},
        },
    }
    payload.update(overrides)
    return payload


def sample_mumax_payload(**overrides: object) -> dict:
    base = sample_demo_payload()
    base["requestedSolver"] = "mumax3"
    base.update(overrides)
    return base


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    reset_runtime()
    os.environ["SPINVAULT_JOB_STORE"] = "memory"
    os.environ["SPINVAULT_WORKER_ENABLED"] = "false"
    app = create_app()
    store = InMemoryJobStore()
    queue = InMemorySimulationQueue()
    worker = LocalWorker(store=store, queue=queue)
    service = JobService(store=store, router=SolverRouter(), queue=queue)

    app.dependency_overrides[get_job_store] = lambda: store
    app.dependency_overrides[get_simulation_queue] = lambda: queue
    app.dependency_overrides[get_local_worker] = lambda: worker
    app.dependency_overrides[get_job_service] = lambda: service

    with TestClient(app) as test_client:
        test_client.store = store  # type: ignore[attr-defined]
        test_client.queue = queue  # type: ignore[attr-defined]
        test_client.worker = worker  # type: ignore[attr-defined]
        yield test_client

    app.dependency_overrides.clear()
    store.clear()
    reset_runtime()


def drain_worker(client: TestClient, max_jobs: int = 8) -> None:
    """Process queued jobs synchronously in tests."""
    worker: LocalWorker = client.worker  # type: ignore[attr-defined]
    for _ in range(max_jobs):
        if not worker.run_once():
            break
