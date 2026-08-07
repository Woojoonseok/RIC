"""Add review threads and comments.

Revision ID: 0005_review_threads
Revises: 0004_validation_rules
"""

import sqlalchemy as sa
from alembic import op

revision = "0005_review_threads"
down_revision = "0004_validation_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_threads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("align_tree_id", sa.Uuid(), nullable=False),
        sa.Column("target_type", sa.String(length=30), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("target_key", sa.String(length=240), nullable=True),
        sa.Column("target_label", sa.String(length=240), nullable=False),
        sa.Column("anchor_x", sa.Float(), nullable=True),
        sa.Column("anchor_y", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="open", nullable=False),
        sa.Column("created_by_actor_id", sa.Uuid(), nullable=True),
        sa.Column("assignee_actor_id", sa.Uuid(), nullable=True),
        sa.Column("resolved_by_actor_id", sa.Uuid(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["align_tree_id"], ["align_trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_actor_id"], ["actors.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assignee_actor_id"], ["actors.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by_actor_id"], ["actors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("project_id", "align_tree_id", "target_type", "target_id", "status", "created_by_actor_id", "assignee_actor_id"):
        op.create_index(f"ix_review_threads_{column}", "review_threads", [column])

    op.create_table(
        "review_comments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("thread_id", sa.Uuid(), nullable=False),
        sa.Column("parent_comment_id", sa.Uuid(), nullable=True),
        sa.Column("author_actor_id", sa.Uuid(), nullable=True),
        sa.Column("author_label", sa.String(length=120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["thread_id"], ["review_threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_comment_id"], ["review_comments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["author_actor_id"], ["actors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("thread_id", "parent_comment_id", "author_actor_id"):
        op.create_index(f"ix_review_comments_{column}", "review_comments", [column])


def downgrade() -> None:
    op.drop_table("review_comments")
    op.drop_table("review_threads")
