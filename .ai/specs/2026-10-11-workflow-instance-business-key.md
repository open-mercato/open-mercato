# Workflow instance business key (idempotent start) and subject indexes

- **Status:** Implemented (PR open)
- **Issue:** open-mercato/open-mercato#7182
- **Module:** `packages/core/src/modules/workflows`
- **Date:** 2026-10-11

## TLDR

A caller can start a workflow instance **exactly once per business key**. `startWorkflow` gains two
optional options, `businessKey` and `reusePolicy`; concurrent or redelivered starts carrying the same
key in one tenant/organization converge on one instance and every caller gets its id. Starts without a
key behave exactly as before. Separately, "instances about record X" and "tasks about record X" become
index-backed (GIN `jsonb_path_ops`) instead of sequential JSONB scans.

## Problem

- Event-driven starts are delivered at least once, and users trigger the same start concurrently.
  Core cannot say "start this once": `correlation_key` is indexed but not unique and is reserved for
  signal routing.
- Hosts compensate with an advisory lock plus a metadata lookup around every start.
- The instance subject (`metadata.entityType` / `metadata.entityId`) and user-task bindings
  (`user_tasks.entity_bindings`) are unindexed JSONB, so subject queries scan.

## Data model

### `workflow_instances.business_key`

`varchar(255) null`. Written once at start, never mutated, never set for a dry run. It is a lookup key,
not encrypted — callers MUST NOT put personal data in it (use record ids, not names).

Indexes:

| Name | Definition | Purpose |
|------|------------|---------|
| `workflow_instances_business_key_open_uq` | UNIQUE `(tenant_id, organization_id, workflow_id, business_key)` WHERE `business_key is not null and deleted_at is null and status not in ('COMPLETED','FAILED','CANCELLED','COMPENSATED')` | DB arbiter: at most one OPEN instance per key |
| `workflow_instances_business_key_idx` | `(tenant_id, organization_id, workflow_id, business_key, created_at)` WHERE `business_key is not null` | Reuse-policy lookup over open AND ended instances |

**Why partial instead of the full unique index the issue sketched.** A unique index over every row
makes a key permanently burnt once used, so no reuse policy could ever allow a second run. Scoping
uniqueness to open instances keeps the hard guarantee where races actually happen (two starts while
nothing is running yet) and leaves "may a key be reused after the run ended" to the policy, decided
against the lookup index. The terminal set in the predicate is the instance state machine's terminal
statuses; adding a new terminal status requires a migration that recreates this index.

Scope is `workflow_id` (all versions): a key started on v1 is the same business fact on v2.

### Subject indexes

| Name | Definition |
|------|------------|
| `workflow_instances_metadata_gin_idx` | GIN `(metadata jsonb_path_ops)` |
| `user_tasks_entity_bindings_gin_idx` | GIN `(entity_bindings jsonb_path_ops)` |

The instance subject stays where it is (`metadata.entityType` / `metadata.entityId`, which
`GET /api/workflows/instances?entityType=&entityId=` already filters with `@>`). The issue offered
"promote to columns **or** GIN on metadata"; GIN was chosen because it makes every existing `@>` filter
(subject, `labels.parentInstanceId`) index-backed with no backfill, no dual-write and no new contract.
`jsonb_path_ops` is used because every predicate is containment (`@>`); it is smaller and faster than
the default opclass for that operator.

## Engine contract

```ts
export type WorkflowBusinessKeyReusePolicy =
  | 'reject_duplicate'            // default: any earlier instance with the key is returned, never a second one
  | 'allow_duplicate'             // an open instance is returned; once it ended, a new one starts
  | 'allow_duplicate_failed_only' // as above, but only when the latest one ended FAILED/CANCELLED/COMPENSATED

interface StartWorkflowOptions {
  // …existing fields unchanged…
  businessKey?: string            // trimmed; 1..255 chars; rejected together with isDryRun
  reusePolicy?: WorkflowBusinessKeyReusePolicy
}

export interface StartWorkflowResult { instance: WorkflowInstance; created: boolean }

export function startOrReuseWorkflow(em, options): Promise<StartWorkflowResult> // NEW
export function startWorkflow(em, options): Promise<WorkflowInstance>          // unchanged signature, delegates
```

`created: false` tells the caller the instance already existed: it MUST NOT call `executeWorkflow`
for it again (the run is already advancing, parked, or finished). Through DI the new function is
`workflowExecutor.startOrReuseWorkflow`.

### Algorithm (key present)

1. Validate the definition exactly as today (not found / disabled / engine version / pre-conditions).
2. Read the latest instance with `(tenant, org, workflowId, businessKey)`, not deleted. If it is open,
   return it. If it ended, return it unless the policy permits reuse for its status.
3. Insert inside `em.transactional` (a SAVEPOINT when the caller already holds a transaction). On a
   unique violation (a concurrent start won), the savepoint rolls back — the caller's transaction is
   not poisoned — and the latest keyed instance is re-read and returned with `created: false`.
   Postgres makes the losing insert wait for the winner's commit, so the re-read sees it.
4. Only a created instance logs `WORKFLOW_STARTED` and emits `workflows.instance.created/started`.

`reusePolicy` without `businessKey` is ignored. Starts without a key run the unchanged code path.

## API

- `POST /api/workflows/instances` — body gains optional `businessKey` and `reusePolicy`.
  A created instance answers `201` (unchanged); a returned existing instance answers `200` with the
  same body shape and does not schedule background execution. `data.created` (boolean) is added to
  both. `businessKey` with `dryRun: true` is a `400`.
- `GET /api/workflows/instances` — new `businessKey` filter; when both `entityType` and `entityId` are
  given they are combined into ONE containment predicate. Instance payloads carry `businessKey`.
- `GET /api/workflows/tasks` — new `entityType` / `entityId` filters over `entity_bindings`
  (`@>` containment; `entityType` also matches the alias spellings the Work Inbox accepts).

## Backward compatibility

All additive: a nullable column and new indexes, optional engine options, a new export, new optional
request/query fields and a new response field. No event, ACL, DI-name or route change. Existing
`startWorkflow` callers (sub-workflows, error handler, triggers, AI test runs) pass no key and keep
their exact behaviour.

## Risks & impact

| Scenario | Severity | Mitigation | Residual |
|----------|----------|------------|----------|
| A new terminal instance status is added without updating the partial index predicate | Medium — a finished run would keep blocking its key | Predicate documented on the entity, here and in the module AGENTS.md | Requires reviewer attention on state-machine changes (already Ask-First) |
| Index builds lock `workflow_instances` / `user_tasks` writes during migration | Low–Medium on very large tables | Same non-concurrent style as every module migration; operators can pre-create the indexes `CONCURRENTLY` with the same names | Brief write lock at deploy |
| A caller re-executes a returned instance | Medium — double advance of a parked run | `created` flag on the result; API route skips execution; documented contract | Host code that ignores `created` |
| A caller puts PII in `businessKey` | Low | Documented: keys are plaintext lookup keys | — |

## Integration coverage

- Unit: executor create / reuse-open / reuse-ended per policy / unique-violation race / dry-run
  rejection / no-key path unchanged; start route `201` vs `200` + no background execution; instance
  list `businessKey` + combined subject predicate; task list subject filter.
- Postgres evidence (PR description): `EXPLAIN` of the instance and task subject queries uses the GIN
  indexes; two concurrent sessions inserting the same open key yield one row.

## Follow-ups (not in this change)

- A `businessKey` expression on event triggers, so embedded triggers become idempotent without host code.
- Indexed `user_tasks` lookups through the entity-ACL seam (#7180) once app-owned bindings use it.

## Changelog

- 2026-10-11 — Initial spec and implementation (#7182).
