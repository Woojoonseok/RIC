"""Add the editor label color to layers.

Revision ID: 0008_layer_color
Revises: 0007_advanced_auto_layout
"""

import sqlalchemy as sa
from alembic import op

revision = "0008_layer_color"
down_revision = "0007_advanced_auto_layout"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("layers")}
    if "color" not in columns:
        op.add_column(
            "layers",
            sa.Column("color", sa.String(length=7), server_default="#101828", nullable=False),
        )


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("layers")}
    if "color" in columns:
        op.drop_column("layers", "color")
