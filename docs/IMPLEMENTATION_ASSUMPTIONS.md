# 구현 가정

## API의 기준정보 항목 경로

- 명세의 `GET/POST/PUT/DELETE CRUD`를 컬렉션 `/api/reference/{resource}`와 항목 `/api/reference/{resource}/{id}`로 해석한다.
- 이유: 표준 REST 구조이며 프론트의 공통 CRUD client와 grid를 재사용할 수 있다.
- 변경 가능 지점: `backend/app/routers/reference.py`의 router factory와 `frontend-vue/src/api/client.ts`의 resource 경로.

## Layer group 변경 payload

- `PATCH .../layers/{id}/group`은 `{ group: string | null }`을 받는다.
- 첫 단독 라벨은 `pending_group`에 저장하고, 같은 라벨의 두 번째 Layer가 생기면 양쪽 pending을 비우고 `same_group` 관계를 만든다.
- 변경 가능 지점: graph router의 group mutation service.

## 빈 draft relation 검증

- parent 또는 child가 비어 있는 relation은 저장을 허용하되 validation에서 각각 `relation_parent_missing`, `relation_child_missing` 오류로 보고한다.
- Relation grid의 편집 중간 상태를 보존하기 위한 선택이다. 완성된 관계를 만드는 Canvas 작업은 오류 관계를 만들지 않는다.

## 그룹 표시 anchor

- 순수 `computeDisplayGraph`에서 raw graph의 Layer 배열에 먼저 나타나는 그룹 멤버를 anchor로 사용한다.
- 서버의 `created_at` 순서와 일치하므로 결과가 결정적이며, 별도 영속 anchor 필드가 필요 없다.

## 개발 DB 마이그레이션

- 명세와 호환되지 않는 초기 SQLite DB는 자동으로 백업한 뒤 최종 스키마를 새로 만드는 방식이 안전하다. PostgreSQL은 새 환경에서 최종 metadata로 생성한다.
- 운영 데이터 마이그레이션은 실제 배포 DB와 데이터 샘플을 받은 뒤 Alembic revision으로 별도 제공해야 한다.
