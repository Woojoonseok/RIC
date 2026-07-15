# 구현 상태 보고

## 완료한 작업

- 초기 GitHub 저장소 구조·기능·실행환경 분석 및 최신 명세 차이표 작성
- `frontend-vue` Vue 3/Vite/TypeScript/Pinia 기반과 전체 화면 shell 구현
- 최종 13개 엔터티 스키마, 전역 기준정보, Layer Master와 동적 priority 구현
- 프로젝트/Graph/Layer/Relation/TextBox/Reference/Layer Master API 구현
- draft relation, instance, pending_group 승격, same_group merge/split, 그룹 저장 확장 구현
- validation rollback, auto layout, Graph restore/batch, 서버 기반 Undo/Redo 구현
- raw graph를 보존하는 순수 `computeDisplayGraph` 구현
- app/project/graph/reference Pinia Store 분리와 명시적 Read/Write DTO 기반 API client 구현
- 6종 discriminated union drag state와 ghost layout/text/relation 기반 Canvas composable 구현
- attachment cycle guard, AABB marquee, 0.05~0.95 선분 projection, 그룹 관계 1:N/N:1 확장 구현
- SVG Canvas pan/zoom/marquee/move/resize/port/waypoint/relation attachment/minimap/search 구현
- Excel식 범위 선택·키보드·TSV copy/cut/paste·행/열 선택·resize/auto-fit grid 구현
- Excel template/export, SVG export, `pptxgenjs` PPTX export 구현
- 백엔드 통합 테스트, 프론트 도메인 단위 테스트, production build 검증

## 초기 React → Vue 대응

| 초기 React | Vue 3 구현 |
| --- | --- |
| `App.tsx`의 로컬 상태 | `stores/app.ts`, `project.ts`, `graph.ts`, `reference.ts` Pinia setup store |
| `computeDisplayGraph` | `domain/graph.ts` 순수 함수와 단위 테스트 |
| `CanvasEditor.tsx` | `components/canvas/CanvasEditor.vue` |
| `ImportView.tsx`의 단순 table | 재사용 `SpreadsheetGrid.vue` + `DataView.vue` |
| `LayerList.tsx` | `components/editor/LayerList.vue` |
| `PropertyPanel.tsx` | `components/editor/PropertyPanel.vue` |
| `Toolbar.tsx` | `components/editor/Toolbar.vue` |
| `HomeView.tsx` | `views/HomeView.vue`, `ProjectsView.vue` |
| `ExportView.tsx` | `views/ExportView.vue` + `domain/export.ts` |
| 없음 | Reference, Layer Master, Validation 전용 view |

## 초기 API → 최종 API 차이

- 프로젝트별 `/graph/relation-styles`, `/graph/box-presets` 대신 전역 `/api/reference/relation-styles`, `/api/reference/box-presets` 사용
- `/api/reference/key-layout-types`, `key-drawing-types`, `key-shapes` CRUD 추가
- `/api/layer-master` CRUD와 priorities dict 변환 추가
- Layer에 description, box_preset_id, pending_group 추가
- Relation에 nullable parent/child, instance, attached_relation_id, waypoints 추가
- `/graph/layers/{id}/group`, group 확장 batch 저장, 엄격 merge/split 추가
- Graph restore에서 전역 기준정보를 복원하지 않도록 분리

초기 React의 프로젝트별 style/preset API는 참고 UI 호환을 위해 graph router에 남아 있지만, 신규 Vue는 전역 최종 API만 호출한다.

## DB 마이그레이션

- 신규 SQLite/PostgreSQL은 SQLAlchemy metadata로 최종 스키마를 생성한다.
- SQLite 연결마다 `PRAGMA foreign_keys=ON`을 적용한다.
- 초기 프로젝트 종속 RelationStyle/BoxPreset 데이터를 전역화해야 하므로 기존 개발 SQLite의 자동 ALTER migration은 제거했다.
- 운영 데이터가 있는 환경은 백업 후 데이터 중복 해소 정책을 결정하고 Alembic migration을 별도로 작성해야 한다.

## 검증 결과

```text
ruff check backend/app backend/tests       PASS
pytest backend/tests                       3 PASS
vitest frontend-vue/tests                 12 PASS
vue-tsc --noEmit                           PASS
vite build                                 PASS
FastAPI startup + health + seed            PASS (relation styles 6, box presets 4)
Vite dev server HTTP                       200
```

## 알려진 제한사항

- 인앱 브라우저 제어 런타임이 Windows 사용자 프로필 경로 권한 오류로 연결되지 않아 자동 스크린샷 기반 시각 QA는 수행하지 못했다.
- Excel 파일을 직접 업로드해 import하는 별도 wizard는 없으며, 현재 Data grid의 Excel TSV paste와 행 추가로 입력한다.
- Canvas 인라인 Layer 편집은 SVG 내부 input 대신 더 안정적인 name/step prompt를 사용한다.
- XLSX와 PPTX 라이브러리가 기본 bundle에 포함돼 초기 JavaScript chunk가 약 790 kB다. 배포 최적화 시 Export view를 동적 import할 수 있다.
- 실제 운영 DB용 Alembic revision은 배포 데이터와 중복 전역 기준정보 정책이 확정된 뒤 필요하다.

## 실행과 배포

실행 명령, 환경변수, SQLite/PostgreSQL 전환과 정적 배포 방식은 루트 `README.md`에 정리돼 있다.
