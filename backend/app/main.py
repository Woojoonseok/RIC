from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .database import Base, SessionLocal, engine, settings, validate_identity_secret
from .routers import (
    align_trees,
    graph,
    leases,
    project_governance,
    project_layer_master,
    project_reference,
    projects,
    session,
    users,
    validation,
)
from .services.box_presets import ensure_default_box_presets
from .services.relation_styles import ensure_default_relation_styles
from .services.dev_migrations import run_local_dev_migrations

app = FastAPI(title="RIC Align Tree Editor API", version="0.1.0")


def configure_cors(application: FastAPI) -> None:
    origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Project-Revision", "ETag", "Content-Disposition"],
    )


configure_cors(app)


@app.on_event("startup")
def create_tables_for_local_dev() -> None:
    validate_identity_secret(settings.identity_secret)
    Base.metadata.create_all(bind=engine)
    run_local_dev_migrations()
    with SessionLocal() as db:
        ensure_default_relation_styles(db)
        ensure_default_box_presets(db)
        db.commit()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(session.router)
app.include_router(users.router)
app.include_router(projects.router)
app.include_router(project_governance.router)
app.include_router(align_trees.router)
app.include_router(leases.router)
app.include_router(graph.router)
app.include_router(validation.router)
app.include_router(project_reference.router)
app.include_router(project_layer_master.router)

# Keep SQLAlchemy model imports reachable for metadata registration.
_models = models
