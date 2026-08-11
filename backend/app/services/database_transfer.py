from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import DateTime, Engine, Table, and_, create_engine, func, inspect, select
from sqlalchemy.engine import make_url

from ..database import Base
from .database_backup import sqlite_database_path
from .migrations import migration_status, upgrade_database


@dataclass(frozen=True)
class TransferReport:
    table_counts: dict[str, int]

    @property
    def total_rows(self) -> int:
        return sum(self.table_counts.values())


def migrate_sqlite_to_postgres(source_url: str, target_url: str) -> TransferReport:
    source_driver = make_url(source_url).drivername
    target_driver = make_url(target_url).drivername
    if not source_driver.startswith("sqlite"):
        raise ValueError("Source database must be SQLite")
    if not target_driver.startswith("postgresql"):
        raise ValueError("Target database must be PostgreSQL")
    source_path = sqlite_database_path(source_url)
    if not source_path.is_file():
        raise FileNotFoundError(f"SQLite source database does not exist: {source_path}")

    source_engine = create_engine(source_url)
    target_engine = create_engine(target_url, pool_pre_ping=True)
    try:
        if not migration_status(source_engine).ready:
            raise RuntimeError("Source SQLite schema is not at the current Alembic revision")
        _assert_target_empty(target_engine, list(Base.metadata.tables.values()))
        upgrade_database(target_engine)
        return transfer_database(source_engine, target_engine)
    finally:
        source_engine.dispose()
        target_engine.dispose()


def transfer_database(source_engine: Engine, target_engine: Engine) -> TransferReport:
    """Copy the current application schema into an empty migrated database."""
    tables = list(Base.metadata.tables.values())
    expected_names = {table.name for table in tables}
    source_names = set(inspect(source_engine).get_table_names())
    target_names = set(inspect(target_engine).get_table_names())
    missing_source = expected_names - source_names
    missing_target = expected_names - target_names
    if missing_source:
        raise RuntimeError(f"Source database is missing tables: {', '.join(sorted(missing_source))}")
    if missing_target:
        raise RuntimeError(f"Target database is missing tables: {', '.join(sorted(missing_target))}")

    ordered_tables = _copy_order(tables)
    source_counts = _table_counts(source_engine, ordered_tables)
    target_counts = _table_counts(target_engine, ordered_tables)
    occupied = {name: count for name, count in target_counts.items() if count}
    if occupied:
        details = ", ".join(f"{name}={count}" for name, count in sorted(occupied.items()))
        raise RuntimeError(f"Target database must be empty; found rows in {details}")

    copied_tables: set[str] = set()
    deferred_updates: list[tuple[Table, dict[str, object], dict[str, object]]] = []
    with source_engine.connect() as source, target_engine.begin() as target:
        for table in ordered_tables:
            rows = [dict(row) for row in source.execute(select(table)).mappings()]
            prepared_rows: list[dict[str, object]] = []
            for row in rows:
                row = _normalize_datetimes(table, row)
                deferred_values: dict[str, object] = {}
                for column in table.columns:
                    if row.get(column.name) is None or not column.nullable or not column.foreign_keys:
                        continue
                    referred_tables = {foreign_key.column.table.name for foreign_key in column.foreign_keys}
                    if table.name in referred_tables or not referred_tables.issubset(copied_tables):
                        deferred_values[column.name] = row[column.name]
                        row[column.name] = None
                if deferred_values:
                    primary_key = {column.name: row[column.name] for column in table.primary_key.columns}
                    deferred_updates.append((table, primary_key, deferred_values))
                prepared_rows.append(row)
            if prepared_rows:
                target.execute(table.insert(), prepared_rows)
            copied_tables.add(table.name)

        for table, primary_key, values in deferred_updates:
            predicate = and_(*(table.c[name] == value for name, value in primary_key.items()))
            target.execute(table.update().where(predicate).values(**values))

        copied_counts = {
            table.name: target.execute(select(func.count()).select_from(table)).scalar_one()
            for table in ordered_tables
        }
        if copied_counts != source_counts:
            raise RuntimeError("Row-count verification failed; target transaction was rolled back")

    return TransferReport(table_counts=source_counts)


def _copy_order(tables: list[Table]) -> list[Table]:
    by_name = {table.name: table for table in tables}
    dependencies: dict[str, set[str]] = {}
    for table in tables:
        dependencies[table.name] = {
            foreign_key.column.table.name
            for column in table.columns
            if not column.nullable
            for foreign_key in column.foreign_keys
            if foreign_key.column.table.name != table.name
        }

    ordered: list[Table] = []
    remaining = set(by_name)
    while remaining:
        ready = sorted(name for name in remaining if not (dependencies[name] & remaining))
        if not ready:
            raise RuntimeError(f"Non-nullable foreign-key cycle: {', '.join(sorted(remaining))}")
        ordered.extend(by_name[name] for name in ready)
        remaining.difference_update(ready)
    return ordered


def _assert_target_empty(engine: Engine, tables: list[Table]) -> None:
    existing_names = set(inspect(engine).get_table_names())
    existing_tables = [table for table in tables if table.name in existing_names]
    occupied = {name: count for name, count in _table_counts(engine, existing_tables).items() if count}
    if occupied:
        details = ", ".join(f"{name}={count}" for name, count in sorted(occupied.items()))
        raise RuntimeError(f"Target database must be empty; found rows in {details}")


def _table_counts(engine: Engine, tables: list[Table]) -> dict[str, int]:
    with engine.connect() as connection:
        return {
            table.name: connection.execute(select(func.count()).select_from(table)).scalar_one()
            for table in tables
        }


def _normalize_datetimes(table: Table, row: dict[str, object]) -> dict[str, object]:
    for column in table.columns:
        value = row.get(column.name)
        if isinstance(column.type, DateTime) and column.type.timezone and isinstance(value, datetime):
            if value.tzinfo is None:
                row[column.name] = value.replace(tzinfo=UTC)
    return row
