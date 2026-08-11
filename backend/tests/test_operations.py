from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, select

from app import models
from app.database import Settings, validate_runtime_settings
from app.services.database_backup import (
    backup_sqlite_database,
    restore_sqlite_database,
    verify_sqlite_backup,
)
from app.services.migrations import migration_status, upgrade_database
from app.services.database_transfer import transfer_database


def test_fresh_and_existing_databases_reach_alembic_head(tmp_path: Path) -> None:
    fresh_engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    upgrade_database(fresh_engine)
    assert migration_status(fresh_engine).ready
    assert "projects" in inspect(fresh_engine).get_table_names()

    legacy_path = tmp_path / "legacy.db"
    with sqlite3.connect(legacy_path) as connection:
        connection.execute("CREATE TABLE legacy_probe (id INTEGER PRIMARY KEY)")
    legacy_engine = create_engine(f"sqlite:///{legacy_path}")
    upgrade_database(legacy_engine)
    assert migration_status(legacy_engine).ready
    assert "legacy_probe" in inspect(legacy_engine).get_table_names()
    assert "projects" in inspect(legacy_engine).get_table_names()


def test_sqlite_backup_verify_and_restore(tmp_path: Path) -> None:
    database = tmp_path / "active.db"
    database_url = f"sqlite:///{database}"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE sample (value TEXT NOT NULL)")
        connection.execute("INSERT INTO sample VALUES ('before')")

    backup = backup_sqlite_database(database_url, tmp_path / "backups" / "ric-test.db")
    assert verify_sqlite_backup(backup)["integrity"] == "ok"

    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE sample SET value='after'")
    safety = restore_sqlite_database(database_url, backup, tmp_path / "safety")
    assert safety.is_file()
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT value FROM sample").fetchone()[0] == "before"


def test_backup_rejects_non_sqlite_database(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="SQLite"):
        backup_sqlite_database("postgresql://localhost/ric", tmp_path / "backup.db")


def test_database_transfer_copies_rows_and_restores_self_reference(tmp_path: Path) -> None:
    source_engine = create_engine(f"sqlite:///{tmp_path / 'source.db'}")
    target_engine = create_engine(f"sqlite:///{tmp_path / 'target.db'}")
    upgrade_database(source_engine)
    upgrade_database(target_engine)

    actor_id = uuid.uuid4()
    project_id = uuid.uuid4()
    tree_id = uuid.uuid4()
    thread_id = uuid.uuid4()
    comment_id = uuid.uuid4()
    with source_engine.begin() as connection:
        connection.execute(models.Actor.__table__.insert(), {"id": actor_id, "display_name": "Migrated user"})
        connection.execute(
            models.Project.__table__.insert(),
            {
                "id": project_id,
                "name": "Migrated project",
                "creator_display_name": "Migrated user",
                "owner_actor_id": actor_id,
            },
        )
        connection.execute(
            models.AlignTree.__table__.insert(),
            {"id": tree_id, "project_id": project_id, "name": "Default tree"},
        )
        connection.execute(
            models.ReviewThread.__table__.insert(),
            {
                "id": thread_id,
                "project_id": project_id,
                "align_tree_id": tree_id,
                "target_type": "canvas",
                "target_label": "Canvas",
            },
        )
        connection.execute(
            models.ReviewComment.__table__.insert(),
            {
                "id": comment_id,
                "thread_id": thread_id,
                "parent_comment_id": comment_id,
                "author_actor_id": actor_id,
                "author_label": "Migrated user",
                "body": "Keep the reference",
            },
        )

    report = transfer_database(source_engine, target_engine)

    assert report.total_rows == 5
    with target_engine.connect() as connection:
        migrated_parent = connection.execute(
            select(models.ReviewComment.parent_comment_id).where(models.ReviewComment.id == comment_id)
        ).scalar_one()
    assert migrated_parent == comment_id


def test_database_transfer_rejects_nonempty_target(tmp_path: Path) -> None:
    source_engine = create_engine(f"sqlite:///{tmp_path / 'source.db'}")
    target_engine = create_engine(f"sqlite:///{tmp_path / 'target.db'}")
    upgrade_database(source_engine)
    upgrade_database(target_engine)
    with target_engine.begin() as connection:
        connection.execute(
            models.Actor.__table__.insert(),
            {"id": uuid.uuid4(), "display_name": "Existing target user"},
        )

    with pytest.raises(RuntimeError, match="Target database must be empty"):
        transfer_database(source_engine, target_engine)


def production_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": "production",
        "identity_secret": "production-secret-with-at-least-32-bytes",
        "identity_cookie_secure": True,
        "cors_origins": "https://ric.example.com",
        "cors_origin_regex": "",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_production_settings_require_https_and_secure_cookie() -> None:
    validate_runtime_settings(production_settings())
    with pytest.raises(RuntimeError, match="IDENTITY_COOKIE_SECURE"):
        validate_runtime_settings(production_settings(identity_cookie_secure=False))
    with pytest.raises(RuntimeError, match="HTTPS origins"):
        validate_runtime_settings(production_settings(cors_origins="http://ric.example.com"))
    with pytest.raises(RuntimeError, match="plain HTTP"):
        validate_runtime_settings(production_settings(cors_origin_regex="^https?://ric.example.com$"))
