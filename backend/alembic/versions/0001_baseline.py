"""Create the RIC workspace schema baseline.

Revision ID: 0001_baseline
Revises:
"""

from alembic import op

from app import models
from app.database import Base

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

BASELINE_TABLE_NAMES = {
    "actors",
    "actor_identities",
    "projects",
    "project_members",
    "project_access_requests",
    "project_audit_events",
    "align_trees",
    "project_access",
    "project_share_links",
    "project_edit_leases",
    "layers",
    "layer_relations",
    "relation_extras",
    "relation_styles",
    "box_presets",
    "key_layout_types",
    "key_drawing_types",
    "key_shapes",
    "layer_masters",
    "layer_master_priorities",
    "graph_layouts",
    "shape_styles",
    "text_boxes",
    "change_history",
}


def upgrade() -> None:
    baseline_tables = [table for table in Base.metadata.sorted_tables if table.name in BASELINE_TABLE_NAMES]
    Base.metadata.create_all(bind=op.get_bind(), tables=baseline_tables)


def downgrade() -> None:
    raise RuntimeError("The baseline migration cannot be downgraded because it would delete all project data.")


_models = models
