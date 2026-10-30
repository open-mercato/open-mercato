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
- **Rolling deploys:** while old and new workers run side by side, old-code writes do not increment
  `wait_version`. The new claim still pins status and step, so the old exact-once guarantee for
  concurrent deliveries holds; only the same-step-loop distinction is weaker until every worker runs
  the new version.
- **Rollback:** `down()` drops the column. Roll the application back first, then the migration; the
  rows and every other column survive (covered by the migration test below).
- **Public TypeScript API:** only additive — new optional options, new exports, an optional response
  field. No deprecation needed.

## Risks & Impact Review

| Scenario | Severity | Mitigation | Residual risk |
|----------|----------|------------|---------------|
| App started before the migration ran | High | Deployment order above; the migration is a single `ADD COLUMN` | Instance writes fail until migrated |
| Metadata-only write of a parked run invalidates an in-flight delivery (signal lost) | High | `onUpdate` keeps the version for PAUSED → PAUSED writes on the same step; PostgreSQL regression | None known |
| A run leaves a wait and re-parks on the same step inside ONE flush (row never observed non-PAUSED) | Low | A signal wait is normally left through the claim, which increments in SQL; other exits (timeout, cancel, step-through) change status or step before a re-park | A stale delivery addressed to the earlier occurrence could claim the later one on such a path |
| Telemetry runtime throws while reporting | Medium | Guarded reporter, unit-tested | None |

## Test Coverage

- Unit: `lib/__tests__/signals.test.ts` (claim, release, fan-out failures, telemetry isolation),
  `api/__tests__/signals.route*.test.ts`.
- Real PostgreSQL (gated on `OM_WORKFLOWS_PG_URL`, throwaway server only):
  `lib/__tests__/signal-wait-occurrence.pg.test.ts` (frozen-clock same-step loop, clock rollback,
  metadata-only write between read and claim) and `lib/__tests__/wait-version-migration.pg.test.ts`
  (pre-existing row → up → down → up → signal delivered once).
- Integration: `__integration__/TC-WF-066.spec.ts` (concurrent deliveries through both API paths).

## Changelog

- 2026-10-30 — Spec written for review 5708461639; `onUpdate` no longer increments for writes that
  keep a parked row parked on the same step; telemetry reporting isolated.
