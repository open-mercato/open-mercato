# Execution plan — workflow instance business key (idempotent start) + subject indexes

Source issue: open-mercato/open-mercato#7182
Spec: `.ai/specs/2026-10-11-workflow-instance-business-key.md` (written in Phase 1)

## Goal

Let a host start a workflow instance exactly once per business key (concurrent or redelivered starts
converge on one instance), and let instances and user tasks be listed by subject through an index.

## Scope

- `packages/core/src/modules/workflows` only: entity, migration + snapshot, executor, validators,
  instances/tasks list + start API, OpenAPI, tests, module AGENTS.md.
- Docs: `apps/docs/docs/framework/workflows/*` (one section).
- Spec under `.ai/specs/`.

## Non-goals

- Event-trigger-level business keys (triggers keep their debounce/concurrency controls) — follow-up.
- Promoting the subject to dedicated columns (the GIN path the issue allows is chosen instead; see spec).
- UI changes. No ACL changes.

## Design summary

- `workflow_instances.business_key varchar(255) null`.
- Partial UNIQUE index `(tenant_id, organization_id, workflow_id, business_key)` over OPEN instances
  (key not null, not deleted, status not terminal) — the DB arbiter for concurrent starts; plus a
  partial non-unique lookup index over all keyed rows for the reuse-policy lookup.
- `startOrReuseWorkflow(em, options) → { instance, created }` (new export); `startWorkflow` delegates
  and keeps its signature/return type. `reusePolicy`: `reject_duplicate` (default) |
  `allow_duplicate` | `allow_duplicate_failed_only`. The insert runs in a nested transaction
  (savepoint) so a unique violation never poisons a caller's transaction; the loser re-reads the winner.
- GIN `jsonb_path_ops` indexes on `workflow_instances.metadata` and `user_tasks.entity_bindings`, so the
  existing `@>` subject filters become index-backed; tasks list gains `entityType`/`entityId` filters.

## Risks

- Partial unique index predicate couples to the terminal-status set — documented in entity + spec.
- Migration builds three indexes on potentially large tables (not CONCURRENTLY, matching module style).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Spec and schema

- [ ] 1.1 Write spec
- [ ] 1.2 Entity columns/indexes, migration and snapshot

### Phase 2: Engine

- [ ] 2.1 startOrReuseWorkflow with business key and reuse policy
- [ ] 2.2 Executor unit tests

### Phase 3: API

- [ ] 3.1 Start API accepts businessKey/reusePolicy; instance list businessKey filter
- [ ] 3.2 Task list subject filter
- [ ] 3.3 Route tests

### Phase 4: Docs and verification

- [ ] 4.1 Docs and module AGENTS.md
- [ ] 4.2 EXPLAIN and concurrency evidence against Postgres
- [ ] 4.3 Full validation gate
