from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from .. import models
from ..database import engine


def _rebuild_layer_relations_table(target_engine: Engine) -> None:
    """SQLite can't ALTER a NOT NULL column to nullable or swap a UNIQUE
    constraint, so widen the schema by rebuilding the table: create a fresh
    layer_relations table from the current model, copy the old rows over,
    then drop the old table. Existing data is preserved.
    """
    if not target_engine.url.drivername.startswith("sqlite"):
        return
    inspector = inspect(target_engine)
    if "layer_relations" not in inspector.get_table_names():
        return
    old_columns = {column["name"]: column for column in inspector.get_columns("layer_relations")}
    parent_column = old_columns.get("parent_layer_id")
    already_current = parent_column is not None and parent_column["nullable"]
    if already_current:
        return

    model_column_names = [column.name for column in models.LayerRelation.__table__.columns]
    shared_columns = [name for name in model_column_names if name in old_columns]
    column_list = ", ".join(shared_columns)

    with target_engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys=OFF"))
        connection.execute(text("ALTER TABLE layer_relations RENAME TO layer_relations_old"))

    models.LayerRelation.__table__.create(target_engine)

    with target_engine.begin() as connection:
        connection.execute(
            text(f"INSERT INTO layer_relations ({column_list}) SELECT {column_list} FROM layer_relations_old")
        )
        connection.execute(text("DROP TABLE layer_relations_old"))
        connection.execute(text("PRAGMA foreign_keys=ON"))


def _drop_legacy_project_scoped_preset_tables(target_engine: Engine) -> None:
    """RelationStyle/BoxPreset used to be per-project (project_id FK + a
    (project_id, name) unique constraint). They're now global presets shared
    across all projects, so the old per-project tables can't be reused as-is.
    Per project convention (see CLAUDE.md: "schema changes require database
    reset in dev"), drop them here; Base.metadata.create_all (called before
    this function in main.py's startup hook) then recreates them with the new
    global schema, and main.py reseeds default presets afterward.
    """
    inspector = inspect(target_engine)
    for table_name in ("relation_styles", "box_presets"):
        if table_name not in inspector.get_table_names():
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "project_id" in columns:
            with target_engine.begin() as connection:
                connection.execute(text(f"DROP TABLE {table_name}"))


def _drop_legacy_layer_master_priority_columns(target_engine: Engine) -> None:
    """layer_masters used to have four fixed priority_* columns. They're now
    rows in layer_master_priorities (one per 기준정보 Key 배치 Type) so the
    column count can track however many Key 배치 Type rows exist. Drop the old
    table per the same dev-reset convention as the preset tables above.
    """
    inspector = inspect(target_engine)
    if "layer_masters" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("layer_masters")}
    if "priority_normal" in columns:
        with target_engine.begin() as connection:
            connection.execute(text("DROP TABLE layer_masters"))


def _add_timestamp_columns(target_engine: Engine) -> None:
    """Bring existing local SQLite reference tables up to TimestampMixin.

    SQLite cannot add a column with CURRENT_TIMESTAMP as a non-constant
    default. Nullable columns are therefore added first and existing rows are
    backfilled. Fresh databases still receive the model-level defaults through
    ``create_all``.
    """
    if not target_engine.url.drivername.startswith("sqlite"):
        return
    inspector = inspect(target_engine)
    timestamped_tables = (
        "projects",
        "layers",
        "layer_relations",
        "relation_styles",
        "box_presets",
        "key_layout_types",
        "key_drawing_types",
        "key_shapes",
        "layer_masters",
        "layer_master_priorities",
        "graph_layouts",
        "shape_styles",
        "text_boxes",
        "change_history",
    )
    for table_name in timestamped_tables:
        if table_name not in inspector.get_table_names():
            continue
        columns = {column["name"] for column in inspect(target_engine).get_columns(table_name)}
        with target_engine.begin() as connection:
            if "created_at" not in columns:
                connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN created_at DATETIME"))
            if "updated_at" not in columns:
                connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN updated_at DATETIME"))
            connection.execute(
                text(
                    f"UPDATE {table_name} "
                    "SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP), "
                    "updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)"
                )
            )


def run_local_dev_migrations() -> None:
    _drop_legacy_project_scoped_preset_tables(engine)
    _drop_legacy_layer_master_priority_columns(engine)
    # Recreate any table just dropped above with the current (global) schema.
    models.Base.metadata.create_all(bind=engine)
    _add_timestamp_columns(engine)

    inspector = inspect(engine)

    if "layers" in inspector.get_table_names():
        layer_columns = {column["name"] for column in inspector.get_columns("layers")}
        if "box_preset_id" not in layer_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE layers ADD COLUMN box_preset_id CHAR(32)"))
        if "pending_group" not in layer_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE layers ADD COLUMN pending_group VARCHAR(80)"))

    if "layer_relations" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("layer_relations")}
    if "relation_style_id" not in columns and engine.url.drivername.startswith("sqlite"):
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE layer_relations ADD COLUMN relation_style_id CHAR(32)"))
    if "same_group" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE layer_relations ADD COLUMN same_group VARCHAR(80)"))
    if "attached_relation_id" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE layer_relations ADD COLUMN attached_relation_id CHAR(36)"))
    if "waypoints" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE layer_relations ADD COLUMN waypoints JSON"))
    if "instance" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE layer_relations ADD COLUMN instance VARCHAR(120)"))

    # Column additions above are simple ALTERs; the nullable/unique-constraint
    # change needs a full table rebuild, done last so it sees every column.
    _rebuild_layer_relations_table(engine)
