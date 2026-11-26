"""SpinVault Twin FastAPI application."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.datastructures import Headers

from app.api.deps import start_background_worker, stop_background_worker
from app.api.routes import router as simulations_router
from app.config import get_settings
from app.api.requirements import router as requirements_router
from app.api.project_records import router as project_records_router


class PrivateNetworkCorsMiddleware(CORSMiddleware):
    """Allow private-network preflights only after ordinary CORS succeeds.

    Strip the extension header for the base implementation so this behaves
    consistently across Starlette versions with and without native PNA support.
    """

    def preflight_response(self, request_headers: Headers):
        private_network = request_headers.get("access-control-request-private-network") == "true"
        filtered = Headers(raw=[(key, value) for key, value in request_headers.raw
                                if key.lower() != b"access-control-request-private-network"])
        response = super().preflight_response(filtered)
        if private_network and response.status_code == 200:
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response


@asynccontextmanager
async def lifespan(_app: FastAPI):
    start_background_worker()
    try:
        yield
    finally:
        stop_background_worker()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
        description=(
            "Job gateway for SpinVault Twin. Demo executor returns labeled fixtures. "
            "MuMax3 jobs are queued for a local worker. If MUMAX3_BINARY is missing, "
            "the worker runs a CPU Python macrospin LLG twin labeled python_llg_twin. "
            "GPU/RTX run acceleration is reported only when MuMax3 logs confirm GPU execution; "
            "host nvidia-smi alone is labeled host_gpu_available. "
            "Kwant and surrogate adapters are not connected."
        ),
    )
    app.add_middleware(
        PrivateNetworkCorsMiddleware,
        allow_origins=settings.normalized_cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(simulations_router, prefix="/api")
    app.include_router(requirements_router, prefix="/api")
    app.include_router(project_records_router, prefix="/api")

    @app.get("/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "service": "spinvault-twin-api",
            "version": settings.app_version,
            "workerEnabled": settings.worker_enabled,
        }

    return app


app = create_app()
