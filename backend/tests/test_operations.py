from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect

from app.database import Settings, validate_runtime_settings
from app.services.database_backup import (
    backup_sqlite_database,
    restore_sqlite_database,
    verify_sqlite_backup,
)
from app.services.migrations import migration_status, upgrade_database


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
