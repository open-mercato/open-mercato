# Workflows — Atomic Signal Claim and Wait Occurrence (`wait_version`)

- **Status:** Implemented in PR #7190 (fixes #7185)
- **Module:** `workflows` (`packages/core/src/modules/workflows`)
- **Scope:** OSS

## TLDR

A PAUSED workflow instance is advanced by exactly one delivery of a signal. `sendSignal` claims the
wait with a conditional UPDATE (`status = 'PAUSED'`, pinned `current_step_id`, pinned `wait_version`)
before it mutates anything; concurrent or delayed deliveries lose the claim and are refused with
`WORKFLOW_NOT_PAUSED`. The new integer column `workflow_instances.wait_version` identifies one
**occurrence** of a wait, so a delivery addressed to one occurrence can never consume a later
occurrence of the same step after a loop.

## Problem

Before #7185 every check in `sendSignal` read a snapshot. Two deliveries of the same signal (webhook
retries, at-least-once event delivery, double clicks) both passed the PAUSED check and both advanced
the run — duplicate side effects and a double transition. Pinning only the step id is not enough: a
workflow that loops back parks on the same step again, and a wall-clock pin (`updated_at`) can stand
still, roll back or skew between workers.

## Data Model

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| `workflow_instances.wait_version` | `int` | `0` | `NOT NULL` |

Entity: `WorkflowInstance.waitVersion` (`data/entities.ts`). Migration:
`migrations/Migration20261029090000_workflows.ts` plus the module snapshot.

### Writers

The value is only ever changed in SQL, relative to the row's current value — never assigned from an
in-memory copy:

1. **Unit-of-work updates** (`onUpdate` hook): `wait_version + 1` **unless** the row was `PAUSED` and
   the write leaves it `PAUSED` on the same `current_step_id`. A parked run's metadata, context or
   timestamp edit (for example the disposition-SLA `metadata.attention` marker in `lib/task-sla.ts`)
   is therefore not a new occurrence and does not invalidate a delivery addressed to the open wait.
   A park from any non-PAUSED state, a resume, and a move to another step all increment.
   "What the write leaves behind" is decided from the fields the UPDATE actually sends: the unit of
   work emits only properties that differ from the snapshot it loaded, so the hook compares the
   entity with that snapshot (`em.getUnitOfWork().getOriginalEntityData`). A status or step the write
   does not send keeps the row's current column value in the comparison, and a write that sends
   neither keeps `wait_version` unchanged — even when the writer's managed entity is stale, for
   example loaded while the run was still `RUNNING`, or on an earlier step it has since left.
2. **Signal claim** (`lib/signal-handler.ts`, `nativeUpdate`): compare-and-set on the observed value,
   then `wait_version + 1`.
3. **Claim release** (same file): when a claimed delivery fails before anything of it committed, the
   row is handed back to `PAUSED` with `wait_version + 1`.

Readers: `sendSignal` (`expectedWaitVersion` option, defaulting to the value it read) and
`sendSignalByCorrelationKey[WithResults]`, which snapshots each listed instance's step and version
before delivering.

## API Contract

- `POST /api/workflows/instances/{id}/signal` — unchanged URL and body; a refused delivery answers
  `409` with `WORKFLOW_NOT_PAUSED` (already the documented mapping for a non-paused instance).
- `POST /api/workflows/signals` — response gains an **optional** `failures[]` array
  (`{ instanceId, code, message }`). Additive.
- `sendSignal` gains the optional `expectedStepId` / `expectedWaitVersion` options;
  `sendSignalByCorrelationKeyWithResults` and `SignalDeliveryFailure` are new exports.
  `sendSignalByCorrelationKey` keeps its `Promise<number>` signature.

## Observability

Unexpected fan-out failures report `workflows.signal_fanout_delivery_failed`; a failed claim release
reports `workflows.signal_claim_release_failed`. Reporting is best-effort: a throwing telemetry
runtime is logged as a warning and never stops the fan-out loop or replaces the delivery error.
Expected refusals (`WORKFLOW_NOT_PAUSED`, `SIGNAL_NAME_MISMATCH`, …) are outcomes, not faults, and are
not reported.

## Out of Scope

- FORKED (branch-scoped) signal claims.
- Event-correlated waits and lifecycle-event emission for signals.

## Migration & Backward Compatibility

- **Contract surface:** database schema (`BACKWARD_COMPATIBILITY.md` category 8). The change is
  **additive**: one new column with a constant default, no rename, no drop, no type change of an
  existing column.
- **Existing rows:** `ADD COLUMN ... NOT NULL DEFAULT 0` back-fills every existing instance with `0`
  (PostgreSQL ≥ 11 does this without a table rewrite). An instance already parked at deploy time is
  claimable at version `0` by the first delivery after the deploy.
- **Deployment order:** run the migration before starting the new application version. The new code
  references `wait_version` in every instance update and in the claim predicate, so it requires the
  column. The old application version keeps working against the migrated schema: it never reads the
  column, and the default satisfies `NOT NULL` on insert.
- **Rolling deploys — the guarantee needs every signal worker on the new code.** Schema
  compatibility is not a concurrency guarantee. The pre-change `sendSignal` has no atomic claim at
  all: two deliveries handled by old workers can both pass its `PAUSED` snapshot check and both
  advance the run, whatever the new workers' compare-and-set does, and an old worker racing a new
  one is unprotected on the old side too. Old-code writes also never increment `wait_version`, so a
  park, resume or re-park performed by an old worker is invisible to a new worker's claim. The
  exactly-once delivery guarantee — for concurrent deliveries and for same-step loops alike — holds
  only once **every** process that handles signals (API instances serving
  `POST /api/workflows/instances/{id}/signal` and `POST /api/workflows/signals`, and every queue
  worker that resumes parked runs: activity, sub-workflow and agent-disposition resumes) runs the new
  version. During cutover, either drain the old processes before routing signal traffic to the new
  ones (stop old queue workers first, then shift API traffic), or accept the pre-change at-least-once
  behaviour for the length of the overlap.
- **Rollback:** `down()` drops the column. Roll the application back first, then the migration; the
  rows and every other column survive (covered by the migration test below).
- **Public TypeScript API:** only additive — new optional options, new exports, an optional response
  field. No deprecation needed.

## Risks & Impact Review

| Scenario | Severity | Mitigation | Residual risk |
|----------|----------|------------|---------------|
| App started before the migration ran | High | Deployment order above; the migration is a single `ADD COLUMN` | Instance writes fail until migrated |
| Metadata-only write of a parked run invalidates an in-flight delivery (signal lost) | High | `onUpdate` keeps the version for PAUSED → PAUSED writes on the same step; PostgreSQL regression | None known |
| A context/metadata writer whose managed entity is stale (loaded before the park, or on an earlier step) invalidates the open wait | High | `onUpdate` reads the unit-of-work snapshot and treats a status/step the write does not send as the row's CURRENT value, so a write that sends neither keeps the version; PostgreSQL regression holds both writers across the park | None known |
| Old and new workers handle signals side by side during a rolling deploy | High | Drain/route away from old signal-handling processes during cutover (see above) | Duplicate delivery possible for as long as old workers handle signals |
| A run leaves a wait and re-parks on the same step inside ONE flush (row never observed non-PAUSED) | Low | A signal wait is normally left through the claim, which increments in SQL; other exits (timeout, cancel, step-through) change status or step before a re-park | A stale delivery addressed to the earlier occurrence could claim the later one on such a path |
| Telemetry runtime throws while reporting | Medium | Guarded reporter, unit-tested | None |

## Test Coverage

- Unit: `lib/__tests__/signals.test.ts` (claim, release, fan-out failures, telemetry isolation),
  `api/__tests__/signals.route*.test.ts`.
- Real PostgreSQL — runs in CI's real-Postgres lane (`yarn workspace @open-mercato/core
  test:pg-integration`, `OM_PG_INTEGRATION=1`, a disposable container per suite), or locally against
  a throwaway server named by `OM_WORKFLOWS_PG_URL`:
  `lib/__tests__/signal-wait-occurrence.pg.test.ts` (frozen-clock same-step loop, clock rollback,
  metadata-only write between read and claim, a context writer loaded before the park, a context
  writer loaded on an earlier step across a move to the next wait, a stale writer that does change
  status) and `lib/__tests__/wait-version-migration.pg.test.ts`
  (pre-existing row → up → down → up → signal delivered once).
- Integration: `__integration__/TC-WF-066.spec.ts` (concurrent deliveries through both API paths).

## Changelog

- 2026-10-30 — Spec written for review 5708461639; `onUpdate` no longer increments for writes that
  keep a parked row parked on the same step; telemetry reporting isolated.
- 2026-10-31 — Review 5721475061: `onUpdate` decides from the fields the write sends, not from a
  possibly stale managed entity; the rolling-deploy guarantee is corrected to require every
  signal-handling process on the new code; the PostgreSQL suites run in CI's real-Postgres lane.
