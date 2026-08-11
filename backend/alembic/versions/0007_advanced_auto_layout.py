"""Add pinned state for advanced automatic layout.

Revision ID: 0007_advanced_auto_layout
Revises: 0006_review_collaboration
"""

import sqlalchemy as sa
from alembic import op

revision = "0007_advanced_auto_layout"
down_revision = "0006_review_collaboration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("graph_layouts")}
    if "pinned" not in columns:
        op.add_column(
            "graph_layouts",
            sa.Column("pinned", sa.Boolean(), server_default=sa.false(), nullable=False),
        )


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("graph_layouts")}
    if "pinned" in columns:
        op.drop_column("graph_layouts", "pinned")
