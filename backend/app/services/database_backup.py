from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy.engine import make_url


def sqlite_database_path(database_url: str) -> Path:
    url = make_url(database_url)
    if not url.drivername.startswith("sqlite") or not url.database or url.database == ":memory:":
        raise ValueError("This operation requires a file-backed SQLite DATABASE_URL")
    return Path(url.database).expanduser().resolve()


def verify_sqlite_backup(path: Path) -> dict[str, str]:
    candidate = path.expanduser().resolve()
    if not candidate.is_file():
        raise FileNotFoundError(f"Backup file not found: {candidate}")
    with sqlite3.connect(f"file:{candidate.as_posix()}?mode=ro", uri=True) as connection:
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
        if integrity.lower() != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")
        version_table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='alembic_version'"
        ).fetchone()
        revision = "unversioned"
        if version_table:
            row = connection.execute("SELECT version_num FROM alembic_version LIMIT 1").fetchone()
            revision = str(row[0]) if row else "missing"
    return {"integrity": integrity, "revision": revision}


def backup_sqlite_database(database_url: str, destination: Path) -> Path:
    source = sqlite_database_path(database_url)
    if not source.is_file():
        raise FileNotFoundError(f"Database file not found: {source}")
    target = destination.expanduser().resolve()
    if target == source:
        raise ValueError("Backup destination must be different from the active database")
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source) as source_db, sqlite3.connect(target) as target_db:
        source_db.backup(target_db)
    verify_sqlite_backup(target)
    return target


def timestamped_backup_path(directory: Path, prefix: str = "ric") -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return directory.expanduser().resolve() / f"{prefix}-{stamp}.db"


def prune_sqlite_backups(directory: Path, retention_days: int, prefix: str = "ric") -> list[Path]:
    if retention_days < 1:
        raise ValueError("retention_days must be at least 1")
    root = directory.expanduser().resolve()
    if not root.exists():
        return []
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    removed: list[Path] = []
    for candidate in root.glob(f"{prefix}-*.db"):
        modified = datetime.fromtimestamp(candidate.stat().st_mtime, UTC)
        if modified < cutoff:
            candidate.unlink()
            removed.append(candidate)
    return removed


def restore_sqlite_database(database_url: str, backup_path: Path, safety_directory: Path) -> Path:
    source = backup_path.expanduser().resolve()
    verify_sqlite_backup(source)
    destination = sqlite_database_path(database_url)
    safety_backup = timestamped_backup_path(safety_directory, prefix="pre-restore")
    if destination.exists():
        backup_sqlite_database(database_url, safety_backup)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source) as source_db, sqlite3.connect(destination) as destination_db:
        source_db.backup(destination_db)
    verify_sqlite_backup(destination)
    return safety_backup
