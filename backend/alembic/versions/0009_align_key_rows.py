"""Persist project Align Key table rows.

Revision ID: 0009_align_key_rows
Revises: 0008_layer_color
"""

import sqlalchemy as sa
from alembic import op

revision = "0009_align_key_rows"
down_revision = "0008_layer_color"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "align_key_rows" in tables:
        return
    op.create_table(
        "align_key_rows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("key_name", sa.String(length=160), server_default="", nullable=False),
        sa.Column("key_type", sa.String(length=160), server_default="", nullable=False),
        sa.Column("layer", sa.String(length=160), server_default="", nullable=False),
        sa.Column("comment", sa.Text(), server_default="", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_align_key_rows_project_id", "align_key_rows", ["project_id"])


def downgrade() -> None:
    if "align_key_rows" in set(sa.inspect(op.get_bind()).get_table_names()):
        op.drop_index("ix_align_key_rows_project_id", table_name="align_key_rows")
        op.drop_table("align_key_rows")
