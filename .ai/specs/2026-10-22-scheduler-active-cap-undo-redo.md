# Scheduler — atomic active-schedule cap, also on undo and redo

**Status:** implemented in the PR that fixes #7760 and #4781
**Module:** `packages/scheduler/src/modules/scheduler`
**Related:**
`UPGRADE_NOTES.md` → 0.9.0 → 0.9.1 → "Scheduler undo and redo respect the active-schedule cap and keep the run state",
#4781 (make the active schedule cap atomic), #3991 / #4780 (cap introduced)

## TLDR

A tenant can hold at most `OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT` (default 100) active
scheduled jobs. Two gaps let a tenant go over it:

1. Three undo/redo paths made a schedule active again without checking the cap.
2. Every check was count-then-write, so concurrent activations could all read the same count and all
   pass.

Now every write that makes a schedule active counts and writes inside one transaction that holds a
per-tenant advisory lock. The undo and redo routes answer `422` with the existing translated cap
message when a restore would exceed the cap; before, they answered `200`. Update undo also stops
rewinding the runner's `lastRunAt` / `nextRunAt`. Route URLs, request and response schemas, command
IDs, events, ACL features, DI names and the database schema do not change.

## Problem Statement

| Path | Before | After |
|---|---|---|
| `scheduler.jobs.create` (enabled), `scheduler.jobs.update` (`isEnabled: false → true`) | cap checked, not atomic | cap checked under the tenant lock |
| `SchedulerService.register` / `update` / `enable` (module wiring) | cap checked, not atomic | cap checked under the tenant lock |
| undo of `scheduler.jobs.update` that disabled a job | not checked | checked under the tenant lock |
| undo of `scheduler.jobs.delete` of an enabled job | not checked | checked under the tenant lock |
| redo of an undone enabled `scheduler.jobs.create` | not checked | checked under the tenant lock |

Update undo also copied `lastRunAt` and `nextRunAt` from the snapshot. If the job ran between the
update and the undo, the undo restored a `nextRunAt` already in the past, and the local scheduler
(which picks `nextRunAt <= now`) ran the job again on its next poll.

## Proposed Solution

`lib/activeScheduleLimits.ts` adds `withTenantActiveScheduleSlot(em, tenantId, activates, write)`:

- When `activates` is false, or the schedule is system-scoped (`tenantId` null, uncapped as before),
  it runs `write` and flushes. No transaction, lock or count.
- Otherwise it opens a transaction on the same `EntityManager` (or joins the caller's), takes
  `pg_advisory_xact_lock(hashtextextended('scheduler:active-schedules:<tenantId>', 0))` on the
  transaction's connection, counts the tenant's active schedules, throws the existing `422` at the
  cap, then runs `write`, flushes and commits. The lock is released on commit or rollback.

Under READ COMMITTED, the count after the lock sees every activation committed by an earlier lock
holder, so contenders for the last free slot are decided one at a time: one wins, the rest get
`422`. Mutations run inside `write`, after the count, so MikroORM's auto-flush cannot count the
caller's own pending activation. Only writes that activate a schedule take the lock; disabling,
deleting, renaming and runner updates do not, and tenants never block each other.

All seven activating writers use it: create and update `execute`, update undo, delete undo, create
redo, `SchedulerService.register` and `SchedulerService.update` (which `enable` calls). Create redo
is now written by hand instead of with `makeCreateRedo`, because `makeCreateRedo` runs its
`beforeRestore` hook outside the restore transaction. The hand-written redo keeps what
`makeCreateRedo` did: id-preserving restore, `409` on a unique-key collision, BullMQ sync and the
`created` CRUD side effects.

Update undo keeps the live `lastRunAt`. It keeps the live `nextRunAt` unless the restored schedule
type, value or timezone differs from the live row; then it recomputes `nextRunAt` from the restored
definition.

## API Contracts

### `POST /api/audit_logs/audit-logs/actions/undo` and `.../actions/redo` (scheduler commands)

| Case | Before | After |
|---|---|---|
| Restore makes a schedule active, tenant below the cap | `200` | `200` (unchanged) |
| Restore makes a schedule active, tenant at the cap | `200`, tenant over the cap | `422 { "error": "Active scheduled job limit reached for this tenant (<max>)." }` (translated); schedule unchanged |
| Restore leaves the schedule disabled, or the schedule is system-scoped | `200` | `200` (unchanged) |

### `POST` / `PUT /api/scheduler/jobs`

Status codes and bodies are unchanged. Two small differences:

- Concurrent requests that compete for the last free slot: before, more than one could get
  `201` / `200`; now exactly one does and the rest get the existing `422`.
- A request that is both over the cap and invalid in another way (unauthorized queue target,
  invalid payload, invalid schedule value) now gets that other error instead of the cap `422`,
  because the cap is checked right before the write. Both are refusals; nothing is written either way.

## Migration & Backward Compatibility

**Contract surfaces:** API routes (`BACKWARD_COMPATIBILITY.md` §7) — the undo/redo routes for
`scheduler.jobs.*` log entries; function signatures (§3) — none changed:
`enforceTenantActiveScheduleLimit` keeps its signature and stays exported, and
`withTenantActiveScheduleSlot` / `activeScheduleLockKey` are additions. Command IDs (§2), event IDs,
ACL features, DI names and database schema are unchanged.

**Why no deprecation window:** the old answers let a tenant go over a limit that create and enable
already enforced. Keeping them would keep the bypass. There is no old behaviour to bridge to.

**Who is affected:** a client that undoes or redoes schedule changes for a tenant that is at its cap,
and a client that fires several concurrent activations at the cap and relied on more than one
succeeding. Tenants below the cap see no change, apart from a short wait when two activations for the
same tenant run at the same moment.

**Client migration:**

1. Before undoing or redoing a change that re-enables a schedule at the cap, free a slot (disable or
   delete another schedule), then retry.
2. Treat `422` from undo/redo of a scheduler log entry as "at the cap", not as a transient failure.
   Retrying without freeing a slot returns the same `422`.

**Rollback:** reverting restores the old count-then-write checks and the unchecked restores. No data
migration; refused restores wrote nothing.

**Documentation:** `UPGRADE_NOTES.md` (0.9.0 → 0.9.1).

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Activations for one tenant wait on each other | Low | Lock held only for count + one row write; only activating writes take it; per tenant | Short waits under bursts |
| Lock waiters hold pool connections | Low | Critical section is database-only on the transaction's own connection (no RBAC or HTTP calls under the lock) | None known |
| A caller already in a transaction holds the lock until its own commit | Low | The helper joins the outer transaction instead of nesting | Lock lifetime follows the caller |
| Error precedence change for requests both over the cap and otherwise invalid | Low | Both are refusals; documented above | None |

## Non-goals

- Changing the cap value, its environment variable, or system-scoped schedules (still uncapped).
- Showing undo/redo failures in the Version History panel (#7762).
- Catch-up runs after delete undo / create redo with snapshot run dates (#7763).

## Testing

- Unit `lib/__tests__/activeScheduleLimits.test.ts`: lock taken on the transaction context before the
  count; rollback without writing at the cap; two concurrent activations for the last slot give
  exactly one winner (fails when the lock is removed); different tenants do not wait on each other;
  joins an outer transaction; no lock or count for non-activating or system-scoped writes.
- Unit `commands/__tests__/jobs.undo-active-limit.test.ts`: update undo, delete undo (soft and hard)
  and create redo refused at the cap; update undo, soft delete undo and create redo allowed below it
  under the tenant lock; no count when the restored schedule is disabled.
- Unit `commands/__tests__/jobs.undo.test.ts`: update undo keeps live run state, recomputes
  `nextRunAt` when the definition changes.
- Integration TC-SCHED-010 (API): each restore refused at the cap; update undo allowed after a slot
  frees; three concurrent undos and three concurrent creates for one free slot each give exactly one
  winner.
- Integration TC-SCHED-010 (UI): banner Undo shows the translated cap message and the job stays
  disabled.

## Changelog

- 2026-10-22: Recorded the atomic cap, the undo/redo refusal and the client migration.
