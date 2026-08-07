"""Add review attachments and mention notifications.

Revision ID: 0006_review_collaboration
Revises: 0005_review_threads
"""

import sqlalchemy as sa
from alembic import op

revision = "0006_review_collaboration"
down_revision = "0005_review_threads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comment_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("filename", sa.String(length=240), nullable=False),
        sa.Column("mime_type", sa.String(length=40), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["review_comments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_review_attachments_comment_id", "review_attachments", ["comment_id"])
    op.create_table(
        "review_notifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("thread_id", sa.Uuid(), nullable=False),
        sa.Column("comment_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["thread_id"], ["review_threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["comment_id"], ["review_comments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["actors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("comment_id", "actor_id", name="uq_review_notifications_comment_actor"),
    )
    for column in ("project_id", "thread_id", "comment_id", "actor_id", "read_at", "created_at"):
        op.create_index(f"ix_review_notifications_{column}", "review_notifications", [column])


def downgrade() -> None:
    op.drop_table("review_notifications")
    op.drop_table("review_attachments")
