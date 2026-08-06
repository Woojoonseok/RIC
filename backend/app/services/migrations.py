from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, inspect

from ..database import engine, settings
from .dev_migrations import run_local_dev_migrations

BACKEND_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class MigrationStatus:
    current: tuple[str, ...]
    expected: tuple[str, ...]

    @property
    def ready(self) -> bool:
        return bool(self.current) and set(self.current) == set(self.expected)


def alembic_config() -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
    return config


def _with_connection(active_engine: Engine, operation: Callable[[Config], None]) -> None:
    config = alembic_config()
    with active_engine.begin() as connection:
        config.attributes["connection"] = connection
        operation(config)


def migration_status(active_engine: Engine | None = None) -> MigrationStatus:
    active_engine = active_engine or engine
    config = alembic_config()
    expected = tuple(ScriptDirectory.from_config(config).get_heads())
    if "alembic_version" not in inspect(active_engine).get_table_names():
        return MigrationStatus(current=(), expected=expected)
    with active_engine.connect() as connection:
        current = tuple(MigrationContext.configure(connection).get_current_heads())
    return MigrationStatus(current=current, expected=expected)


def upgrade_database(active_engine: Engine | None = None) -> None:
    active_engine = active_engine or engine
    tables = set(inspect(active_engine).get_table_names()) - {"alembic_version"}
    status = migration_status(active_engine)

    if tables and not status.current:
        # Preserve pre-Alembic local databases: first run the proven idempotent
        # compatibility migration, then mark that schema as the baseline.
        run_local_dev_migrations(active_engine)
        _with_connection(active_engine, lambda config: command.stamp(config, "head"))
    else:
        _with_connection(active_engine, lambda config: command.upgrade(config, "head"))
