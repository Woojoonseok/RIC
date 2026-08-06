# RIC Align Tree Editor

Align Tree를 설계·편집·검증하고 Excel, SVG, PPTX로 내보내는 웹 애플리케이션이다. 최신 UI는 Vue 3로 구현하며, 초기 React UI는 비교와 회귀 참고를 위해 `frontend/`에 유지한다.

## 구조

```text
backend/        FastAPI + SQLAlchemy 2.0 + Pydantic v2
frontend/       초기 React + Vite 참고 구현
frontend-vue/   최종 Vue 3 + TypeScript + Pinia 구현
docs/           초기 코드 분석, 차이표, 구현 가정
```

## 로컬 실행

Python 3.11 이상과 Node.js가 필요하다. 기본 DB는 저장소 루트의 `ric-dev.db`다.

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload
```

다른 PowerShell에서 Vue UI를 실행한다.

```powershell
cd frontend-vue
pnpm install
pnpm dev
```

브라우저에서 `http://127.0.0.1:5173`을 연다. API 문서는 `http://127.0.0.1:8000/docs`에서 확인할 수 있다.

## 환경변수

루트의 `.env.example`을 `.env`로 복사하거나 실행 셸에 설정한다.

```text
DATABASE_URL=sqlite:///./ric-dev.db
ENVIRONMENT=development
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
IDENTITY_SECRET=replace-with-a-random-64-character-secret
IDENTITY_COOKIE_SECURE=false
TRUST_PROXY_HEADERS=false
TRUSTED_PROXY_IPS=127.0.0.1,::1
ALLOW_LEGACY_PROJECT_CLAIMS=false
EDIT_LEASE_TTL_SECONDS=90
RUN_DATABASE_MIGRATIONS=true
VITE_API_BASE_URL=http://localhost:8000/api
```

사내 무로그인 운영에서는 서버가 서명한 익명 사용자 쿠키를 기본 식별자로 사용하고, 쿠키가 없거나 유효하지 않으면 동일한 접속 IP의 가장 최근 익명 사용자를 복구한다. 접속 IP는 평문 대신 `IDENTITY_SECRET`으로 HMAC 처리해 저장한다. 서버는 기본값이나 32바이트 미만의 `IDENTITY_SECRET`이면 시작하지 않으므로 반드시 임의의 강한 값을 지정해야 한다. 리버스 프록시를 둘 때만 `TRUST_PROXY_HEADERS=true`로 바꾸고 해당 프록시 주소를 `TRUSTED_PROXY_IPS`에 등록한다.

Legacy 프로젝트 수동 귀속은 기본적으로 비활성화되어 있으며, 필요한 경우에만 서버를 외부에 열기 전에 `ALLOW_LEGACY_PROJECT_CLAIMS=true`를 잠시 사용한다. 향후 AD SSO를 도입할 때는 기존 내부 Actor에 AD identity를 연결해 프로젝트 소유권과 공유 권한을 유지한다. 현재의 비보안 쿠키 설정은 임시 사내 HTTP 환경 전용이다. **AD SSO 도입 또는 production 배포 전에는 TLS(HTTPS)를 반드시 적용하고 `IDENTITY_COOKIE_SECURE=true`로 설정해야 한다.**

PostgreSQL 사용 시:

```powershell
docker compose up -d db
python -m pip install -e "backend[postgres]"
$env:DATABASE_URL = "postgresql+psycopg://ric:ric@localhost:5432/ric"
python -m uvicorn app.main:app --app-dir backend --reload
```

## 구현된 주요 기능

- 프로젝트 CRUD와 전체 Graph restore/batch update
- 전역 Key Layout Type, Key Drawing Type, Key Shape, Relation Style, Box Preset CRUD
- 동적 우선순위가 있는 Layer Master CRUD와 프로젝트 Layer snapshot 생성
- Layer, Relation, Text Box CRUD와 nullable draft relation
- `instance`, `waypoints`, `attached_relation_id`, `pending_group`, `same_group`
- 비파괴 그룹 표시, 1:N/N:1 관계 확장, merge/split, 그룹 layout/style 확장 저장
- 서버 Validation과 DAG 자동 배치
- Pinia 기반 raw/display graph 분리와 서버 restore 기반 Undo/Redo
- SVG Canvas 선택·marquee·pan·zoom·이동·리사이즈·port 연결·waypoint·관계선 attachment·minimap
- Excel식 TSV grid와 commit 단위 저장
- Excel template/export, SVG export, 실제 PPTX export

## 검증

```powershell
$env:PYTHONPATH = "backend"
python -m pytest backend/tests -q
ruff check backend/app backend/tests

cd frontend-vue
pnpm test
pnpm build
```

초기 코드와 최신 명세의 차이는 [docs/INITIAL_ANALYSIS.md](docs/INITIAL_ANALYSIS.md), 명세 밖 구현 판단은 [docs/IMPLEMENTATION_ASSUMPTIONS.md](docs/IMPLEMENTATION_ASSUMPTIONS.md)에 기록돼 있다.

## 배포

Vue의 `dist/`를 정적 호스팅하고 `/api` 요청을 FastAPI로 프록시한다. FastAPI는 PostgreSQL `DATABASE_URL`을 사용해 실행하며, CORS는 실제 프론트 도메인만 `CORS_ORIGINS`에 지정한다. DB 변경은 Alembic으로 관리되며 서버 시작 시 현재 revision까지 적용된다.

CI, readiness, DB 백업·복구, HTTPS와 production 설정은 [운영 가이드](docs/OPERATIONS.md)를 따른다.
