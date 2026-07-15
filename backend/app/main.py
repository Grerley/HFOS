"""HFOS FastAPI application entrypoint."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    routes_auth,
    routes_budget,
    routes_config,
    routes_dashboard,
    routes_goals,
    routes_households,
    routes_import,
    routes_property,
    routes_scenarios,
)
from app.config import settings
from app.database import create_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.auto_create_tables:
        create_all()
    yield


app = FastAPI(
    title="HFOS API",
    version="0.1.0",
    description=(
        "Household Financial Operating System — a secure, explainable personal-CFO "
        "platform. All financial figures are produced by the server-side calculation "
        "engine (see /docs)."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (
    routes_auth,
    routes_households,
    routes_config,
    routes_budget,
    routes_property,
    routes_goals,
    routes_scenarios,
    routes_dashboard,
    routes_import,
):
    app.include_router(module.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    from app.services.calculations import FORMULA_VERSION

    return {"status": "ok", "formula_version": FORMULA_VERSION}
