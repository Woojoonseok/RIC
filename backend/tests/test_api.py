from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.routers import graph, layer_master, projects, reference_data, validation


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _record):  # type: ignore[no-untyped-def]
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session_factory = sessionmaker(engine, expire_on_commit=False)
    app = FastAPI()
    for router in (projects.router, graph.router, validation.router, reference_data.router, layer_master.router):
        app.include_router(router)

    def override_db() -> Generator[Session, None, None]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as test_client:
        yield test_client


def create_project(client: TestClient) -> str:
    response = client.post("/api/projects", json={"name": "Integration"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create_layer(client: TestClient, project_id: str, name: str, x: float = 0) -> str:
    response = client.post(
        f"/api/projects/{project_id}/graph/layers",
        json={"name": name, "x": x, "y": 40},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_project_graph_validation_restore_and_layout(client: TestClient) -> None:
    project_id = create_project(client)
    first = create_layer(client, project_id, "A")
    second = create_layer(client, project_id, "B", 300)
    third = create_layer(client, project_id, "C", 600)

    draft = client.post(f"/api/projects/{project_id}/graph/relations", json={})
    assert draft.status_code == 201, draft.text
    report = client.post(f"/api/projects/{project_id}/validate").json()
    assert any(issue["code"] == "relation_parent_missing" for issue in report["issues"])

    relation_ab = client.post(
        f"/api/projects/{project_id}/graph/relations",
        json={"parent_layer_id": first, "child_layer_id": second, "instance": "main"},
    )
    assert relation_ab.status_code == 201, relation_ab.text
    attached = client.post(
        f"/api/projects/{project_id}/graph/relations",
        json={
            "parent_layer_id": third,
            "child_layer_id": None,
            "attached_relation_id": relation_ab.json()["id"],
            "instance": "branch",
        },
    )
    assert attached.status_code == 201, attached.text
    attached_report = client.post(f"/api/projects/{project_id}/validate").json()
    assert not any(
        issue["relation_id"] == attached.json()["id"] and issue["code"] == "relation_child_missing"
        for issue in attached_report["issues"]
    )
    relation_bc = client.post(
        f"/api/projects/{project_id}/graph/relations",
        json={"parent_layer_id": second, "child_layer_id": third, "instance": "main"},
    )
    assert relation_bc.status_code == 201, relation_bc.text
    cycle = client.post(
        f"/api/projects/{project_id}/graph/relations",
        json={"parent_layer_id": third, "child_layer_id": first, "instance": "main"},
    )
    assert cycle.status_code == 422

    laid_out = client.post(f"/api/projects/{project_id}/graph/auto-layout")
    assert laid_out.status_code == 200, laid_out.text
    snapshot = laid_out.json()
    moved = client.patch(
        f"/api/projects/{project_id}/graph/layers/{first}/layout",
        json={"x": 999},
    )
    assert moved.status_code == 200
    restored = client.patch(f"/api/projects/{project_id}/graph/restore", json=snapshot)
    assert restored.status_code == 200, restored.text
    assert next(row for row in restored.json()["layouts"] if row["layer_id"] == first)["x"] != 999


def test_pending_group_merge_and_split(client: TestClient) -> None:
    project_id = create_project(client)
    first = create_layer(client, project_id, "A")
    second = create_layer(client, project_id, "B", 300)
    third = create_layer(client, project_id, "C", 600)

    pending = client.patch(f"/api/projects/{project_id}/graph/layers/{first}/group", json={"group": "ETCH"})
    assert pending.status_code == 200, pending.text
    assert next(row for row in pending.json()["layers"] if row["id"] == first)["pending_group"] == "ETCH"
    promoted = client.patch(f"/api/projects/{project_id}/graph/layers/{second}/group", json={"group": "ETCH"})
    assert promoted.status_code == 200, promoted.text
    assert any(row["same_group"] == "ETCH" for row in promoted.json()["relations"])

    resized = client.patch(
        f"/api/projects/{project_id}/graph/layers/{first}/layout",
        json={"x": 40, "y": 60, "width": 240, "height": 96},
    )
    assert resized.status_code == 200, resized.text
    graph_before_merge = client.get(f"/api/projects/{project_id}/graph")
    assert graph_before_merge.status_code == 200, graph_before_merge.text
    before_merge = {
        row["layer_id"]: (row["x"], row["y"], row["width"], row["height"])
        for row in graph_before_merge.json()["layouts"]
        if row["layer_id"] in {first, second, third}
    }

    extended = client.post(
        f"/api/projects/{project_id}/graph/layers/merge",
        json={"layer_ids": [first, third]},
    )
    assert extended.status_code == 200, extended.text
    assert len([row for row in extended.json()["relations"] if row["same_group"]]) == 2
    after_merge = {
        row["layer_id"]: (row["x"], row["y"], row["width"], row["height"])
        for row in extended.json()["layouts"]
        if row["layer_id"] in {first, second, third}
    }
    assert after_merge == before_merge
    split = client.post(f"/api/projects/{project_id}/graph/layers/{first}/split", json={})
    assert split.status_code == 200, split.text
    assert not any(row["same_group"] for row in split.json()["relations"])
    assert len(split.json()["layers"]) == 3


def test_reference_and_layer_master_priorities(client: TestClient) -> None:
    layout = client.post(
        "/api/reference/key-layout-types",
        json={"name": "Scribe", "scribe_lane_rows": 2, "sort_order": 1},
    )
    assert layout.status_code == 201, layout.text
    layout_id = layout.json()["id"]
    master = client.post(
        "/api/layer-master",
        json={"name": "M1", "layer_number": "10", "priorities": {layout_id: "1"}},
    )
    assert master.status_code == 201, master.text
    assert master.json()["priorities"] == {layout_id: "1"}
    updated = client.put(
        f"/api/layer-master/{master.json()['id']}",
        json={"priorities": {layout_id: "2"}},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["priorities"][layout_id] == "2"
    deleted = client.delete(f"/api/reference/key-layout-types/{layout_id}")
    assert deleted.status_code == 204
    assert client.get("/api/layer-master").json()[0]["priorities"] == {}
