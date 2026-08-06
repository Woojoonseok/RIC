"""Add configurable project validation rules.

Revision ID: 0004_validation_rules
Revises: 0003_align_tree_workflow
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_validation_rules"
down_revision = "0003_align_tree_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "validation_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("rule_type", sa.String(length=30), nullable=False),
        sa.Column("field_name", sa.String(length=80), nullable=False),
        sa.Column("expected_values", sa.JSON(), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "name", name="uq_validation_rules_project_name"),
    )
    op.create_index("ix_validation_rules_project_id", "validation_rules", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_validation_rules_project_id", table_name="validation_rules")
    op.drop_table("validation_rules")
