from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Engine, inspect, text
from sqlalchemy.orm import Session

from .. import models
from ..database import engine
from .audit import record_project_event
from .project_reference import ensure_project_reference_data


def _quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _add_timestamp_columns(target_engine: Engine) -> None:
    """Backfill TimestampMixin columns on pre-SQLAlchemy local databases."""

    if not target_engine.url.drivername.startswith("sqlite"):
        return
    timestamped_tables = (
        "actors",
        "actor_identities",
        "projects",
        "project_members",
        "project_access_requests",
        "align_trees",
        "project_access",
        "project_share_links",
        "project_edit_leases",
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
        inspector = inspect(target_engine)
        if table_name not in inspector.get_table_names():
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        table = _quoted(table_name)
        with target_engine.begin() as connection:
            if "created_at" not in columns:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN created_at DATETIME"))
            if "updated_at" not in columns:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN updated_at DATETIME"))
            connection.execute(
                text(
                    f"UPDATE {table} "
                    "SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP), "
                    "updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)"
                )
            )


def _add_project_columns(target_engine: Engine) -> None:
    if not target_engine.url.drivername.startswith("sqlite"):
        return
    inspector = inspect(target_engine)
    if "projects" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("projects")}
    with target_engine.begin() as connection:
        additions = (
            ("owner_actor_id", "CHAR(32)"),
            ("created_by_actor_id", "CHAR(32)"),
            ("creator_display_name", "VARCHAR(120) NOT NULL DEFAULT 'Legacy Import'"),
            ("is_public", "BOOLEAN NOT NULL DEFAULT 1"),
            ("is_legacy_unclaimed", "BOOLEAN NOT NULL DEFAULT 0"),
            ("deleted_at", "DATETIME"),
            ("revision", "INTEGER NOT NULL DEFAULT 0"),
        )
        for column_name, definition in additions:
            if column_name not in columns:
                connection.execute(text(f"ALTER TABLE projects ADD COLUMN {column_name} {definition}"))
        connection.execute(
            text(
                "UPDATE projects SET "
                "creator_display_name = COALESCE(NULLIF(TRIM(creator_display_name), ''), 'Legacy Import'), "
                "is_public = COALESCE(is_public, 1), "
                "is_legacy_unclaimed = COALESCE(is_legacy_unclaimed, 0), "
                "revision = COALESCE(revision, 0)"
            )
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_projects_owner_actor_id ON projects (owner_actor_id)"))
        connection.execute(
            text("CREATE INDEX IF NOT EXISTS ix_projects_created_by_actor_id ON projects (created_by_actor_id)")
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_projects_deleted_at ON projects (deleted_at)"))


def _add_actor_columns(target_engine: Engine) -> None:
    if not target_engine.url.drivername.startswith("sqlite"):
        return
    inspector = inspect(target_engine)
    if "actors" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("actors")}
    if "legacy_claim_ip_hash" not in columns:
        with target_engine.begin() as connection:
            connection.execute(text("ALTER TABLE actors ADD COLUMN legacy_claim_ip_hash VARCHAR(64)"))


def _unique_columns(target_engine: Engine, table_name: str) -> set[tuple[str, ...]]:
    return {
        tuple(constraint.get("column_names") or ())
        for constraint in inspect(target_engine).get_unique_constraints(table_name)
    }


def _needs_rebuild(
    target_engine: Engine,
    table_name: str,
    *,
    required_columns: set[str],
    required_unique: tuple[str, ...] | None = None,
    nullable_columns: set[str] | None = None,
) -> bool:
    inspector = inspect(target_engine)
    if table_name not in inspector.get_table_names():
        return False
    columns = {column["name"]: column for column in inspector.get_columns(table_name)}
    if not required_columns.issubset(columns):
        return True
    if nullable_columns and any(not columns[name]["nullable"] for name in nullable_columns):
        return True
    return required_unique is not None and required_unique not in _unique_columns(target_engine, table_name)


def _rebuild_sqlite_table(target_engine: Engine, model: type[models.Base]) -> None:
    """Rebuild one SQLite table with its current model while preserving rows.

    ``legacy_alter_table`` prevents SQLite from retargeting foreign keys in
    other tables to the temporary backup name during the rename. The complete
    rename/create/copy/drop sequence is transactional.
    """

    table = model.__table__
    table_name = table.name
    backup_name = f"{table_name}__workspace_v1"
    inspector = inspect(target_engine)
    if backup_name in inspector.get_table_names():
        raise RuntimeError(
            f"Incomplete local migration found ({backup_name}); preserve the database and resolve it manually"
        )
    old_columns = {column["name"] for column in inspector.get_columns(table_name)}
    shared_columns = [column.name for column in table.columns if column.name in old_columns]
    if not shared_columns:
        raise RuntimeError(f"Cannot safely migrate {table_name}: no shared columns")

    old_table = _quoted(table_name)
    backup_table = _quoted(backup_name)
    column_list = ", ".join(_quoted(name) for name in shared_columns)

    with target_engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.exec_driver_sql("PRAGMA legacy_alter_table=ON")
        connection.commit()
        transaction = connection.begin()
        try:
            connection.execute(text(f"ALTER TABLE {old_table} RENAME TO {backup_table}"))
            index_rows = connection.exec_driver_sql(f"PRAGMA index_list({backup_table})").mappings().all()
            for index_row in index_rows:
                index_name = str(index_row["name"])
                if not index_name.startswith("sqlite_autoindex"):
                    connection.execute(text(f"DROP INDEX IF EXISTS {_quoted(index_name)}"))
            table.create(bind=connection, checkfirst=False)
            connection.execute(
                text(
                    f"INSERT INTO {old_table} ({column_list}) "
                    f"SELECT {column_list} FROM {backup_table}"
                )
            )
            connection.execute(text(f"DROP TABLE {backup_table}"))
            transaction.commit()
        except Exception:
            transaction.rollback()
            raise
        finally:
            connection.exec_driver_sql("PRAGMA legacy_alter_table=OFF")
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            connection.commit()


def _rebuild_scoped_tables(target_engine: Engine) -> None:
    if not target_engine.url.drivername.startswith("sqlite"):
        return

    reference_specs: tuple[tuple[type[models.Base], tuple[str, ...] | None], ...] = (
        (models.RelationStyle, ("project_id", "name")),
        (models.BoxPreset, ("project_id", "name")),
        (models.KeyLayoutType, ("project_id", "name")),
        (models.KeyDrawingType, None),
        (models.KeyShape, ("project_id", "key_shape")),
        (models.LayerMaster, ("project_id", "name")),
        (models.LayerMasterPriority, ("project_id", "layer_master_id", "key_layout_type_id")),
    )
    for model, expected_unique in reference_specs:
        table_name = model.__table__.name
        if _needs_rebuild(
            target_engine,
            table_name,
            required_columns={"project_id"},
            required_unique=expected_unique,
        ):
            _rebuild_sqlite_table(target_engine, model)

    graph_specs: tuple[
        tuple[type[models.Base], set[str], tuple[str, ...] | None, set[str] | None], ...
    ] = (
        (models.Layer, {"align_tree_id", "box_preset_id", "pending_group"}, ("align_tree_id", "name"), None),
        (
            models.LayerRelation,
            {
                "align_tree_id",
                "relation_style_id",
                "same_group",
                "attached_relation_id",
                "waypoints",
                "instance",
            },
            ("align_tree_id", "parent_layer_id", "child_layer_id", "instance"),
            {"parent_layer_id", "child_layer_id"},
        ),
        (models.GraphLayout, {"align_tree_id"}, ("align_tree_id", "layer_id"), None),
        (models.ShapeStyle, {"align_tree_id"}, ("align_tree_id", "layer_id"), None),
        (models.TextBox, {"align_tree_id"}, None, None),
    )
    for model, columns, expected_unique, nullable_columns in graph_specs:
        table_name = model.__table__.name
        if _needs_rebuild(
            target_engine,
            table_name,
            required_columns=columns,
            required_unique=expected_unique,
            nullable_columns=nullable_columns,
        ):
            _rebuild_sqlite_table(target_engine, model)


def _strongest_member_role(current: str | None, candidate: str) -> str:
    rank = {"viewer": 1, "editor": 2, "admin": 3, "owner": 4}
    return candidate if rank.get(candidate, 0) > rank.get(current or "", 0) else current or candidate


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _legacy_grant_is_active(grant: models.ProjectAccess, now: datetime) -> bool:
    link = grant.source_share
    if link is None:
        return True
    if link.revoked_at is not None:
        return False
    return link.expires_at is None or _as_utc(link.expires_at) > now


def _snapshot_legacy_actor_hashes(db: Session, cutoff: datetime | None) -> None:
    query = db.query(models.Actor).filter(
        models.Actor.legacy_claim_ip_hash.is_(None),
        models.Actor.last_ip_hash.is_not(None),
    )
    if cutoff is not None:
        query = query.filter(models.Actor.created_at <= cutoff)
    for actor in query.all():
        actor.legacy_claim_ip_hash = actor.last_ip_hash


def _migrate_project_rows(target_engine: Engine) -> None:
    with Session(target_engine) as db:
        projects = db.query(models.Project).order_by(models.Project.created_at, models.Project.id).all()
        for project in projects:
            migration_event = (
                db.query(models.ProjectAuditEvent)
                .filter(
                    models.ProjectAuditEvent.project_id == project.id,
                    models.ProjectAuditEvent.event_type == "project.migrated_v2",
                )
                .order_by(models.ProjectAuditEvent.created_at)
                .first()
            )
            # If this project is being migrated now, every Actor currently in
            # the database predates the migration. On subsequent startups,
            # only Actors older than the persisted migration event qualify.
            _snapshot_legacy_actor_hashes(
                db,
                migration_event.created_at if migration_event is not None else None,
            )
            owner = db.get(models.Actor, project.owner_actor_id) if project.owner_actor_id else None
            if owner is None and project.owner_actor_id is not None:
                project.owner_actor_id = None

            if owner is not None:
                project.created_by_actor_id = project.created_by_actor_id or owner.id
                project.creator_display_name = owner.display_name
                project.is_legacy_unclaimed = False
                membership = (
                    db.query(models.ProjectMember)
                    .filter(
                        models.ProjectMember.project_id == project.id,
                        models.ProjectMember.actor_id == owner.id,
                    )
                    .one_or_none()
                )
                if membership is None:
                    db.add(
                        models.ProjectMember(
                            project_id=project.id,
                            actor_id=owner.id,
                            role="owner",
                            added_by_actor_id=owner.id,
                        )
                    )
                else:
                    membership.role = "owner"
            else:
                project.created_by_actor_id = None
                project.creator_display_name = project.creator_display_name or "Legacy Import"
                project.is_legacy_unclaimed = True

            align_tree = (
                db.query(models.AlignTree)
                .filter(models.AlignTree.project_id == project.id, models.AlignTree.deleted_at.is_(None))
                .order_by(models.AlignTree.is_default.desc(), models.AlignTree.created_at, models.AlignTree.id)
                .first()
            )
            if align_tree is None:
                align_tree = models.AlignTree(
                    project_id=project.id,
                    name=project.name,
                    description=project.description,
                    created_by_actor_id=owner.id if owner else None,
                    revision=project.revision,
                    is_default=True,
                )
                db.add(align_tree)
                db.flush()
            elif not align_tree.is_default:
                align_tree.is_default = True

            for graph_model in (
                models.Layer,
                models.LayerRelation,
                models.GraphLayout,
                models.ShapeStyle,
                models.TextBox,
            ):
                (
                    db.query(graph_model)
                    .filter(graph_model.project_id == project.id, graph_model.align_tree_id.is_(None))
                    .update({graph_model.align_tree_id: align_tree.id}, synchronize_session=False)
                )

            now = datetime.now(timezone.utc)
            for grant in db.query(models.ProjectAccess).filter(models.ProjectAccess.project_id == project.id).all():
                if not _legacy_grant_is_active(grant, now):
                    continue
                membership = (
                    db.query(models.ProjectMember)
                    .filter(
                        models.ProjectMember.project_id == project.id,
                        models.ProjectMember.actor_id == grant.actor_id,
                    )
                    .one_or_none()
                )
                candidate = grant.permission if grant.permission in {"viewer", "editor"} else "viewer"
                if membership is None:
                    db.add(
                        models.ProjectMember(
                            project_id=project.id,
                            actor_id=grant.actor_id,
                            role=candidate,
                            added_by_actor_id=owner.id if owner else None,
                        )
                    )
                elif membership.role != "owner":
                    membership.role = _strongest_member_role(membership.role, candidate)

            ensure_project_reference_data(db, project.id, remap_existing_graph=True)
            if migration_event is None:
                record_project_event(
                    db,
                    project_id=project.id,
                    actor=None,
                    event_type="project.migrated_v2",
                    target_type="project",
                    target_id=project.id,
                    summary="Migrated legacy project into the project and Align Tree workspace model",
                    align_tree_id=align_tree.id,
                    details={"legacy_unclaimed": bool(project.is_legacy_unclaimed)},
                )
        db.commit()


def run_local_dev_migrations(target_engine: Engine | None = None) -> None:
    """Idempotently migrate the local SQLite workspace without deleting data."""

    active_engine = target_engine or engine
    models.Base.metadata.create_all(bind=active_engine)
    _add_timestamp_columns(active_engine)
    _add_actor_columns(active_engine)
    _add_project_columns(active_engine)
    _rebuild_scoped_tables(active_engine)
    models.Base.metadata.create_all(bind=active_engine)
    _migrate_project_rows(active_engine)
