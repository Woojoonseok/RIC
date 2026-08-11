from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, LargeBinary, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Actor(Base, TimestampMixin):
    """Stable internal user record.

    Authentication is anonymous for now: a signed HttpOnly cookie points at
    this row and the server-derived client IP HMAC provides recovery when the
    cookie is unavailable.
    Keeping identities separate lets a future AD subject be attached without
    moving project ownership.
    """

    __tablename__ = "actors"

    id: Mapped[uuid.UUID] = uuid_pk()
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    last_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # Frozen HMAC captured for Actors that existed when legacy projects were
    # migrated. It gates the one-time legacy-claim flow without storing an IP.
    legacy_claim_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    identities: Mapped[list[ActorIdentity]] = relationship(back_populates="actor", cascade="all, delete-orphan")
    owned_projects: Mapped[list[Project]] = relationship(back_populates="owner", foreign_keys="Project.owner_actor_id")


class ActorIdentity(Base, TimestampMixin):
    __tablename__ = "actor_identities"
    __table_args__ = (UniqueConstraint("provider", "subject_hash", name="uq_actor_identity_provider_subject"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("actors.id", ondelete="CASCADE"), index=True)
    # Reserved for authenticated providers. A future AD SSO integration can
    # add an ``ad`` identity whose subject is the immutable AD object id/SID.
    # IP hashes are kept on Actor for local anonymous recovery, not as an
    # authenticated external-provider identity.
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    subject_hash: Mapped[str] = mapped_column(String(128), nullable=False)

    actor: Mapped[Actor] = relationship(back_populates="identities")


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_by_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("actors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    creator_display_name: Mapped[str] = mapped_column(String(120), nullable=False, default="Legacy Import")
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    is_legacy_unclaimed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    # Nullable only for safe migration of pre-identity local databases. The
    # first-ever Actor claims those legacy rows; all newly-created rows have an
    # owner.
    owner_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("actors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    owner: Mapped[Actor | None] = relationship(back_populates="owned_projects", foreign_keys=[owner_actor_id])
    creator: Mapped[Actor | None] = relationship(foreign_keys=[created_by_actor_id])
    members: Mapped[list[ProjectMember]] = relationship(back_populates="project", cascade="all, delete-orphan")
    access_requests: Mapped[list[ProjectAccessRequest]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    audit_events: Mapped[list[ProjectAuditEvent]] = relationship(back_populates="project")
    align_trees: Mapped[list[AlignTree]] = relationship(back_populates="project", cascade="all, delete-orphan")
    access_grants: Mapped[list[ProjectAccess]] = relationship(back_populates="project", cascade="all, delete-orphan")
    share_links: Mapped[list[ProjectShareLink]] = relationship(back_populates="project", cascade="all, delete-orphan")
    edit_lease: Mapped[ProjectEditLease | None] = relationship(
        back_populates="project", cascade="all, delete-orphan", uselist=False
    )
    layers: Mapped[list[Layer]] = relationship(back_populates="project", cascade="all, delete-orphan")
    relations: Mapped[list[LayerRelation]] = relationship(back_populates="project", cascade="all, delete-orphan")
    layouts: Mapped[list[GraphLayout]] = relationship(back_populates="project", cascade="all, delete-orphan")
    styles: Mapped[list[ShapeStyle]] = relationship(back_populates="project", cascade="all, delete-orphan")
    text_boxes: Mapped[list[TextBox]] = relationship(back_populates="project", cascade="all, delete-orphan")


class ProjectMember(Base, TimestampMixin):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "actor_id", name="uq_project_members_project_actor"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("actors.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    added_by_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("actors.id", ondelete="SET NULL"), nullable=True
    )

    project: Mapped[Project] = relationship(back_populates="members")
    actor: Mapped[Actor] = relationship(foreign_keys=[actor_id])
    added_by: Mapped[Actor | None] = relationship(foreign_keys=[added_by_actor_id])


class ProjectAccessRequest(Base, TimestampMixin):
    __tablename__ = "project_access_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    requester_actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("actors.id", ondelete="CASCADE"), index=True)
    requested_role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    reviewed_by_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("actors.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped[Project] = relationship(back_populates="access_requests")
    requester: Mapped[Actor] = relationship(foreign_keys=[requester_actor_id])
    reviewed_by: Mapped[Actor | None] = relationship(foreign_keys=[reviewed_by_actor_id])


class ProjectAuditEvent(Base):
    __tablename__ = "project_audit_events"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="RESTRICT"), index=True)
    align_tree_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("align_trees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("actors.id", ondelete="SET NULL"), nullable=True)
    actor_label_snapshot: Mapped[str] = mapped_column(String(120), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(80), nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    details_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    request_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    project: Mapped[Project] = relationship(back_populates="audit_events")
    align_tree: Mapped[AlignTree | None] = relationship()
    actor: Mapped[Actor | None] = relationship()


class AlignTree(Base, TimestampMixin):
    __tablename__ = "align_trees"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_align_trees_project_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    process_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    gds_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    layer_process_names: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
    layer_gds_names: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
    final_table_cells: Mapped[dict[str, dict[str, str]]] = mapped_column(JSON, nullable=False, default=dict)
    created_by_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("actors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    workflow_status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", server_default="draft")
    workflow_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_requested_by_actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    review_requested_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    review_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    reviewed_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    published_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    published_by_actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    published_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    project: Mapped[Project] = relationship(back_populates="align_trees")
    created_by: Mapped[Actor | None] = relationship()


class ProjectAccess(Base, TimestampMixin):
    __tablename__ = "project_access"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "actor_id", "source_share_id", name="uq_project_access_project_actor_source"
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("actors.id", ondelete="CASCADE"), index=True)
    permission: Mapped[str] = mapped_column(String(20), nullable=False)
    source_share_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("project_share_links.id", ondelete="SET NULL"), nullable=True, index=True
    )

    project: Mapped[Project] = relationship(back_populates="access_grants")
    actor: Mapped[Actor] = relationship()
    source_share: Mapped[ProjectShareLink | None] = relationship(back_populates="access_grants")


class ProjectShareLink(Base, TimestampMixin):
    __tablename__ = "project_share_links"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    created_by_actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("actors.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    permission: Mapped[str] = mapped_column(String(20), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="share_links")
    created_by: Mapped[Actor] = relationship()
    access_grants: Mapped[list[ProjectAccess]] = relationship(back_populates="source_share")


class ProjectEditLease(Base, TimestampMixin):
    __tablename__ = "project_edit_leases"
    __table_args__ = (UniqueConstraint("project_id", name="uq_project_edit_lease_project"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("actors.id", ondelete="CASCADE"), index=True)
    client_instance_id: Mapped[str] = mapped_column(String(120), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    project: Mapped[Project] = relationship(back_populates="edit_lease")
    actor: Mapped[Actor] = relationship()


class Layer(Base, TimestampMixin):
    __tablename__ = "layers"
    __table_args__ = (UniqueConstraint("align_tree_id", "name", name="uq_layers_align_tree_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    align_tree_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("align_trees.id", ondelete="CASCADE"), nullable=True, index=True
    )
    layer_master_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("layer_masters.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    step: Mapped[str | None] = mapped_column(String(120))
    layer_property: Mapped[str | None] = mapped_column(String(160))
    align: Mapped[str | None] = mapped_column(String(160))
    align_side: Mapped[str | None] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(Text)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    box_preset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("box_presets.id", ondelete="SET NULL"), nullable=True, index=True)
    # Group membership normally lives on LayerRelation.same_group (it connects
    # two layers), which can't represent "this one layer has a group label but
    # no partner yet" — e.g. typing a group name into the Align Input grid
    # before a second layer gets the same name. This column holds that label
    # until a second layer joins, at which point a same_group relation is
    # created and this reverts to null (see _sync_layer_group).
    pending_group: Mapped[str | None] = mapped_column(String(80), nullable=True)

    project: Mapped[Project] = relationship(back_populates="layers")
    layout: Mapped[GraphLayout | None] = relationship(back_populates="layer", cascade="all, delete-orphan")
    style: Mapped[ShapeStyle | None] = relationship(back_populates="layer", cascade="all, delete-orphan")


class LayerRelation(Base, TimestampMixin):
    __tablename__ = "layer_relations"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    align_tree_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("align_trees.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Nullable so "Add Row" can create a blank relation the user fills in by
    # typing layer names, instead of requiring a valid pair up front.
    parent_endpoint_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="layer", server_default="layer"
    )
    child_endpoint_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="layer", server_default="layer"
    )
    parent_layer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("layers.id", ondelete="CASCADE"), nullable=True, index=True)
    child_layer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("layers.id", ondelete="CASCADE"), nullable=True, index=True)
    key_layout_type_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("key_layout_types.id", ondelete="SET NULL"), nullable=True, index=True
    )
    key_drawing_type_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("key_drawing_types.id", ondelete="SET NULL"), nullable=True, index=True
    )
    relation_type: Mapped[str] = mapped_column(String(80), default="parent_child")
    relation_style_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("relation_styles.id", ondelete="SET NULL"), index=True)
    parent_drawing_type_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("key_drawing_types.id", ondelete="SET NULL"), nullable=True, index=True
    )
    child_drawing_type_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("key_drawing_types.id", ondelete="SET NULL"), nullable=True, index=True
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_priority: Mapped[str | None] = mapped_column(String(120), nullable=True)
    priority_rule: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_type: Mapped[str | None] = mapped_column(String(160), nullable=True)
    key_purpose: Mapped[str | None] = mapped_column(String(160), nullable=True)
    placement: Mapped[str | None] = mapped_column(String(160), nullable=True)
    stack_type: Mapped[str | None] = mapped_column(String(160), nullable=True)
    inregi: Mapped[str | None] = mapped_column(String(160), nullable=True)
    inner_size: Mapped[str | None] = mapped_column(String(160), nullable=True)
    outer_size: Mapped[str | None] = mapped_column(String(160), nullable=True)
    source_port: Mapped[str] = mapped_column(String(20), default="bottom")
    target_port: Mapped[str] = mapped_column(String(20), default="top")
    same_group: Mapped[str | None] = mapped_column(String(80), nullable=True)
    attached_relation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("layer_relations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    waypoints: Mapped[list[dict[str, float]] | None] = mapped_column(JSON, default=list)

    project: Mapped[Project] = relationship(back_populates="relations")
    parent_layer: Mapped[Layer | None] = relationship(foreign_keys=[parent_layer_id])
    child_layer: Mapped[Layer | None] = relationship(foreign_keys=[child_layer_id])
    relation_style: Mapped[RelationStyle | None] = relationship(foreign_keys=[relation_style_id])
    extras: Mapped[list[RelationExtra]] = relationship(
        back_populates="relation",
        cascade="all, delete-orphan",
        order_by="RelationExtra.sort_order",
    )


class RelationExtra(Base, TimestampMixin):
    __tablename__ = "relation_extras"
    __table_args__ = (
        UniqueConstraint("relation_id", "sort_order", name="uq_relation_extras_relation_order"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    relation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("layer_relations.id", ondelete="CASCADE"), index=True
    )
    layer_master_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("layer_masters.id", ondelete="CASCADE"), index=True
    )
    key_drawing_type_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("key_drawing_types.id", ondelete="CASCADE"), index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    relation: Mapped[LayerRelation] = relationship(back_populates="extras")
    layer_master: Mapped[LayerMaster] = relationship()
    key_drawing_type: Mapped[KeyDrawingType] = relationship()


class RelationStyle(Base, TimestampMixin):
    __tablename__ = "relation_styles"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_relation_styles_project_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    stroke_color: Mapped[str] = mapped_column(String(20), default="#111827")
    stroke_width: Mapped[int] = mapped_column(Integer, default=2)
    line_pattern: Mapped[str] = mapped_column(String(40), default="solid")
    marker_type: Mapped[str] = mapped_column(String(40), default="arrow")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class BoxPreset(Base, TimestampMixin):
    __tablename__ = "box_presets"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_box_presets_project_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    fill_color: Mapped[str] = mapped_column(String(20), default="#dbeafe")
    stroke_color: Mapped[str] = mapped_column(String(20), default="#2563eb")
    text_color: Mapped[str] = mapped_column(String(20), default="#111827")
    font_size: Mapped[int] = mapped_column(Integer, default=16)
    width: Mapped[float] = mapped_column(Float, default=180)
    height: Mapped[float] = mapped_column(Float, default=72)
    stroke_width: Mapped[int] = mapped_column(Integer, default=2)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class KeyLayoutType(Base, TimestampMixin):
    __tablename__ = "key_layout_types"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_key_layout_types_project_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    scribe_lane_rows: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class KeyDrawingType(Base, TimestampMixin):
    __tablename__ = "key_drawing_types"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    symbol: Mapped[str | None] = mapped_column(String(80), nullable=True)
    trench_mesa: Mapped[str | None] = mapped_column(String(80), nullable=True)
    key_shape: Mapped[str | None] = mapped_column(String(120), nullable=True)
    ri_notation: Mapped[str | None] = mapped_column(String(120), nullable=True)
    drawing_guide: Mapped[str | None] = mapped_column(String(200), nullable=True)
    gds_path: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class KeyShape(Base, TimestampMixin):
    __tablename__ = "key_shapes"
    __table_args__ = (UniqueConstraint("project_id", "key_shape", name="uq_key_shapes_project_key_shape"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    key_shape: Mapped[str] = mapped_column(String(120), nullable=False)
    drawing_guide: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ValidationRule(Base, TimestampMixin):
    __tablename__ = "validation_rules"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_validation_rules_project_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    rule_type: Mapped[str] = mapped_column(String(30), nullable=False)
    field_name: Mapped[str] = mapped_column(String(80), nullable=False)
    expected_values: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="error")
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class LayerMaster(Base, TimestampMixin):
    __tablename__ = "layer_masters"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_layer_masters_project_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    layer_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    mask_main_fld: Mapped[str | None] = mapped_column(String(40), nullable=True)
    mask_sl_fld: Mapped[str | None] = mapped_column(String(40), nullable=True)
    pr_wf: Mapped[str | None] = mapped_column(String(40), nullable=True)
    dev_wf: Mapped[str | None] = mapped_column(String(40), nullable=True)
    pr_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    light_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    pr_open_close: Mapped[str | None] = mapped_column(String(40), nullable=True)
    group: Mapped[str | None] = mapped_column(String(80), nullable=True)
    validation_rule: Mapped[str | None] = mapped_column(Text, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    priorities: Mapped[list["LayerMasterPriority"]] = relationship(
        back_populates="layer_master", cascade="all, delete-orphan"
    )


class LayerMasterPriority(Base, TimestampMixin):
    """One "Layer의 우선순위 {Key 배치 Type}" cell for a LayerMaster row. The set
    of columns shown in the Layer 정보 grid tracks whatever Key 배치 Type rows
    currently exist in 기준정보 — so this is a row per (layer_master,
    key_layout_type) pair instead of fixed priority_* columns, letting the
    column count grow/shrink with 기준정보 without a schema change.
    """

    __tablename__ = "layer_master_priorities"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "layer_master_id", "key_layout_type_id", name="uq_layer_master_priorities_project_pair"
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    layer_master_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("layer_masters.id", ondelete="CASCADE"), index=True
    )
    key_layout_type_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("key_layout_types.id", ondelete="CASCADE"), index=True
    )
    value: Mapped[str | None] = mapped_column(String(40), nullable=True)

    layer_master: Mapped[LayerMaster] = relationship(back_populates="priorities")
    key_layout_type: Mapped[KeyLayoutType] = relationship()


class GraphLayout(Base, TimestampMixin):
    __tablename__ = "graph_layouts"
    __table_args__ = (UniqueConstraint("align_tree_id", "layer_id", name="uq_layouts_align_tree_layer"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    align_tree_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("align_trees.id", ondelete="CASCADE"), nullable=True, index=True
    )
    layer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("layers.id", ondelete="CASCADE"), index=True)
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)
    width: Mapped[float] = mapped_column(Float, default=180)
    height: Mapped[float] = mapped_column(Float, default=72)
    z_index: Mapped[int] = mapped_column(Integer, default=0)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    project: Mapped[Project] = relationship(back_populates="layouts")
    layer: Mapped[Layer] = relationship(back_populates="layout")


class ShapeStyle(Base, TimestampMixin):
    __tablename__ = "shape_styles"
    __table_args__ = (UniqueConstraint("align_tree_id", "layer_id", name="uq_styles_align_tree_layer"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    align_tree_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("align_trees.id", ondelete="CASCADE"), nullable=True, index=True
    )
    layer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("layers.id", ondelete="CASCADE"), index=True)
    fill_color: Mapped[str] = mapped_column(String(20), default="#ffffff")
    stroke_color: Mapped[str] = mapped_column(String(20), default="#2563eb")
    text_color: Mapped[str] = mapped_column(String(20), default="#111827")
    font_size: Mapped[int] = mapped_column(Integer, default=14)
    stroke_width: Mapped[int] = mapped_column(Integer, default=2)

    project: Mapped[Project] = relationship(back_populates="styles")
    layer: Mapped[Layer] = relationship(back_populates="style")


class TextBox(Base, TimestampMixin):
    __tablename__ = "text_boxes"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    align_tree_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("align_trees.id", ondelete="CASCADE"), nullable=True, index=True
    )
    text: Mapped[str] = mapped_column(Text, default="Text")
    shape_type: Mapped[str] = mapped_column(String(20), default="text", server_default="text")
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)
    width: Mapped[float] = mapped_column(Float, default=180)
    height: Mapped[float] = mapped_column(Float, default=44)
    text_color: Mapped[str] = mapped_column(String(20), default="#111827")
    font_size: Mapped[int] = mapped_column(Integer, default=16)
    background_color: Mapped[str] = mapped_column(String(20), default="#ffffff")
    border_color: Mapped[str] = mapped_column(String(20), default="#d1d5db")
    locked: Mapped[bool] = mapped_column(Boolean, default=False)

    project: Mapped[Project] = relationship(back_populates="text_boxes")


class GraphSnapshot(Base):
    __tablename__ = "graph_snapshots"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    align_tree_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("align_trees.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("actors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by_label: Mapped[str] = mapped_column(String(120), nullable=False)
    project_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    graph_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    tree_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    summary_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), server_default=func.now(), index=True
    )


class ReviewThread(Base, TimestampMixin):
    __tablename__ = "review_threads"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    align_tree_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("align_trees.id", ondelete="CASCADE"), index=True)
    target_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True, index=True)
    target_key: Mapped[str | None] = mapped_column(String(240), nullable=True)
    target_label: Mapped[str] = mapped_column(String(240), nullable=False)
    anchor_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default="open", index=True)
    created_by_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("actors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assignee_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("actors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    resolved_by_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("actors.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[Actor | None] = relationship(foreign_keys=[created_by_actor_id])
    assignee: Mapped[Actor | None] = relationship(foreign_keys=[assignee_actor_id])
    resolved_by: Mapped[Actor | None] = relationship(foreign_keys=[resolved_by_actor_id])
    comments: Mapped[list[ReviewComment]] = relationship(
        back_populates="thread", cascade="all, delete-orphan", order_by="ReviewComment.created_at"
    )


class ReviewComment(Base, TimestampMixin):
    __tablename__ = "review_comments"

    id: Mapped[uuid.UUID] = uuid_pk()
    thread_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("review_threads.id", ondelete="CASCADE"), index=True)
    parent_comment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("review_comments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    author_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("actors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    author_label: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    thread: Mapped[ReviewThread] = relationship(back_populates="comments")
    author: Mapped[Actor | None] = relationship(foreign_keys=[author_actor_id])
    attachments: Mapped[list[ReviewAttachment]] = relationship(
        back_populates="comment", cascade="all, delete-orphan", order_by="ReviewAttachment.created_at"
    )


class ReviewAttachment(Base):
    __tablename__ = "review_attachments"

    id: Mapped[uuid.UUID] = uuid_pk()
    comment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("review_comments.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    filename: Mapped[str] = mapped_column(String(240), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(40), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    comment: Mapped[ReviewComment] = relationship(back_populates="attachments")


class ReviewNotification(Base):
    __tablename__ = "review_notifications"
    __table_args__ = (
        UniqueConstraint("comment_id", "actor_id", name="uq_review_notifications_comment_actor"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("review_threads.id", ondelete="CASCADE"), index=True)
    comment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("review_comments.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("actors.id", ondelete="CASCADE"), index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class ChangeHistory(Base, TimestampMixin):
    __tablename__ = "change_history"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
