from __future__ import annotations

from sqlalchemy import inspect, text

from .. import models
from ..database import SessionLocal, engine
from .box_presets import ensure_default_box_presets


def run_local_dev_migrations() -> None:
    inspector = inspect(engine)
    if "layer_relations" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("layer_relations")}
    if "relation_style_id" not in columns and engine.url.drivername.startswith("sqlite"):
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE layer_relations ADD COLUMN relation_style_id CHAR(32)"))

    if "box_presets" in inspector.get_table_names():
        with SessionLocal() as db:
            project_ids = [project.id for project in db.query(models.Project).all()]
            for project_id in project_ids:
                ensure_default_box_presets(db, project_id)
            db.commit()
