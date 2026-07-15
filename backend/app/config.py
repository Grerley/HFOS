"""Application configuration, loaded from environment (12-factor)."""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HFOS_", env_file=".env", extra="ignore")

    # Non-prefixed on purpose (conventional name shared with tooling like Alembic).
    database_url: str = Field(default="sqlite:///./hfos.db", alias="DATABASE_URL")

    secret_key: str = "dev-only-change-me-please-generate-a-real-secret"
    encryption_key: str | None = None
    access_token_minutes: int = 720
    algorithm: str = "HS256"

    cors_origins: str = "http://localhost:3000"
    auto_create_tables: bool = True
    copilot_provider: str = "rules"

    base_currency: str = "ZAR"
    default_country: str = "ZA"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
