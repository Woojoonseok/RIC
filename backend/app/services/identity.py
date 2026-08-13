from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import uuid
from datetime import datetime, timezone

from fastapi import Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db, settings


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _canonical_ip(value: str | None) -> str:
    raw = (value or "unknown").strip()
    try:
        parsed = ipaddress.ip_address(raw)
        if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped:
            parsed = parsed.ipv4_mapped
        return parsed.compressed
    except ValueError:
        # ASGI test transports use values such as ``testclient``. They are
        # still HMACed and never persisted in clear text.
        return raw.lower() or "unknown"


def _strict_ip(value: str) -> str | None:
    """Parse a proxy-provided IP without accepting hostnames or free text."""

    candidate = value.strip()
    if candidate.startswith("[") and candidate.endswith("]"):
        candidate = candidate[1:-1]
    try:
        parsed = ipaddress.ip_address(candidate)
    except ValueError:
        return None
    if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped:
        parsed = parsed.ipv4_mapped
    return parsed.compressed


def client_ip(request: Request) -> str:
    peer = _canonical_ip(request.client.host if request.client else None)
    trusted = {_canonical_ip(item) for item in settings.trusted_proxy_ips.split(",") if item.strip()}
    if not settings.trust_proxy_headers or peer not in trusted:
        return peer

    # Vite's ``xfwd`` proxy appends the direct LAN peer to X-Forwarded-For.
    # Earlier entries can be supplied by the raw client, so using the first
    # value would let a caller spoof the auxiliary IP-HMAC. This deployment
    # has one trusted proxy; its appended final value is therefore authoritative.
    # ``Forwarded`` is deliberately ignored because Vite does not sanitize it.
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        forwarded_ip = _strict_ip(forwarded_for.rsplit(",", 1)[-1])
        if forwarded_ip is not None:
            return forwarded_ip
    return peer


def hmac_subject(value: str) -> str:
    return hmac.new(settings.identity_secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def hash_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def is_system_admin(actor: models.Actor | uuid.UUID) -> bool:
    actor_id = actor.id if isinstance(actor, models.Actor) else actor
    configured = {value.strip().lower() for value in settings.system_admin_actor_ids.split(",") if value.strip()}
    return str(actor_id).lower() in configured


def _cookie_signature(actor_id: uuid.UUID) -> str:
    digest = hmac.new(
        settings.identity_secret.encode("utf-8"), str(actor_id).encode("ascii"), hashlib.sha256
    ).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _encode_actor_cookie(actor_id: uuid.UUID) -> str:
    return f"{actor_id}.{_cookie_signature(actor_id)}"


def _decode_actor_cookie(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    raw_id, separator, signature = value.partition(".")
    if not separator:
        return None
    try:
        actor_id = uuid.UUID(raw_id)
    except ValueError:
        return None
    if not hmac.compare_digest(signature, _cookie_signature(actor_id)):
        return None
    return actor_id


def _set_actor_cookie(response: Response, actor_id: uuid.UUID) -> None:
    response.set_cookie(
        key=settings.identity_cookie_name,
        value=_encode_actor_cookie(actor_id),
        max_age=settings.identity_cookie_max_age_seconds,
        httponly=True,
        secure=settings.identity_cookie_secure,
        samesite="lax",
        path="/",
    )


def get_current_actor(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> models.Actor:
    ip_hash = hmac_subject(client_ip(request))
    cookie_actor_id = _decode_actor_cookie(request.cookies.get(settings.identity_cookie_name))
    actor = db.get(models.Actor, cookie_actor_id) if cookie_actor_id else None

    if actor is None:
        # A missing browser cookie should not make a returning user lose their
        # project memberships. Recover the most recently seen Actor for the
        # same server-derived IP before creating a new anonymous identity.
        actor = db.scalar(
            select(models.Actor)
            .where(models.Actor.last_ip_hash == ip_hash)
            .order_by(models.Actor.last_seen_at.desc(), models.Actor.created_at.desc())
            .limit(1)
        )

        if actor is None:
            actor_id = uuid.uuid4()
            actor = models.Actor(
                id=actor_id,
                display_name=f"Anonymous {str(actor_id)[:8].upper()}",
                last_ip_hash=ip_hash,
            )
            db.add(actor)
            db.commit()
        else:
            actor.last_seen_at = _utcnow()
            db.commit()
    else:
        actor.last_ip_hash = ip_hash
        actor.last_seen_at = _utcnow()
        db.commit()

    _set_actor_cookie(response, actor.id)
    # Request-scoped services that build nested graph responses can recover
    # the access role without threading Actor through every legacy helper.
    db.info["current_actor_id"] = actor.id
    return actor


def require_system_admin(actor: models.Actor = Depends(get_current_actor)) -> models.Actor:
    if not is_system_admin(actor):
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System administrator access is required")
    return actor
