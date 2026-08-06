from __future__ import annotations

import uuid
from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from .. import models, schemas


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _target_label(target_type: str, row: Any) -> str:
    if target_type == "layer":
        return f"Layer '{row.name}'"
    if target_type == "align_tree":
        return f"Editor '{row.name}'"
    return f"Relation {row.id}"


def _message(rule: models.ValidationRule, row: Any, value: Any, default: str) -> str:
    if not rule.message:
        return default
    replacements = {
        "{target}": _target_label(rule.target_type, row),
        "{field}": rule.field_name,
        "{value}": "" if value is None else str(value),
    }
    message = rule.message
    for token, replacement in replacements.items():
        message = message.replace(token, replacement)
    return message


def evaluate_validation_rules(
    db: Session,
    project_id: uuid.UUID,
    tree: models.AlignTree,
    layers: list[models.Layer],
    relations: list[models.LayerRelation],
) -> list[schemas.ValidationIssue]:
    rules = (
        db.query(models.ValidationRule)
        .filter(models.ValidationRule.project_id == project_id, models.ValidationRule.enabled.is_(True))
        .order_by(models.ValidationRule.sort_order, models.ValidationRule.created_at)
        .all()
    )
    targets: dict[str, list[Any]] = {
        "layer": layers,
        "relation": relations,
        "align_tree": [tree],
    }
    issues: list[schemas.ValidationIssue] = []
    for rule in rules:
        rows = targets.get(rule.target_type, [])
        if rule.rule_type == "unique":
            values: dict[str, list[Any]] = defaultdict(list)
            for row in rows:
                value = getattr(row, rule.field_name, None)
                if not _blank(value):
                    values[str(value).strip().casefold()].append(row)
            failing = [row for duplicate_rows in values.values() if len(duplicate_rows) > 1 for row in duplicate_rows]
        else:
            failing = []
            allowed = {value.casefold() for value in rule.expected_values}
            for row in rows:
                value = getattr(row, rule.field_name, None)
                missing_required = rule.rule_type == "required" and _blank(value)
                outside_allowed = (
                    rule.rule_type == "allowed_values"
                    and not _blank(value)
                    and str(value).strip().casefold() not in allowed
                )
                if missing_required or outside_allowed:
                    failing.append(row)
        for row in failing:
            value = getattr(row, rule.field_name, None)
            default = (
                f"{_target_label(rule.target_type, row)} requires {rule.field_name}."
                if rule.rule_type == "required"
                else f"{_target_label(rule.target_type, row)} has an invalid {rule.field_name}."
                if rule.rule_type == "allowed_values"
                else f"{_target_label(rule.target_type, row)} duplicates {rule.field_name} '{value}'."
            )
            issues.append(schemas.ValidationIssue(
                code="custom_validation_rule",
                severity=rule.severity,
                message=_message(rule, row, value, default),
                layer_id=row.id if rule.target_type == "layer" else None,
                relation_id=row.id if rule.target_type == "relation" else None,
                rule_id=rule.id,
                rule_name=rule.name,
            ))
    return issues
