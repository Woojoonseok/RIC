from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .database import Base, SessionLocal, engine, settings
from .routers import graph, layer_master, projects, reference_data, validation
from .services.box_presets import ensure_default_box_presets
from .services.relation_styles import ensure_default_relation_styles
from .services.dev_migrations import run_local_dev_migrations

app = FastAPI(title="RIC Align Tree Editor API", version="0.1.0")

origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def create_tables_for_local_dev() -> None:
    Base.metadata.create_all(bind=engine)
    run_local_dev_migrations()
    with SessionLocal() as db:
        ensure_default_relation_styles(db)
        ensure_default_box_presets(db)
        db.commit()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(projects.router)
app.include_router(graph.router)
app.include_router(validation.router)
app.include_router(reference_data.router)
app.include_router(layer_master.router)

# Keep SQLAlchemy model imports reachable for metadata registration.
_models = models
