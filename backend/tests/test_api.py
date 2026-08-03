from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base, get_db, settings, validate_identity_secret
from app.main import configure_cors
from app.routers import (
    align_trees,
    graph,
    leases,
    project_governance,
    project_layer_master,
    project_reference,
    projects,
    session,
    users,
    validation,
)
from app.services.dev_migrations import run_local_dev_migrations
from app.services.identity import _encode_actor_cookie, client_ip, hmac_subject


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
    for router in (
        session.router,
        users.router,
        projects.router,
        project_governance.router,
        align_trees.router,
        leases.router,
        graph.router,
        validation.router,
        project_reference.router,
        project_layer_master.router,
    ):
        app.include_router(router)

    def override_db() -> Generator[Session, None, None]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.state.session_factory = session_factory
    with TestClient(app) as test_client:
        def remember_revision(response) -> None:  # type: ignore[no-untyped-def]
            revision = response.headers.get("X-Project-Revision")
            if revision is not None:
                test_client.headers["If-Match"] = f'"{revision}"'

        test_client.event_hooks["response"].append(remember_revision)
        yield test_client


def create_project(client: TestClient) -> str:
    response = client.post("/api/projects", json={"name": "Integration"})
    assert response.status_code == 201, response.text
    project_id = response.json()["id"]
    lease = client.post(
        f"/api/projects/{project_id}/lease",
        json={"client_instance_id": "pytest-main"},
    )
    assert lease.status_code == 200, lease.text
    client.headers["X-Edit-Lease"] = lease.json()["lease_token"]
    client.headers["If-Match"] = f'"{lease.json()["revision"]}"'
    return project_id


def default_tree_id(client: TestClient, project_id: str) -> str:
    response = client.get(f"/api/projects/{project_id}/align-trees")
    assert response.status_code == 200, response.text
    trees = response.json()
    assert trees, "A newly-created project must have a default Align Tree"
    return next((row["id"] for row in trees if row.get("is_default")), trees[0]["id"])


def graph_base(client: TestClient, project_id: str, tree_id: str | None = None) -> str:
    selected_tree_id = tree_id or default_tree_id(client, project_id)
    return f"/api/projects/{project_id}/align-trees/{selected_tree_id}/graph"


def validate_url(client: TestClient, project_id: str, tree_id: str | None = None) -> str:
    selected_tree_id = tree_id or default_tree_id(client, project_id)
    return f"/api/projects/{project_id}/align-trees/{selected_tree_id}/validate"


def create_layer(
    client: TestClient,
    project_id: str,
    name: str,
    x: float = 0,
    tree_id: str | None = None,
) -> str:
    response = client.post(
        f"{graph_base(client, project_id, tree_id)}/layers",
        json={"name": name, "step": "1", "x": x, "y": 40},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create_tree(client: TestClient, project_id: str, name: str) -> str:
    response = client.post(f"/api/projects/{project_id}/align-trees", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def current_actor(client: TestClient) -> tuple[str, str]:
    response = client.get("/api/me")
    assert response.status_code == 200, response.text
    cookie = client.cookies.get(settings.identity_cookie_name)
    assert cookie is not None
    return response.json()["id"], cookie


def create_anonymous_actor(client: TestClient) -> tuple[str, str]:
    actor_id = uuid.uuid4()
    cookie = _encode_actor_cookie(actor_id)
    with client.app.state.session_factory() as db:
        db.add(
            models.Actor(
                id=actor_id,
                display_name=f"Anonymous {str(actor_id)[:8].upper()}",
                last_ip_hash=hmac_subject(f"pytest-{actor_id}"),
            )
        )
        db.commit()
    client.cookies.clear()
    client.cookies.set(settings.identity_cookie_name, cookie, domain="testserver.local", path="/")
    client.headers.pop("X-Edit-Lease", None)
    client.headers.pop("If-Match", None)
    return str(actor_id), cookie


def use_actor(client: TestClient, cookie: str) -> None:
    client.cookies.clear()
    client.cookies.set(settings.identity_cookie_name, cookie)
    client.headers.pop("X-Edit-Lease", None)
    client.headers.pop("If-Match", None)


def test_project_graph_validation_restore_and_layout(client: TestClient) -> None:
    project_id = create_project(client)
    first = create_layer(client, project_id, "A")
    second = create_layer(client, project_id, "B", 300)
    third = create_layer(client, project_id, "C", 600)

    draft = client.post(f"{graph_base(client, project_id)}/relations", json={})
    assert draft.status_code == 201, draft.text
    report = client.post(validate_url(client, project_id)).json()
    assert any(issue["code"] == "relation_parent_missing" for issue in report["issues"])

    relation_ab = client.post(
        f"{graph_base(client, project_id)}/relations",
        json={"parent_layer_id": first, "child_layer_id": second},
    )
    assert relation_ab.status_code == 201, relation_ab.text
    attached = client.post(
        f"{graph_base(client, project_id)}/relations",
        json={
            "parent_layer_id": third,
            "child_layer_id": None,
            "attached_relation_id": relation_ab.json()["id"],
        },
    )
    assert attached.status_code == 201, attached.text
    attached_report = client.post(validate_url(client, project_id)).json()
    assert not any(
        issue["relation_id"] == attached.json()["id"] and issue["code"] == "relation_child_missing"
        for issue in attached_report["issues"]
    )
    relation_bc = client.post(
        f"{graph_base(client, project_id)}/relations",
        json={"parent_layer_id": second, "child_layer_id": third},
    )
    assert relation_bc.status_code == 201, relation_bc.text
    cycle = client.post(
        f"{graph_base(client, project_id)}/relations",
        json={"parent_layer_id": third, "child_layer_id": first},
    )
    assert cycle.status_code == 422

    laid_out = client.post(f"{graph_base(client, project_id)}/auto-layout")
    assert laid_out.status_code == 200, laid_out.text
    snapshot = laid_out.json()
    moved = client.patch(
        f"{graph_base(client, project_id)}/layers/{first}/layout",
        json={"x": 999},
    )
    assert moved.status_code == 200
    restored = client.patch(f"{graph_base(client, project_id)}/restore", json=snapshot)
    assert restored.status_code == 200, restored.text
    assert next(row for row in restored.json()["layouts"] if row["layer_id"] == first)["x"] != 999


def test_pending_group_merge_and_split(client: TestClient) -> None:
    project_id = create_project(client)
    first = create_layer(client, project_id, "A")
    second = create_layer(client, project_id, "B", 300)
    third = create_layer(client, project_id, "C", 600)

    pending = client.patch(f"{graph_base(client, project_id)}/layers/{first}/group", json={"group": "ETCH"})
    assert pending.status_code == 200, pending.text
    assert next(row for row in pending.json()["layers"] if row["id"] == first)["pending_group"] == "ETCH"
    promoted = client.patch(f"{graph_base(client, project_id)}/layers/{second}/group", json={"group": "ETCH"})
    assert promoted.status_code == 200, promoted.text
    assert any(row["same_group"] == "ETCH" for row in promoted.json()["relations"])

    resized = client.patch(
        f"{graph_base(client, project_id)}/layers/{first}/layout",
        json={"x": 40, "y": 60, "width": 240, "height": 96},
    )
    assert resized.status_code == 200, resized.text
    graph_before_merge = client.get(graph_base(client, project_id))
    assert graph_before_merge.status_code == 200, graph_before_merge.text
    before_merge = {
        row["layer_id"]: (row["x"], row["y"], row["width"], row["height"])
        for row in graph_before_merge.json()["layouts"]
        if row["layer_id"] in {first, second, third}
    }

    extended = client.post(
        f"{graph_base(client, project_id)}/layers/merge",
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
    reloaded = client.get(graph_base(client, project_id)).json()
    assert len([row for row in reloaded["relations"] if row["same_group"] == "ETCH"]) == 2
    assert {row["group"] for row in client.get(f"/api/projects/{project_id}/layer-master").json()} == {
        "ETCH"
    }
    split = client.post(f"{graph_base(client, project_id)}/layers/{first}/split", json={})
    assert split.status_code == 200, split.text
    assert not any(row["same_group"] for row in split.json()["relations"])
    assert len(split.json()["layers"]) == 3
    assert {row["group"] for row in client.get(f"/api/projects/{project_id}/layer-master").json()} == {
        None
    }


def test_merge_rejects_layers_with_an_existing_relation(client: TestClient) -> None:
    project_id = create_project(client)
    first = create_layer(client, project_id, "Source")
    second = create_layer(client, project_id, "Target", 300)
    relation = client.post(
        f"{graph_base(client, project_id)}/relations",
        json={"parent_layer_id": first, "child_layer_id": second},
    )
    assert relation.status_code == 201, relation.text

    merged = client.post(
        f"{graph_base(client, project_id)}/layers/merge",
        json={"layer_ids": [first, second]},
    )
    assert merged.status_code == 422
    assert "Relation" in merged.text

    third = create_layer(client, project_id, "Third", 600)
    initial_group = client.post(
        f"{graph_base(client, project_id)}/layers/merge",
        json={"layer_ids": [first, third]},
    )
    assert initial_group.status_code == 200, initial_group.text
    member_relation = client.post(
        f"{graph_base(client, project_id)}/relations",
        json={"parent_layer_id": third, "child_layer_id": second},
    )
    assert member_relation.status_code == 201, member_relation.text
    group_merge = client.post(
        f"{graph_base(client, project_id)}/layers/merge",
        json={"layer_ids": [first, second]},
    )
    assert group_merge.status_code == 422
    assert "Relation" in group_merge.text


def test_project_has_one_editor_and_mixed_project_ids_are_rejected(client: TestClient) -> None:
    project_id = create_project(client)
    editor_id = default_tree_id(client, project_id)
    duplicate = client.post(
        f"/api/projects/{project_id}/align-trees",
        json={"name": "Alternative"},
    )
    assert duplicate.status_code == 409, duplicate.text
    assert len(client.get(f"/api/projects/{project_id}/align-trees").json()) == 1
    assert client.delete(f"/api/projects/{project_id}/align-trees/{editor_id}").status_code == 409

    other_project_id = create_project(client)
    mixed_project_tree = client.get(graph_base(client, other_project_id, editor_id))
    assert mixed_project_tree.status_code == 404, mixed_project_tree.text


def test_graph_audit_is_atomic_for_success_and_rollback(client: TestClient) -> None:
    project_id = create_project(client)
    tree_id = default_tree_id(client, project_id)

    missing_number = client.post(
        f"{graph_base(client, project_id, tree_id)}/layers",
        json={"name": "Missing Number"},
    )
    assert missing_number.status_code == 422, missing_number.text

    created = client.post(
        f"{graph_base(client, project_id, tree_id)}/layers",
        json={"name": "Audited Layer", "step": "10"},
    )
    assert created.status_code == 201, created.text

    after_success = client.get(f"/api/projects/{project_id}/audit-events")
    assert after_success.status_code == 200, after_success.text
    created_events = [
        row for row in after_success.json()
        if row["event_type"] == "layer.created" and row["target_id"] == created.json()["id"]
    ]
    assert len(created_events) == 1
    assert created_events[0]["align_tree_id"] == tree_id

    moved = client.patch(
        f"{graph_base(client, project_id, tree_id)}/batch",
        json={"layouts": [{"layer_id": created.json()["id"], "x": 240}], "styles": [], "text_boxes": []},
    )
    assert moved.status_code == 200, moved.text
    move_events = [
        row for row in client.get(
            f"/api/projects/{project_id}/audit-events",
            params={"changes_only": "true", "target_id": created.json()["id"]},
        ).json()
        if row["event_type"] == "layout.updated"
    ]
    assert len(move_events) == 1
    assert move_events[0]["details_json"] == {"before": {"x": 100.0}, "after": {"x": 240.0}}

    duplicate = client.post(
        f"{graph_base(client, project_id, tree_id)}/layers",
        json={"name": "Audited Layer", "step": "10"},
    )
    assert duplicate.status_code == 409, duplicate.text

    after_rollback = client.get(f"/api/projects/{project_id}/audit-events")
    assert after_rollback.status_code == 200, after_rollback.text
    assert len([row for row in after_rollback.json() if row["event_type"] == "layer.created"]) == 1
    graph = client.get(graph_base(client, project_id, tree_id)).json()
    assert [row["name"] for row in graph["layers"]] == ["Audited Layer"]


def test_batch_box_preset_applies_and_can_switch_back_to_default(client: TestClient) -> None:
    project_id = create_project(client)
    tree_id = default_tree_id(client, project_id)
    layer_ids = [
        create_layer(client, project_id, "Box A", tree_id=tree_id),
        create_layer(client, project_id, "Box B", tree_id=tree_id),
        create_layer(client, project_id, "Box C", tree_id=tree_id),
    ]
    graph_url = graph_base(client, project_id, tree_id)
    presets = {
        row["name"]: row
        for row in client.get(graph_url).json()["box_presets"]
    }

    for preset_name in ("Yellow Note", "Default Blue"):
        preset = presets[preset_name]
        response = client.patch(
            f"{graph_url}/batch",
            json={
                "layer_presets": [
                    {"layer_id": layer_id, "box_preset_id": preset["id"]}
                    for layer_id in layer_ids
                ]
            },
        )
        assert response.status_code == 200, response.text
        graph = response.json()
        layers = {row["id"]: row for row in graph["layers"]}
        layouts = {row["layer_id"]: row for row in graph["layouts"]}
        styles = {row["layer_id"]: row for row in graph["styles"]}
        for layer_id in layer_ids:
            assert layers[layer_id]["box_preset_id"] == preset["id"]
            assert layouts[layer_id]["width"] == preset["width"]
            assert layouts[layer_id]["height"] == preset["height"]
            assert styles[layer_id]["fill_color"] == preset["fill_color"]
            assert styles[layer_id]["stroke_color"] == preset["stroke_color"]
            assert styles[layer_id]["text_color"] == preset["text_color"]
            assert styles[layer_id]["font_size"] == preset["font_size"]
            assert styles[layer_id]["stroke_width"] == preset["stroke_width"]


def test_reference_and_layer_master_priorities(client: TestClient) -> None:
    project_id = create_project(client)
    first_tree = default_tree_id(client, project_id)
    reference_base = f"/api/projects/{project_id}/reference"
    layer_master_base = f"/api/projects/{project_id}/layer-master"

    assert client.get("/api/reference/key-layout-types").status_code == 404
    assert client.get("/api/layer-master").status_code == 404

    layout = client.post(
        f"{reference_base}/key-layout-types",
        json={"name": "Scribe", "scribe_lane_rows": 2, "sort_order": 1},
    )
    assert layout.status_code == 201, layout.text
    layout_id = layout.json()["id"]
    missing_number = client.post(layer_master_base, json={"name": "Missing Number"})
    assert missing_number.status_code == 422, missing_number.text
    master = client.post(
        layer_master_base,
        json={"name": "M1", "layer_number": "10", "group": "Front", "priorities": {layout_id: "1"}},
    )
    assert master.status_code == 201, master.text
    assert master.json()["priorities"] == {layout_id: "1"}
    assert master.json()["group"] == "Front"
    second_master = client.post(
        layer_master_base,
        json={"name": "M2", "layer_number": "20", "group": "Front"},
    )
    assert second_master.status_code == 201, second_master.text
    assert client.get(graph_base(client, project_id, first_tree)).json()["layers"] == []
    for row in (master.json(), second_master.json()):
        imported = client.post(
            f"{graph_base(client, project_id, first_tree)}/layers",
            json={"name": row["name"], "layer_master_id": row["id"]},
        )
        assert imported.status_code == 201, imported.text
    duplicate = client.post(
        f"{graph_base(client, project_id, first_tree)}/layers",
        json={"name": master.json()["name"], "layer_master_id": master.json()["id"]},
    )
    assert duplicate.status_code == 409, duplicate.text
    synced_layers = client.get(graph_base(client, project_id, first_tree)).json()["layers"]
    assert [(row["name"], row["step"], row["layer_master_id"]) for row in synced_layers] == [
        ("M1", "10", master.json()["id"]),
        ("M2", "20", second_master.json()["id"]),
    ]
    relations = client.get(graph_base(client, project_id, first_tree)).json()["relations"]
    assert [row["same_group"] for row in relations] == ["Front"]
    updated = client.put(
        f"{layer_master_base}/{master.json()['id']}",
        json={"name": "M1 updated", "layer_number": "11", "priorities": {layout_id: "2"}},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["priorities"][layout_id] == "2"
    synced = client.get(graph_base(client, project_id, first_tree)).json()["layers"][0]
    assert (synced["name"], synced["step"]) == ("M1 updated", "11")
    deleted = client.delete(f"{reference_base}/key-layout-types/{layout_id}")
    assert deleted.status_code == 204
    assert client.get(layer_master_base).json()[0]["priorities"] == {}

    first_graph = client.get(graph_base(client, project_id, first_tree)).json()
    first_layer_id = next(
        row["id"] for row in first_graph["layers"] if row["layer_master_id"] == master.json()["id"]
    )
    graph_updated = client.put(
        f"{graph_base(client, project_id, first_tree)}/layers/{first_layer_id}",
        json={"name": "M1 from Align", "step": None},
    )
    assert graph_updated.status_code == 422, graph_updated.text
    masters = client.get(layer_master_base).json()
    first_master = next(row for row in masters if row["id"] == master.json()["id"])
    assert (first_master["name"], first_master["layer_number"]) == ("M1 updated", "11")
    synced = client.get(graph_base(client, project_id, first_tree)).json()["layers"][0]
    assert (synced["name"], synced["step"]) == ("M1 updated", "11")

    graph_deleted = client.delete(
        f"{graph_base(client, project_id, first_tree)}/layers/{first_layer_id}"
    )
    assert graph_deleted.status_code == 204, graph_deleted.text
    assert {row["name"] for row in client.get(layer_master_base).json()} == {"M1 updated", "M2"}
    first_after_delete = client.get(graph_base(client, project_id, first_tree)).json()
    assert [row["name"] for row in first_after_delete["layers"]] == ["M2"]
    reimported = client.post(
        f"{graph_base(client, project_id, first_tree)}/layers",
        json={"name": "ignored", "layer_master_id": master.json()["id"]},
    )
    assert reimported.status_code == 201, reimported.text
    assert reimported.json()["name"] == "M1 updated"


def test_relation_reference_fields_and_variable_extras(client: TestClient) -> None:
    project_id = create_project(client)
    tree_id = default_tree_id(client, project_id)
    updated_tree = client.patch(
        f"/api/projects/{project_id}/align-trees/{tree_id}",
        json={
            "process_name": "PROC-A",
            "gds_name": "PROC-A.gds",
            "layer_process_names": {"layer-38": "ETCH"},
            "layer_gds_names": {"layer-38": "M38.gds"},
            "final_table_cells": {"relation-1": {"layer-38": "CUSTOM", "layer-39": ""}},
        },
    )
    assert updated_tree.status_code == 200, updated_tree.text
    assert updated_tree.json()["process_name"] == "PROC-A"
    assert updated_tree.json()["gds_name"] == "PROC-A.gds"
    assert updated_tree.json()["layer_process_names"] == {"layer-38": "ETCH"}
    assert updated_tree.json()["layer_gds_names"] == {"layer-38": "M38.gds"}
    assert updated_tree.json()["final_table_cells"] == {
        "relation-1": {"layer-38": "CUSTOM", "layer-39": ""}
    }
    reference_base = f"/api/projects/{project_id}/reference"
    layer_master_base = f"/api/projects/{project_id}/layer-master"

    layout = client.post(
        f"{reference_base}/key-layout-types",
        json={"name": "Center Key"},
    ).json()
    key_drawing = client.post(
        f"{reference_base}/key-drawing-types",
        json={"symbol": "KT", "key_shape": "Cross"},
    ).json()
    parent_drawing = client.post(
        f"{reference_base}/key-drawing-types",
        json={"symbol": "PD", "key_shape": "Cross"},
    ).json()
    child_drawing = client.post(
        f"{reference_base}/key-drawing-types",
        json={"symbol": "CD", "key_shape": "Cross"},
    ).json()
    arrow_type = client.get(f"{reference_base}/relation-styles").json()[0]

    masters = []
    for index, name in enumerate(("Parent Master", "Child Master", "Extra One", "Extra Two"), 38):
        response = client.post(
            layer_master_base,
            json={"name": name, "layer_number": str(index)},
        )
        assert response.status_code == 201, response.text
        masters.append(response.json())
    imported_layers = []
    for master in masters[:2]:
        response = client.post(
            f"{graph_base(client, project_id, tree_id)}/layers",
            json={"name": master["name"], "layer_master_id": master["id"]},
        )
        assert response.status_code == 201, response.text
        imported_layers.append(response.json())

    created = client.post(
        f"{graph_base(client, project_id, tree_id)}/relations",
        json={
            "parent_layer_id": imported_layers[0]["id"],
            "child_layer_id": imported_layers[1]["id"],
            "key_layout_type_id": layout["id"],
            "key_drawing_type_id": key_drawing["id"],
            "relation_style_id": arrow_type["id"],
            "parent_drawing_type_id": parent_drawing["id"],
            "child_drawing_type_id": child_drawing["id"],
            "comment": "Primary relation",
            "key_priority": "1",
            "priority_rule": "Parent first",
            "final_type": "Main",
            "key_purpose": "Overlay",
            "placement": "Center",
            "stack_type": "Dual",
            "inregi": "Yes",
            "inner_size": "10",
            "outer_size": "20",
            "source_port": "right",
            "target_port": "left",
            "extras": [{
                "layer_master_id": masters[2]["id"],
                "key_drawing_type_id": parent_drawing["id"],
            }],
        },
    )
    assert created.status_code == 201, created.text
    relation = created.json()
    assert "instance" not in relation
    assert relation["relation_type"] == arrow_type["name"]
    assert relation["key_layout_type_id"] == layout["id"]
    assert relation["key_drawing_type_id"] == key_drawing["id"]
    assert relation["parent_drawing_type_id"] == parent_drawing["id"]
    assert relation["child_drawing_type_id"] == child_drawing["id"]
    assert relation["comment"] == "Primary relation"
    assert relation["key_priority"] == "1"
    assert relation["priority_rule"] == "Parent first"
    assert relation["final_type"] == "Main"
    assert relation["key_purpose"] == "Overlay"
    assert relation["placement"] == "Center"
    assert relation["stack_type"] == "Dual"
    assert relation["inregi"] == "Yes"
    assert relation["inner_size"] == "10"
    assert relation["outer_size"] == "20"
    assert relation["source_port"] == "right"
    assert relation["target_port"] == "left"
    assert [(row["layer_master_id"], row["key_drawing_type_id"]) for row in relation["extras"]] == [
        (masters[2]["id"], parent_drawing["id"]),
    ]

    updated = client.put(
        f"{graph_base(client, project_id, tree_id)}/relations/{relation['id']}",
        json={
            "extras": [
                {
                    "layer_master_id": masters[2]["id"],
                    "key_drawing_type_id": parent_drawing["id"],
                },
                {
                    "layer_master_id": masters[3]["id"],
                    "key_drawing_type_id": child_drawing["id"],
                },
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    assert [row["sort_order"] for row in updated.json()["extras"]] == [0, 1]
    assert [row["layer_master_id"] for row in updated.json()["extras"]] == [
        masters[2]["id"],
        masters[3]["id"],
    ]

    duplicate = client.post(
        f"{graph_base(client, project_id, tree_id)}/relations",
        json={
            "parent_layer_id": imported_layers[0]["id"],
            "child_layer_id": imported_layers[1]["id"],
            "source_port": "bottom",
            "target_port": "top",
        },
    )
    assert duplicate.status_code == 201, duplicate.text
    assert duplicate.json()["id"] != relation["id"]
    same_pair = [
        row for row in client.get(graph_base(client, project_id, tree_id)).json()["relations"]
        if row["parent_layer_id"] == imported_layers[0]["id"]
        and row["child_layer_id"] == imported_layers[1]["id"]
    ]
    assert len(same_pair) == 2


def test_spare_relations_support_all_directions_and_duplicates(client: TestClient) -> None:
    project_id = create_project(client)
    tree_id = default_tree_id(client, project_id)
    layer_a = create_layer(client, project_id, "Layer A", tree_id=tree_id)
    layer_b = create_layer(client, project_id, "Layer B", tree_id=tree_id)
    base = f"{graph_base(client, project_id, tree_id)}/relations"

    payloads = [
        {
            "parent_endpoint_type": "layer",
            "parent_layer_id": layer_a,
            "child_endpoint_type": "spare",
            "child_layer_id": layer_b,
        },
        {
            "parent_endpoint_type": "spare",
            "parent_layer_id": layer_a,
            "child_endpoint_type": "layer",
            "child_layer_id": layer_b,
        },
        {"parent_endpoint_type": "spare", "child_endpoint_type": "spare"},
        {"parent_endpoint_type": "spare", "child_endpoint_type": "spare"},
    ]
    created = [client.post(base, json=payload) for payload in payloads]
    assert all(response.status_code == 201 for response in created), [response.text for response in created]

    rows = [response.json() for response in created]
    assert rows[0]["parent_layer_id"] == layer_a
    assert rows[0]["child_layer_id"] is None
    assert rows[1]["parent_layer_id"] is None
    assert rows[1]["child_layer_id"] == layer_b
    assert rows[2]["parent_layer_id"] is None and rows[2]["child_layer_id"] is None
    assert rows[2]["id"] != rows[3]["id"]

    graph = client.get(graph_base(client, project_id, tree_id)).json()
    spare_rows = [row for row in graph["relations"] if row["parent_endpoint_type"] == "spare" or row["child_endpoint_type"] == "spare"]
    assert len(spare_rows) == 4
    assert not [issue for issue in graph["validation"]["issues"] if issue["relation_id"] in {row["id"] for row in spare_rows}]


def test_project_branch_copies_reference_and_layer_master_without_editor_graph(client: TestClient) -> None:
    source_project_id = create_project(client)
    source_tree_id = default_tree_id(client, source_project_id)
    reference_base = f"/api/projects/{source_project_id}/reference"
    layout = client.post(
        f"{reference_base}/key-layout-types",
        json={"name": "Branch Layout", "scribe_lane_rows": 3, "sort_order": 7},
    )
    assert layout.status_code == 201, layout.text
    layout_id = layout.json()["id"]
    assert client.post(
        f"{reference_base}/key-drawing-types",
        json={"symbol": "BD", "key_shape": "Branch Shape", "sort_order": 2},
    ).status_code == 201
    assert client.post(
        f"{reference_base}/key-shapes",
        json={"key_shape": "Branch Shape", "drawing_guide": "Guide", "sort_order": 2},
    ).status_code == 201
    master = client.post(
        f"/api/projects/{source_project_id}/layer-master",
        json={
            "name": "Branch Layer",
            "layer_number": "77",
            "group": "BRANCH",
            "priorities": {layout_id: "9"},
        },
    )
    assert master.status_code == 201, master.text
    imported = client.post(
        f"{graph_base(client, source_project_id, source_tree_id)}/layers",
        json={"name": "ignored", "layer_master_id": master.json()["id"]},
    )
    assert imported.status_code == 201, imported.text

    branched = client.post(
        f"/api/projects/{source_project_id}/branch",
        json={"name": "Integration Branch", "description": "Copied settings"},
    )
    assert branched.status_code == 201, branched.text
    target_project_id = branched.json()["id"]
    target_trees = client.get(f"/api/projects/{target_project_id}/align-trees").json()
    assert len(target_trees) == 1
    target_graph = client.get(graph_base(client, target_project_id, target_trees[0]["id"])).json()
    assert target_graph["layers"] == []
    assert target_graph["relations"] == []

    target_layouts = client.get(
        f"/api/projects/{target_project_id}/reference/key-layout-types"
    ).json()
    target_layout = next(row for row in target_layouts if row["name"] == "Branch Layout")
    assert target_layout["id"] != layout_id
    target_masters = client.get(f"/api/projects/{target_project_id}/layer-master").json()
    target_master = next(row for row in target_masters if row["name"] == "Branch Layer")
    assert target_master["id"] != master.json()["id"]
    assert target_master["group"] == "BRANCH"
    assert target_master["priorities"] == {target_layout["id"]: "9"}
    assert any(
        row["key_shape"] == "Branch Shape"
        for row in client.get(f"/api/projects/{target_project_id}/reference/key-shapes").json()
    )
    assert any(
        row["symbol"] == "BD"
        for row in client.get(f"/api/projects/{target_project_id}/reference/key-drawing-types").json()
    )


def test_graph_load_keeps_layer_master_out_of_editor_until_imported(client: TestClient) -> None:
    project_id = create_project(client)
    tree_id = default_tree_id(client, project_id)
    with client.app.state.session_factory() as db:
        master = models.LayerMaster(
            project_id=uuid.UUID(project_id),
            name="Legacy Layer Name",
            layer_number="42",
        )
        db.add(master)
        db.commit()
        master_id = str(master.id)
        assert (
            db.query(models.Layer)
            .filter(models.Layer.layer_master_id == master.id)
            .count()
            == 0
        )

    graph_response = client.get(graph_base(client, project_id, tree_id))
    assert graph_response.status_code == 200, graph_response.text
    assert graph_response.json()["layers"] == []

    reloaded = client.get(graph_base(client, project_id, tree_id)).json()
    assert reloaded["layers"] == []
    imported = client.post(
        f"{graph_base(client, project_id, tree_id)}/layers",
        json={"name": "ignored", "layer_master_id": master_id},
    )
    assert imported.status_code == 201, imported.text
    assert (
        imported.json()["name"],
        imported.json()["step"],
        imported.json()["layer_master_id"],
    ) == ("Legacy Layer Name", "42", master_id)


def test_revision_rejects_a_stale_mutation(client: TestClient) -> None:
    project_id = create_project(client)
    lease_token = client.headers["X-Edit-Lease"]
    created = client.post(
        f"{graph_base(client, project_id)}/layers",
        json={"name": "First", "step": "10"},
    )
    assert created.status_code == 201, created.text
    assert created.headers["X-Project-Revision"] == "1"

    stale = client.post(
        f"{graph_base(client, project_id)}/layers",
        json={"name": "Must not persist", "step": "20"},
        headers={"X-Edit-Lease": lease_token, "If-Match": '"0"'},
    )
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["current_revision"] == 1
    graph_response = client.get(graph_base(client, project_id))
    assert [row["name"] for row in graph_response.json()["layers"]] == ["First"]


def test_missing_anonymous_cookie_recovers_identity_from_ip(client: TestClient) -> None:
    first = client.get("/api/me")
    assert first.status_code == 200, first.text
    first_id = first.json()["id"]
    assert first.json()["display_name"].endswith(first_id[:8].upper())

    client.cookies.clear()
    second = client.get("/api/me")
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first_id


def test_public_project_metadata_is_visible_but_internal_data_requires_membership(
    client: TestClient,
) -> None:
    owner_id, owner_cookie = current_actor(client)
    project_id = create_project(client)
    tree_id = default_tree_id(client, project_id)

    owner_view = client.get(f"/api/projects/{project_id}")
    assert owner_view.status_code == 200, owner_view.text
    assert owner_view.json()["creator"]["id"] == owner_id
    assert owner_view.json()["creator_display_name"] == owner_view.json()["creator"]["display_name"]
    assert owner_view.json()["my_role"] == "owner"
    assert owner_view.json()["access_role"] == "owner"
    assert owner_view.json()["align_tree_count"] == 1
    assert owner_view.json()["member_count"] == 1
    assert owner_view.json()["is_locked"] is True
    assert owner_view.json()["locked_by_me"] is True
    assert owner_view.json()["lock_holder_display_name"] == owner_view.json()["creator"]["display_name"]

    owner_members = client.get(f"/api/projects/{project_id}/members")
    assert owner_members.status_code == 200, owner_members.text
    assert [(row["actor"]["id"], row["role"]) for row in owner_members.json()] == [(owner_id, "owner")]

    nonmember_id, _nonmember_cookie = create_anonymous_actor(client)
    assert nonmember_id != owner_id
    public_list = client.get("/api/projects")
    assert public_list.status_code == 200, public_list.text
    public_project = next(row for row in public_list.json() if row["id"] == project_id)
    assert public_project["creator"]["id"] == owner_id
    assert public_project["my_role"] is None
    assert public_project["access_role"] is None
    assert public_project["align_tree_count"] == 1
    assert public_project["member_count"] == 1
    assert public_project["is_locked"] is True
    assert public_project["lock_holder_display_name"] is None

    assert client.get(f"/api/projects/{project_id}").status_code == 200
    assert client.get(f"/api/projects/{project_id}/align-trees").status_code == 404
    assert client.get(graph_base(client, project_id, tree_id)).status_code == 404
    assert client.get(f"/api/projects/{project_id}/members").status_code == 404
    assert client.get(f"/api/projects/{project_id}/audit-events").status_code == 404

    use_actor(client, owner_cookie)
    assert client.get(f"/api/projects/{project_id}/members").status_code == 200


def test_access_request_duplicate_approval_and_rejection(client: TestClient) -> None:
    owner_id, owner_cookie = current_actor(client)
    project_id = create_project(client)
    tree_id = default_tree_id(client, project_id)

    requester_id, requester_cookie = create_anonymous_actor(client)
    request = client.post(
        f"/api/projects/{project_id}/access-requests",
        json={"requested_role": "editor", "message": "Please add me"},
    )
    assert request.status_code == 201, request.text
    request_id = request.json()["id"]
    assert request.json()["requester"]["id"] == requester_id
    assert request.json()["status"] == "pending"
    duplicate = client.post(
        f"/api/projects/{project_id}/access-requests",
        json={"requested_role": "viewer"},
    )
    assert duplicate.status_code == 409, duplicate.text

    use_actor(client, owner_cookie)
    pending = client.get(f"/api/projects/{project_id}/access-requests", params={"status": "pending"})
    assert pending.status_code == 200, pending.text
    assert [row["id"] for row in pending.json()] == [request_id]
    approved = client.patch(
        f"/api/projects/{project_id}/access-requests/{request_id}",
        json={"status": "approved", "role": "viewer", "decision_note": "Read access first"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["reviewed_by"]["id"] == owner_id

    use_actor(client, requester_cookie)
    requester_view = client.get(f"/api/projects/{project_id}")
    assert requester_view.status_code == 200, requester_view.text
    assert requester_view.json()["my_role"] == "viewer"
    assert requester_view.json()["access_request_status"] == "approved"
    assert client.get(graph_base(client, project_id, tree_id)).status_code == 200
    assert client.post(
        f"/api/projects/{project_id}/lease",
        json={"client_instance_id": "viewer-tab"},
    ).status_code == 403
    assert client.post(
        f"/api/projects/{project_id}/access-requests",
        json={"requested_role": "editor"},
    ).status_code == 409

    rejected_id, rejected_cookie = create_anonymous_actor(client)
    rejected_request = client.post(
        f"/api/projects/{project_id}/access-requests",
        json={"requested_role": "viewer", "message": "Read only"},
    )
    assert rejected_request.status_code == 201, rejected_request.text

    use_actor(client, owner_cookie)
    rejected = client.patch(
        f"/api/projects/{project_id}/access-requests/{rejected_request.json()['id']}",
        json={"status": "rejected", "decision_note": "Not yet"},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["requester"]["id"] == rejected_id
    assert rejected.json()["status"] == "rejected"

    use_actor(client, rejected_cookie)
    rejected_view = client.get(f"/api/projects/{project_id}")
    assert rejected_view.status_code == 200, rejected_view.text
    assert rejected_view.json()["my_role"] is None
    assert rejected_view.json()["access_request_status"] == "rejected"
    assert client.get(graph_base(client, project_id, tree_id)).status_code == 404


def test_member_management_enforces_admin_limits_and_protects_owner(client: TestClient) -> None:
    owner_id, owner_cookie = current_actor(client)
    project_id = create_project(client)
    admin_id, admin_cookie = create_anonymous_actor(client)
    editor_id, editor_cookie = create_anonymous_actor(client)
    candidate_id, candidate_cookie = create_anonymous_actor(client)

    use_actor(client, owner_cookie)
    added_admin = client.post(
        f"/api/projects/{project_id}/members",
        json={"actor_id": admin_id, "role": "admin"},
    )
    assert added_admin.status_code == 201, added_admin.text

    use_actor(client, admin_cookie)
    added_editor = client.post(
        f"/api/projects/{project_id}/members",
        json={"actor_id": editor_id, "role": "editor"},
    )
    assert added_editor.status_code == 201, added_editor.text
    assert added_editor.json()["role"] == "editor"
    cannot_grant_admin = client.post(
        f"/api/projects/{project_id}/members",
        json={"actor_id": candidate_id, "role": "admin"},
    )
    assert cannot_grant_admin.status_code == 403, cannot_grant_admin.text
    cannot_promote = client.patch(
        f"/api/projects/{project_id}/members/{editor_id}",
        json={"role": "admin"},
    )
    assert cannot_promote.status_code == 403, cannot_promote.text
    assert client.delete(f"/api/projects/{project_id}/members/{owner_id}").status_code == 403
    assert client.delete(f"/api/projects/{project_id}/members/{admin_id}").status_code == 403

    removed_editor = client.delete(f"/api/projects/{project_id}/members/{editor_id}")
    assert removed_editor.status_code == 204, removed_editor.text
    use_actor(client, editor_cookie)
    assert client.get(f"/api/projects/{project_id}/members").status_code == 404

    use_actor(client, owner_cookie)
    added_candidate = client.post(
        f"/api/projects/{project_id}/members",
        json={"actor_id": candidate_id, "role": "viewer"},
    )
    assert added_candidate.status_code == 201, added_candidate.text
    assert client.delete(f"/api/projects/{project_id}/members/{owner_id}").status_code == 403
    removed_candidate = client.delete(f"/api/projects/{project_id}/members/{candidate_id}")
    assert removed_candidate.status_code == 204, removed_candidate.text

    use_actor(client, candidate_cookie)
    assert client.get(f"/api/projects/{project_id}/members").status_code == 404


def test_cors_preflight_allows_only_vite_on_loopback_and_rfc1918() -> None:
    cors_app = FastAPI()
    configure_cors(cors_app)

    @cors_app.get("/probe")
    def probe() -> dict[str, bool]:
        return {"ok": True}

    allowed_origins = (
        "http://localhost:5173",
        "https://localhost:5173",
        "http://127.0.0.1:5173",
        "http://10.0.0.0:5173",
        "http://10.255.255.255:5173",
        "http://192.168.42.7:5173",
        "http://172.16.0.1:5173",
        "https://172.31.255.255:5173",
    )
    denied_origins = (
        "http://localhost.evil:5173",
        "http://localhost:8000",
        "http://127.0.0.2:5173",
        "http://10.0.0.1:5174",
        "http://10.999.0.1:5173",
        "http://172.15.255.255:5173",
        "http://172.32.0.1:5173",
        "http://192.169.0.1:5173",
        "http://11.0.0.1:5173",
        "http://example.com:5173",
    )
    assert ".*" not in settings.cors_origin_regex
    with TestClient(cors_app) as cors_client:
        for origin in allowed_origins:
            response = cors_client.options(
                "/probe",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
            assert response.status_code == 200, (origin, response.text)
            assert response.headers["access-control-allow-origin"] == origin
            assert response.headers["access-control-allow-credentials"] == "true"

        for origin in denied_origins:
            response = cors_client.options(
                "/probe",
                headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
            )
            assert response.status_code == 400, (origin, response.text)
            assert "access-control-allow-origin" not in response.headers


def test_trusted_vite_proxy_uses_last_xff_and_ignores_spoofed_forwarded(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    monkeypatch.setattr(settings, "trusted_proxy_ips", "127.0.0.1")

    def request_with(headers: list[tuple[bytes, bytes]], peer: str = "127.0.0.1") -> Request:
        return Request(
            {
                "type": "http",
                "method": "GET",
                "scheme": "http",
                "path": "/",
                "raw_path": b"/",
                "query_string": b"",
                "headers": headers,
                "client": (peer, 41234),
                "server": ("testserver", 80),
            }
        )

    spoofed_chain = request_with(
        [
            (b"x-forwarded-for", b"203.0.113.99, 192.168.20.44"),
            (b"forwarded", b"for=203.0.113.99"),
        ]
    )
    assert client_ip(spoofed_chain) == "192.168.20.44"

    forwarded_only = request_with([(b"forwarded", b"for=203.0.113.99")])
    assert client_ip(forwarded_only) == "127.0.0.1"

    malformed_proxy_tail = request_with([(b"x-forwarded-for", b"192.168.20.44, attacker.invalid")])
    assert client_ip(malformed_proxy_tail) == "127.0.0.1"

    untrusted_direct_peer = request_with(
        [(b"x-forwarded-for", b"192.168.20.44")],
        peer="192.168.50.10",
    )
    assert client_ip(untrusted_direct_peer) == "192.168.50.10"


def test_identity_secret_rejects_defaults_and_short_values() -> None:
    for unsafe in (
        "short-secret",
        "ric-local-dev-identity-secret-change-me",
        "replace-with-a-random-64-character-secret",
    ):
        with pytest.raises(RuntimeError):
            validate_identity_secret(unsafe)
    validate_identity_secret("mP7!2yQ9#vL4@xC8$kN6^sR3&wT5*zA1")


def test_legacy_project_access_never_authorizes_and_is_purged_on_member_removal(
    client: TestClient,
) -> None:
    _owner_id, owner_cookie = current_actor(client)
    project_id = create_project(client)
    legacy_actor_id, legacy_cookie = create_anonymous_actor(client)

    with client.app.state.session_factory() as db:
        db.add(
            models.ProjectAccess(
                project_id=uuid.UUID(project_id),
                actor_id=uuid.UUID(legacy_actor_id),
                permission="editor",
            )
        )
        db.commit()

    assert client.get(f"/api/projects/{project_id}").json()["my_role"] is None
    assert client.get(f"/api/projects/{project_id}/members").status_code == 404

    use_actor(client, owner_cookie)
    added = client.post(
        f"/api/projects/{project_id}/members",
        json={"actor_id": legacy_actor_id, "role": "editor"},
    )
    assert added.status_code == 201, added.text
    removed = client.delete(f"/api/projects/{project_id}/members/{legacy_actor_id}")
    assert removed.status_code == 204, removed.text

    with client.app.state.session_factory() as db:
        remaining = (
            db.query(models.ProjectAccess)
            .filter(
                models.ProjectAccess.project_id == uuid.UUID(project_id),
                models.ProjectAccess.actor_id == uuid.UUID(legacy_actor_id),
            )
            .count()
        )
        assert remaining == 0
    use_actor(client, legacy_cookie)
    assert client.get(f"/api/projects/{project_id}/members").status_code == 404


def test_dev_migration_promotes_only_active_legacy_grants() -> None:
    migration_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(migration_engine)
    now = datetime.now(timezone.utc)
    with Session(migration_engine) as db:
        actors = {
            name: models.Actor(display_name=name, last_ip_hash=(name[0].lower() * 64))
            for name in ("Owner", "Active", "Revoked", "Expired")
        }
        db.add_all(actors.values())
        db.flush()
        project = models.Project(
            name="Legacy grants",
            owner_actor_id=actors["Owner"].id,
            created_by_actor_id=actors["Owner"].id,
            creator_display_name=actors["Owner"].display_name,
        )
        db.add(project)
        db.flush()
        links = {
            "Active": models.ProjectShareLink(
                project_id=project.id,
                created_by_actor_id=actors["Owner"].id,
                token_hash="a" * 64,
                permission="editor",
                expires_at=now + timedelta(days=1),
            ),
            "Revoked": models.ProjectShareLink(
                project_id=project.id,
                created_by_actor_id=actors["Owner"].id,
                token_hash="r" * 64,
                permission="editor",
                revoked_at=now - timedelta(minutes=1),
            ),
            "Expired": models.ProjectShareLink(
                project_id=project.id,
                created_by_actor_id=actors["Owner"].id,
                token_hash="e" * 64,
                permission="editor",
                expires_at=now - timedelta(minutes=1),
            ),
        }
        db.add_all(links.values())
        db.flush()
        for name, link in links.items():
            db.add(
                models.ProjectAccess(
                    project_id=project.id,
                    actor_id=actors[name].id,
                    permission="editor",
                    source_share_id=link.id,
                )
            )
        actor_ids = {name: actor.id for name, actor in actors.items()}
        project_id = project.id
        db.commit()

    run_local_dev_migrations(migration_engine)
    with Session(migration_engine) as db:
        roles = {
            member.actor_id: member.role
            for member in db.query(models.ProjectMember)
            .filter(models.ProjectMember.project_id == project_id)
            .all()
        }
        assert roles[actor_ids["Owner"]] == "owner"
        assert roles[actor_ids["Active"]] == "editor"
        assert actor_ids["Revoked"] not in roles
        assert actor_ids["Expired"] not in roles
        assert all(db.get(models.Actor, actor_id).legacy_claim_ip_hash for actor_id in actor_ids.values())


def test_legacy_claim_requires_same_pre_migration_actor_and_ip_snapshot(
    client: TestClient,
    monkeypatch,
) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(settings, "allow_legacy_project_claims", True)
    old_actor_id, old_cookie = current_actor(client)
    project_id = create_project(client)
    migration_time = datetime.now(timezone.utc) - timedelta(days=1)

    with client.app.state.session_factory() as db:
        project = db.get(models.Project, uuid.UUID(project_id))
        actor = db.get(models.Actor, uuid.UUID(old_actor_id))
        assert project is not None and actor is not None and actor.last_ip_hash is not None
        db.query(models.ProjectMember).filter(models.ProjectMember.project_id == project.id).delete()
        project.owner_actor_id = None
        project.created_by_actor_id = None
        project.creator_display_name = "Legacy Import"
        project.is_legacy_unclaimed = True
        actor.created_at = migration_time - timedelta(days=1)
        actor.legacy_claim_ip_hash = actor.last_ip_hash
        db.add(
            models.ProjectAuditEvent(
                project_id=project.id,
                actor_label_snapshot="System",
                event_type="project.migrated_v2",
                target_type="project",
                target_id=project.id,
                summary="Migration boundary",
                details_json={},
                created_at=migration_time,
            )
        )
        db.commit()

    use_actor(client, old_cookie)
    claimed = client.post(f"/api/projects/{project_id}/claim-legacy")
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["my_role"] == "owner"

    second_project_id = create_project(client)
    with client.app.state.session_factory() as db:
        project = db.get(models.Project, uuid.UUID(second_project_id))
        assert project is not None
        db.query(models.ProjectMember).filter(models.ProjectMember.project_id == project.id).delete()
        project.owner_actor_id = None
        project.created_by_actor_id = None
        project.creator_display_name = "Legacy Import"
        project.is_legacy_unclaimed = True
        db.add(
            models.ProjectAuditEvent(
                project_id=project.id,
                actor_label_snapshot="System",
                event_type="project.migrated_v2",
                target_type="project",
                target_id=project.id,
                summary="Migration boundary",
                details_json={},
                created_at=migration_time,
            )
        )
        db.commit()

    new_actor_id, _new_cookie = create_anonymous_actor(client)
    with client.app.state.session_factory() as db:
        new_actor = db.get(models.Actor, uuid.UUID(new_actor_id))
        assert new_actor is not None and new_actor.last_ip_hash is not None
        # Even granting a matching frozen hash cannot make a post-migration
        # cookie Actor eligible.
        new_actor.legacy_claim_ip_hash = new_actor.last_ip_hash
        db.commit()
    denied = client.post(f"/api/projects/{second_project_id}/claim-legacy")
    assert denied.status_code == 403, denied.text


def test_project_patch_requires_admin_role_and_a_live_lease(client: TestClient) -> None:
    _owner_id, owner_cookie = current_actor(client)
    project_id = create_project(client)
    released = client.delete(f"/api/projects/{project_id}/lease")
    assert released.status_code == 204, released.text
    editor_id, editor_cookie = create_anonymous_actor(client)
    admin_id, admin_cookie = create_anonymous_actor(client)

    use_actor(client, owner_cookie)
    assert client.post(
        f"/api/projects/{project_id}/members",
        json={"actor_id": editor_id, "role": "editor"},
    ).status_code == 201
    assert client.post(
        f"/api/projects/{project_id}/members",
        json={"actor_id": admin_id, "role": "admin"},
    ).status_code == 201

    use_actor(client, editor_cookie)
    editor_lease = client.post(
        f"/api/projects/{project_id}/lease",
        json={"client_instance_id": "editor-project-settings"},
    )
    assert editor_lease.status_code == 200, editor_lease.text
    client.headers["X-Edit-Lease"] = editor_lease.json()["lease_token"]
    client.headers["If-Match"] = f'"{editor_lease.json()["revision"]}"'
    denied = client.patch(f"/api/projects/{project_id}", json={"description": "editor change"})
    assert denied.status_code == 403, denied.text
    assert client.delete(f"/api/projects/{project_id}/lease").status_code == 204

    use_actor(client, admin_cookie)
    admin_lease = client.post(
        f"/api/projects/{project_id}/lease",
        json={"client_instance_id": "admin-project-settings"},
    )
    assert admin_lease.status_code == 200, admin_lease.text
    client.headers["X-Edit-Lease"] = admin_lease.json()["lease_token"]
    client.headers["If-Match"] = f'"{admin_lease.json()["revision"]}"'
    updated = client.patch(f"/api/projects/{project_id}", json={"description": "admin change"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["description"] == "admin change"


def test_lease_acquire_release_and_force_takeover_are_audited(client: TestClient) -> None:
    project_id = create_project(client)
    heartbeat = client.put(
        f"/api/projects/{project_id}/lease",
        json={"client_instance_id": "pytest-main"},
    )
    assert heartbeat.status_code == 200, heartbeat.text
    assert client.delete(f"/api/projects/{project_id}/lease").status_code == 204

    acquired = client.post(
        f"/api/projects/{project_id}/lease",
        json={"client_instance_id": "owner-tab-a"},
    )
    assert acquired.status_code == 200, acquired.text
    forced = client.post(
        f"/api/projects/{project_id}/lease",
        json={"client_instance_id": "owner-tab-b", "force": True},
    )
    assert forced.status_code == 200, forced.text

    events = client.get(f"/api/projects/{project_id}/audit-events").json()
    event_types = [event["event_type"] for event in events]
    assert event_types.count("lease.acquired") >= 2
    assert "lease.released" in event_types
    assert "lease.force_taken_over" in event_types
    assert "lease.heartbeat" not in event_types
    lease_details = [event["details_json"] for event in events if event["event_type"].startswith("lease.")]
    assert "token" not in str(lease_details).lower()

    change_events = client.get(
        f"/api/projects/{project_id}/audit-events",
        params={"changes_only": "true"},
    ).json()
    assert change_events
    assert all(not event["event_type"].startswith("lease.") for event in change_events)
    assert all(not event["event_type"].startswith("project.migrated") for event in change_events)


def test_user_search_is_project_scoped_admin_only_and_minimum_two_characters(
    client: TestClient,
) -> None:
    _owner_id, owner_cookie = current_actor(client)
    project_id = create_project(client)
    candidate_id, candidate_cookie = create_anonymous_actor(client)
    assert client.patch("/api/me", json={"display_name": "Candidate Person"}).status_code == 200
    editor_id, editor_cookie = create_anonymous_actor(client)

    use_actor(client, owner_cookie)
    assert client.post(
        f"/api/projects/{project_id}/members",
        json={"actor_id": editor_id, "role": "editor"},
    ).status_code == 201
    assert client.get("/api/users", params={"query": "Candidate"}).status_code == 404
    assert client.get(f"/api/projects/{project_id}/users", params={"query": "C"}).status_code == 422
    found = client.get(
        f"/api/projects/{project_id}/users",
        params={"query": "Candidate"},
    )
    assert found.status_code == 200, found.text
    candidate = next(row for row in found.json() if row["id"] == candidate_id)
    assert set(candidate) == {"id", "display_name"}

    use_actor(client, editor_cookie)
    assert client.get(
        f"/api/projects/{project_id}/users",
        params={"query": "Candidate"},
    ).status_code == 403
    use_actor(client, candidate_cookie)
    assert client.get(
        f"/api/projects/{project_id}/users",
        params={"query": "Candidate"},
    ).status_code == 404
