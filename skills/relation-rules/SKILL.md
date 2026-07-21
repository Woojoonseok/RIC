---
name: relation-rules
description: Apply and review RIC Align Tree layer relation and merge behavior. Use whenever changing Layer Relation creation, Source/Target selection, merge/split logic, same_group handling, graph display, validation, or relation tests in this repository.
---

# RIC Relation Rules

Before editing relation or merge behavior, inspect `frontend-vue/src/domain/graph.ts`, `frontend-vue/src/stores/graph.ts`, `backend/app/routers/graph.py`, and their tests.

## Invariants

1. Treat Merge and Relation as different concepts. Merge membership uses `same_group`; it is not a directed parent-child relation.
2. Never convert an existing ordinary Relation into a Merge membership. Reject a Merge when any selected pair already has a non-`same_group` relation.
3. Require both Source and Target for every ordinary Layer Relation created from the Data UI. Never persist a half-filled table row.
4. Expand a relation across a merged endpoint:
   - If merged layers `1` and `2` connect to individual layer `3`, create `1 -> 3` and `2 -> 3`.
   - If individual layer `1` connects to merged layers `2` and `3`, create `1 -> 2` and `1 -> 3`.
   - Reject merged-group to merged-group connections.
5. Exclude self-relations and exact duplicate `(source, target, instance)` relations.
6. Keep the first member as the display anchor only; do not use display anchoring to collapse the raw expanded relations.
7. When connecting a merged source to the middle of an existing relation line, resolve that line's final Target layer and expand normal relations to it. Preserve both the final `child_layer_id` and the clicked line's `attached_relation_id` plus attachment waypoint. For `4 -> 3` plus merged source `1, 2`, preserve `4 -> 3`, add raw `1 -> 3` and `2 -> 3`, and render the merged line at the clicked midpoint instead of directly at Layer 3.

## Required checks

- Update or add frontend unit tests for relation expansion.
- Update or add backend API tests for Merge rejection when a Relation exists.
- Run frontend typecheck and tests plus relevant backend tests.
- Confirm the Data UI creates relations through one Source-to-Target picker.
