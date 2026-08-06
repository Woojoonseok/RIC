"""Add immutable Align Tree graph snapshots.

Revision ID: 0002_graph_snapshots
Revises: 0001_baseline
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_graph_snapshots"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "graph_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("align_tree_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by_actor_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_label", sa.String(length=120), nullable=False),
        sa.Column("project_revision", sa.Integer(), nullable=False),
        sa.Column("graph_json", sa.JSON(), nullable=False),
        sa.Column("tree_json", sa.JSON(), nullable=False),
        sa.Column("summary_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["align_tree_id"], ["align_trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_actor_id"], ["actors.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_graph_snapshots_project_id", "graph_snapshots", ["project_id"])
    op.create_index("ix_graph_snapshots_align_tree_id", "graph_snapshots", ["align_tree_id"])
    op.create_index("ix_graph_snapshots_created_by_actor_id", "graph_snapshots", ["created_by_actor_id"])
    op.create_index("ix_graph_snapshots_created_at", "graph_snapshots", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_graph_snapshots_created_at", table_name="graph_snapshots")
    op.drop_index("ix_graph_snapshots_created_by_actor_id", table_name="graph_snapshots")
    op.drop_index("ix_graph_snapshots_align_tree_id", table_name="graph_snapshots")
    op.drop_index("ix_graph_snapshots_project_id", table_name="graph_snapshots")
    op.drop_table("graph_snapshots")
