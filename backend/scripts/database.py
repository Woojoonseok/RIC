from __future__ import annotations

import argparse
import os
from pathlib import Path

from app.database import settings
from app.services.database_backup import (
    backup_sqlite_database,
    prune_sqlite_backups,
    restore_sqlite_database,
    timestamped_backup_path,
    verify_sqlite_backup,
)
from app.services.database_transfer import migrate_sqlite_to_postgres


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description="RIC database maintenance utility")
    subcommands = command.add_subparsers(dest="command", required=True)

    backup = subcommands.add_parser("backup", help="Create and verify a consistent SQLite backup")
    backup.add_argument("--directory", type=Path, default=Path("backups"))
    backup.add_argument("--retention-days", type=int, default=30)

    verify = subcommands.add_parser("verify", help="Run SQLite integrity and revision checks")
    verify.add_argument("path", type=Path)

    restore = subcommands.add_parser("restore", help="Restore SQLite after creating a safety backup")
    restore.add_argument("path", type=Path)
    restore.add_argument("--safety-directory", type=Path, default=Path("backups"))
    restore.add_argument("--confirm", required=True, help="Must be exactly RESTORE")

    migrate = subcommands.add_parser("migrate-postgres", help="Copy SQLite data into empty PostgreSQL")
    migrate.add_argument("--source-url", default=settings.database_url)
    migrate.add_argument("--target-url", default=os.environ.get("POSTGRES_DATABASE_URL"))
    migrate.add_argument("--backup-directory", type=Path, default=Path("backups"))
    migrate.add_argument("--confirm", required=True, help="Must be exactly MIGRATE")
    return command


def main() -> None:
    args = parser().parse_args()
    if args.command == "backup":
        destination = timestamped_backup_path(args.directory)
        created = backup_sqlite_database(settings.database_url, destination)
        removed = prune_sqlite_backups(args.directory, args.retention_days)
        print(f"Backup created: {created}")
        print(f"Expired backups removed: {len(removed)}")
        return
    if args.command == "verify":
        result = verify_sqlite_backup(args.path)
        print(f"Backup verified: integrity={result['integrity']} revision={result['revision']}")
        return
    if args.command == "migrate-postgres":
        if args.confirm != "MIGRATE":
            raise SystemExit("Migration cancelled: pass --confirm MIGRATE")
        if not args.target_url:
            raise SystemExit("Set POSTGRES_DATABASE_URL or pass --target-url")
        backup = backup_sqlite_database(
            args.source_url,
            timestamped_backup_path(args.backup_directory),
        )
        report = migrate_sqlite_to_postgres(args.source_url, args.target_url)
        print(f"Migration completed: {report.total_rows} rows across {len(report.table_counts)} tables")
        print(f"Source backup: {backup}")
        return
    if args.confirm != "RESTORE":
        raise SystemExit("Restore cancelled: pass --confirm RESTORE")
    safety_backup = restore_sqlite_database(settings.database_url, args.path, args.safety_directory)
    print(f"Restore completed. Previous database backup: {safety_backup}")


if __name__ == "__main__":
    main()
