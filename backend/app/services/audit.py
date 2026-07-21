from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from .. import models


def record_project_event(
    db: Session,
    *,
    project_id: uuid.UUID,
    actor: models.Actor | None,
    event_type: str,
    target_type: str,
    summary: str,
    align_tree_id: uuid.UUID | None = None,
    target_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> models.ProjectAuditEvent:
    """Append an audit row to the caller's current transaction.

    Callers own commit/rollback so the event and its business mutation are
    atomic. Secrets, raw IPs, cookies, and share/lease tokens must never be
    passed in ``details``.
    """

    event = models.ProjectAuditEvent(
        project_id=project_id,
        align_tree_id=align_tree_id,
        actor_id=actor.id if actor else None,
        actor_label_snapshot=actor.display_name if actor else "System",
        event_type=event_type,
        target_type=target_type,
        target_id=target_id,
        summary=summary[:500],
        details_json=details or {},
        request_id=request_id,
    )
    db.add(event)
    return event
