from collections.abc import Generator

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


_IPV4_OCTET = r"(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])"
_DEFAULT_CORS_ORIGIN_REGEX = (
    rf"^https?://(?:localhost|127\.0\.0\.1|"
    rf"10\.{_IPV4_OCTET}\.{_IPV4_OCTET}\.{_IPV4_OCTET}|"
    rf"192\.168\.{_IPV4_OCTET}\.{_IPV4_OCTET}|"
    rf"172\.(?:1[6-9]|2[0-9]|3[01])\.{_IPV4_OCTET}\.{_IPV4_OCTET}):5173$"
)
_DEFAULT_IDENTITY_SECRET = "ric-local-dev-identity-secret-change-me"
_INSECURE_IDENTITY_SECRETS = {
    _DEFAULT_IDENTITY_SECRET,
    "replace-with-a-random-64-character-secret",
}


class Settings(BaseSettings):
    database_url: str = "sqlite:///./ric-dev.db"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Credentials are enabled, so this must remain a strict full-origin
    # pattern. It intentionally permits only the Vite dev port on loopback or
    # RFC1918 private IPv4 ranges, never a wildcard such as ``.*``.
    cors_origin_regex: str = _DEFAULT_CORS_ORIGIN_REGEX
    identity_secret: str = _DEFAULT_IDENTITY_SECRET
    identity_cookie_name: str = "ric_actor"
    identity_cookie_secure: bool = False
    identity_cookie_max_age_seconds: int = 60 * 60 * 24 * 365
    trust_proxy_headers: bool = False
    trusted_proxy_ips: str = "127.0.0.1,::1"
    allow_legacy_project_claims: bool = False
    edit_lease_ttl_seconds: int = 90

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()


def validate_identity_secret(secret: str) -> None:
    """Fail startup before cookies/IP HMACs are signed with a weak secret."""

    if secret in _INSECURE_IDENTITY_SECRETS or len(secret.encode("utf-8")) < 32:
        raise RuntimeError(
            "IDENTITY_SECRET must be a non-default random secret of at least 32 bytes"
        )
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
