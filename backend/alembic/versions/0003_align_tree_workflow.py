"""Add Align Tree review and publication workflow.

Revision ID: 0003_align_tree_workflow
Revises: 0002_graph_snapshots
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_align_tree_workflow"
down_revision = "0002_graph_snapshots"
branch_labels = None
depends_on = None

COLUMNS = {
    "workflow_status": sa.Column("workflow_status", sa.String(length=20), server_default="draft", nullable=False),
    "workflow_note": sa.Column("workflow_note", sa.Text(), nullable=True),
    "review_requested_by_actor_id": sa.Column("review_requested_by_actor_id", sa.Uuid(), nullable=True),
    "review_requested_by_label": sa.Column("review_requested_by_label", sa.String(length=120), nullable=True),
    "review_requested_at": sa.Column("review_requested_at", sa.DateTime(timezone=True), nullable=True),
    "reviewed_by_actor_id": sa.Column("reviewed_by_actor_id", sa.Uuid(), nullable=True),
    "reviewed_by_label": sa.Column("reviewed_by_label", sa.String(length=120), nullable=True),
    "reviewed_at": sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    "approved_snapshot_id": sa.Column("approved_snapshot_id", sa.Uuid(), nullable=True),
    "published_snapshot_id": sa.Column("published_snapshot_id", sa.Uuid(), nullable=True),
    "published_by_actor_id": sa.Column("published_by_actor_id", sa.Uuid(), nullable=True),
    "published_by_label": sa.Column("published_by_label", sa.String(length=120), nullable=True),
    "published_at": sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
}


def upgrade() -> None:
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("align_trees")}
    with op.batch_alter_table("align_trees") as batch:
        for name, column in COLUMNS.items():
            if name not in existing:
                batch.add_column(column)


def downgrade() -> None:
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("align_trees")}
    with op.batch_alter_table("align_trees") as batch:
        for name in reversed(COLUMNS):
            if name in existing:
                batch.drop_column(name)
