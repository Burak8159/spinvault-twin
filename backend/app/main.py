"""SpinVault Twin FastAPI application."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.deps import start_background_worker, stop_background_worker
from app.api.routes import router as simulations_router
from app.config import get_settings


class PrivateNetworkCorsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.headers.get("access-control-request-private-network") == "true":
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
        CORSMiddleware,
        allow_origin_regex=(
            r"^(https?://(127\.0\.0\.1|localhost):\d+"
            r"|https://(www\.)?spinvault\.biz)$"
        ),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(PrivateNetworkCorsMiddleware)
    app.include_router(simulations_router, prefix="/api")

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
