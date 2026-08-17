"""Environment-backed settings for the Twin API."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_CORS_ORIGINS = [
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:4180",
    "http://localhost:4180",
    "http://127.0.0.1:4190",
    "http://localhost:4190",
    "http://127.0.0.1:4191",
    "http://localhost:4191",
    "http://127.0.0.1:4200",
    "http://localhost:4200",
    "http://127.0.0.1:4210",
    "http://localhost:4210",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "null",  # file:// origin for some local static servers
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SPINVAULT_",
        env_file=".env",
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "SpinVault Twin API"
    app_version: str = "0.4.0"
    # Development origins only by default. Override via SPINVAULT_CORS_ORIGINS.
    cors_origins: str = Field(default_factory=lambda: ",".join(DEFAULT_CORS_ORIGINS))
    # "memory" | "json"
    job_store: str = "memory"
    data_dir: Path = BACKEND_ROOT / "data" / "jobs"

    # MuMax3: read MUMAX3_* without requiring the SPINVAULT_ prefix.
    mumax3_binary: str | None = Field(
        default=None,
        validation_alias=AliasChoices("MUMAX3_BINARY", "SPINVAULT_MUMAX3_BINARY"),
    )
    job_root: Path = Field(
        default=BACKEND_ROOT / "data" / "mumax_jobs",
        validation_alias=AliasChoices("SPINVAULT_JOB_ROOT", "JOB_ROOT"),
    )
    mumax3_timeout_seconds: int = Field(
        default=600,
        ge=1,
        validation_alias=AliasChoices("MUMAX3_TIMEOUT_SECONDS", "SPINVAULT_MUMAX3_TIMEOUT_SECONDS"),
    )
    worker_enabled: bool = Field(default=True, validation_alias=AliasChoices("SPINVAULT_WORKER_ENABLED", "WORKER_ENABLED"))
    worker_poll_seconds: float = Field(default=0.25, ge=0.05)

    @property
    def normalized_cors_origins(self) -> list[str]:
        values = [item.strip() for item in self.cors_origins.split(",")]
        cleaned = [value for value in values if value]
        return cleaned or list(DEFAULT_CORS_ORIGINS)


@lru_cache
def get_settings() -> Settings:
    return Settings()
