# RIC 초기 저장소 분석

분석 기준은 `Woojoonseok/RIC`의 초기 코드와 2026-07-15에 제공된 Vue 3 재구축 명세다. 충돌 시 제공 명세를 우선한다.

## 저장소 구조와 실행 환경

| 영역 | 초기 저장소 | 실행/설정 |
| --- | --- | --- |
| React UI | `frontend/` | `npm install`, `npm run dev`, Vite 5173 |
| 신규 Vue UI | `frontend-vue/` | 이번 재구축에서 추가 |
| API | `backend/app/` | `uvicorn app.main:app --app-dir backend --reload`, 8000 |
| DB | 저장소 루트 `ric-dev.db` | 기본 SQLite, `DATABASE_URL`로 PostgreSQL 지원 |
| 레거시 시제품 | `index.html`, `styles.css`, `app.js` | 정적 참고 자료 |
| 환경변수 | `.env.example` | `DATABASE_URL`, `CORS_ORIGINS`, `VITE_API_BASE_URL` |
| PostgreSQL | `docker-compose.yml` | PostgreSQL 16, `ric` DB/계정 |

백엔드는 FastAPI, SQLAlchemy 2.0 형식의 typed mapping, Pydantic v2를 사용한다. 초기 React는 하나의 큰 `App.tsx`에 상태와 도메인 계산이 집중돼 있으며, Canvas 자체는 별도 `CanvasEditor.tsx`로 분리돼 있다.

## 초기 기능 분류

| 기능 | 초기 상태 | 비고 |
| --- | --- | --- |
| 프로젝트 관리 | 구현됨 | 생성·목록·조회·삭제 |
| Layer CRUD | 구현됨 | description, preset 참조, pending_group 누락 |
| Relation CRUD | 부분 구현 | waypoint/attachment 필드는 있으나 instance와 nullable draft 누락 |
| SVG Canvas | 부분 구현 | 선택·이동·리사이즈·pan/zoom·port·minimap 구현, 고급 attachment 편집 보강 필요 |
| 자동 배치 | 부분 구현 | DAG rank와 same_group 위치 일치 구현, 명세 상수와 연결요소 rank 보강 필요 |
| Validation | 부분 구현 | 주요 오류 구현, group-to-group 및 draft 처리 누락 |
| Export | 부분 구현 | XLS/SVG/PowerPoint 호환 outline, 실제 pptxgenjs PPTX 필요 |
| 기준정보 | 구조 다름 | relation style과 box preset이 프로젝트 종속, 기타 기준정보 없음 |
| Layer Master | 미구현 | 모델·API·동적 우선순위 UI 모두 필요 |
| 그룹/병합 | 부분 구현 | same_group 표시는 있으나 merge 허용 규칙과 pending 승격 보강 필요 |
| Undo/Redo | 구현됨 | Graph restore API 기반, React 로컬 스택 40개 |

## 최신 명세 차이표

| 기능 | 초기 GitHub 상태 | 최신 명세 요구 | 필요한 작업 | 위험도 |
| --- | --- | --- | --- | --- |
| DB 스키마 | 핵심 graph 테이블 중심 | 13개 최종 엔터티 | 모델 확장 및 개발 DB 마이그레이션 | 높음 |
| relation_styles | project_id 소유 | 전역 CRUD | 전역화, graph read 참조 | 높음 |
| box_presets | project_id 소유 | 전역 CRUD, default 1개 | 전역화, Layer에 preset FK | 높음 |
| layer_masters | 없음 | snapshot 생성 지원 | 모델·CRUD·UI 신규 구현 | 높음 |
| layer_master_priorities | 없음 | Key Layout Type별 동적 dict | 모델·응답 변환·동적 grid | 높음 |
| pending_group | 없음 | 짝 생성 시 same_group 승격 | Layer 필드·group service | 중간 |
| same_group | relation 필드 및 표시 있음 | 비파괴 그룹, 엄격 merge/split | 규칙 검증과 확장 저장 보강 | 높음 |
| attached_relation_id | DB 필드 있음 | 최근접점·재귀·cycle guard | geometry 도메인과 Canvas 편집 보강 | 높음 |
| waypoints | DB 필드 있음 | 추가·이동·삭제 | restore/merge/split 보존 및 UI 완성 | 중간 |
| relation instance | 없음 | 중복 키에 포함 | DB/API/validation/UI 추가 | 높음 |
| text_boxes | 구현됨 | Canvas 이동·크기변경·CRUD | Vue 이식 및 batch 저장 | 낮음 |
| GraphRestore | 구현됨 | 전체 Graph 서버 복원 | 전역 기준정보 제외, validation 원자성 보강 | 중간 |
| GraphBatchUpdate | 구현됨 | layout/style/text 일괄 갱신 | 그룹 멤버 확장 저장 보강 | 중간 |
| SpreadsheetGrid | 단순 editable grid | Excel 수준 상호작용 | 재사용 Vue 컴포넌트 신규 구현 | 높음 |
| Vue 상태 | React useState 집중 | Pinia 상태/getter/action | 도메인 로직 분리 및 store 이식 | 높음 |

## 백엔드 전략

기존 API의 graph mutation 구현은 재사용 가치가 크지만 기준정보와 핵심 관계 스키마가 다르다. 따라서 모델·schema·reference/Layer Master 영역은 최종 명세대로 재구축하고, 검증된 graph CRUD/restore/merge/split 구현은 최종 모델에 맞춰 확장한다. 초기 프로젝트별 `/graph/relation-styles`, `/graph/box-presets`는 최종 전역 `/api/reference/*`로 대체하며 신규 Vue UI는 최종 URL만 사용한다.
