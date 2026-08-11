# RIC 운영 가이드

## Database migration

서버 시작 시 `RUN_DATABASE_MIGRATIONS=true`이면 Alembic migration을 `head`까지 적용한다.

- 새 DB: `0001_baseline`이 전체 스키마를 생성한다.
- Alembic 도입 전 DB: 기존 무손실 보정 작업을 한 번 실행한 뒤 baseline으로 stamp한다.
- 이후 스키마 변경: 반드시 새 revision을 추가한다.

수동 확인과 적용:

```powershell
cd backend
python -m alembic current
python -m alembic upgrade head
python -m alembic revision --autogenerate -m "describe change"
```

baseline downgrade는 전체 프로젝트 데이터 삭제를 막기 위해 의도적으로 지원하지 않는다.

## Health checks

- `GET /api/health`: 프로세스가 요청에 응답하는지만 확인한다.
- `GET /api/ready`: DB 연결, Alembic revision, 기본 기준정보를 확인한다.

배포 시스템은 readiness가 HTTP 200일 때만 사용자 트래픽을 전달해야 한다.

## SQLite backup and restore

기본 보관 기간은 30일이다. SQLite backup API를 사용하므로 WAL 사용 중에도 일관된 복사본을 만든다.

```powershell
cd backend
python scripts/database.py backup --directory backups --retention-days 30
python scripts/database.py verify backups/ric-20260101T000000Z.db
```

복원할 때는 서버를 먼저 중지한다. 복원 직전 현재 DB가 `pre-restore-*.db`로 자동 백업된다.

```powershell
cd backend
python scripts/database.py restore backups/ric-20260101T000000Z.db --confirm RESTORE
python -m alembic current
python -m alembic upgrade head
```

작업 스케줄러에서 매일 `backup` 명령을 실행하고, 백업 디렉터리는 애플리케이션 서버와 다른 디스크 또는 백업 저장소로 복제한다.

## PostgreSQL backup and restore

SQLite에서 빈 PostgreSQL로 최초 이관:

```powershell
$env:PYTHONPATH = "backend"
$env:POSTGRES_DATABASE_URL = "postgresql+psycopg://ric:ric@localhost:5432/ric"
backend\.venv\Scripts\python.exe backend\scripts\database.py migrate-postgres --source-url "sqlite:///./ric-dev.db" --confirm MIGRATE
```

명령은 SQLite 백업 생성, 대상 Alembic migration, 데이터 복사, 테이블별 행 수 검증을 순서대로 수행한다. 대상 애플리케이션 테이블에 한 행이라도 있으면 중단한다. 성공 후 `.env`의 `DATABASE_URL`을 PostgreSQL URL로 변경하고 `/api/ready`를 확인한다.

운영 PostgreSQL에서는 공급자 snapshot과 `pg_dump`를 함께 사용한다. 비밀번호는 명령행에 넣지 않고 `.pgpass` 또는 secret 환경변수를 사용한다.

```bash
pg_dump --format=custom --file=ric-$(date -u +%Y%m%dT%H%M%SZ).dump "$DATABASE_URL"
pg_restore --list ric-20260101T000000Z.dump > /dev/null
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" ric-20260101T000000Z.dump
alembic upgrade head
```

복구 절차는 별도 테스트 DB에서 정기적으로 검증한다.

## Production HTTPS

`deploy/nginx.conf.example`은 HTTP를 HTTPS로 전환하고 `/api`를 FastAPI로 프록시하는 예시다. 인증서 경로와 도메인을 실제 값으로 변경한다.

production 시작 조건:

- `ENVIRONMENT=production`
- 강한 `IDENTITY_SECRET`
- `IDENTITY_COOKIE_SECURE=true`
- `CORS_ORIGINS`는 HTTPS origin만 지정
- HTTP를 허용하는 `CORS_ORIGIN_REGEX` 제거
- 프록시 사용 시 `TRUST_PROXY_HEADERS=true`와 정확한 `TRUSTED_PROXY_IPS` 설정

조건을 만족하지 않으면 서버가 시작을 거부한다. 쿠키는 `HttpOnly`, `Secure`, `SameSite=Lax`로 설정된다.
