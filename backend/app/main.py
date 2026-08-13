from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from . import models
from .database import SessionLocal, engine, settings, validate_runtime_settings
from .routers import (
    align_trees,
    align_key_rows,
    graph,
    layer_master_imports,
    leases,
    project_governance,
    project_layer_master,
    project_reference,
    projects,
    relation_imports,
    reviews,
    session,
    snapshots,
    system_admin,
    users,
    validation,
    validation_rules,
    workflow,
)
from .services.box_presets import ensure_default_box_presets
from .services.migrations import migration_status, upgrade_database
from .services.relation_styles import ensure_default_relation_styles

@asynccontextmanager
async def lifespan(_application: FastAPI):
    validate_runtime_settings()
    if settings.run_database_migrations:
        upgrade_database()
    elif not migration_status().ready:
        raise RuntimeError("Database migrations are not current")
    with SessionLocal() as db:
        ensure_default_relation_styles(db)
        ensure_default_box_presets(db)
        db.commit()
    yield


app = FastAPI(title="RIC Align Tree Editor API", version="0.1.0", lifespan=lifespan)


def configure_cors(application: FastAPI) -> None:
    origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=settings.cors_origin_regex or None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Project-Revision", "ETag", "Content-Disposition"],
    )


configure_cors(app)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/ready")
def readiness() -> JSONResponse:
    checks: dict[str, str] = {}
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001 - readiness must report dependency failure as HTTP 503.
        checks["database"] = "unavailable"

    try:
        status = migration_status()
        checks["migrations"] = "ok" if status.ready else "outdated"
    except Exception:  # noqa: BLE001 - readiness must report dependency failure as HTTP 503.
        checks["migrations"] = "unavailable"

    try:
        with SessionLocal() as db:
            has_relation_style = (
                db.query(models.RelationStyle.id).filter(models.RelationStyle.project_id.is_(None)).first() is not None
            )
            has_box_preset = db.query(models.BoxPreset.id).filter(models.BoxPreset.project_id.is_(None)).first() is not None
        checks["reference_data"] = "ok" if has_relation_style and has_box_preset else "missing"
    except Exception:  # noqa: BLE001 - readiness must report dependency failure as HTTP 503.
        checks["reference_data"] = "unavailable"

    ready = all(value == "ok" for value in checks.values())
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )


app.include_router(session.router)
app.include_router(users.router)
app.include_router(projects.router)
app.include_router(project_governance.router)
app.include_router(align_trees.router)
app.include_router(align_key_rows.router)
app.include_router(leases.router)
app.include_router(graph.router)
app.include_router(validation.router)
app.include_router(validation_rules.router)
app.include_router(project_reference.router)
app.include_router(project_layer_master.router)
app.include_router(layer_master_imports.router)
app.include_router(relation_imports.router)
app.include_router(reviews.router)
app.include_router(snapshots.router)
app.include_router(system_admin.router)
app.include_router(workflow.router)

# Keep SQLAlchemy model imports reachable for metadata registration.
_models = models
