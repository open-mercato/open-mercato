# Timesheets: segments orphaned when a time entry is soft-deleted

> **Status:** implemented.
> **Found by:** a local UI QA pass — undoing a timer start left a live, still-open work segment behind.

## 📝 TLDR

Soft-deleting a `StaffTimeEntry` never cascades to its `StaffTimeEntrySegment` rows: the segments keep `deleted_at = NULL` while pointing at a deleted parent. Where QA reproduced it — undoing `staff.timesheets.time_entries.start_timer` — the orphan is also left **open** (`ended_at = NULL`), a work segment still running against an entry that no longer exists.

This spec introduces one cascade helper, applies it to every path that soft-deletes an entry, makes the `delete` undo restore exactly what it removed, and backfills existing orphans.

It also covers a second defect found while validating the backfill's `COALESCE` rule: `start_timer_existing` never cleared a stale `ended_at`, producing the very `ended_at < started_at` shape the backfill has to defend against. The two ship together — § *Stale `ended_at` on `start_timer_existing`*.

Pre-existing on `develop`; **not** introduced by any recent change.

## 📝 Overview

`StaffTimeEntrySegment` is referenced exactly twice in `packages/core/src/modules/staff/commands/timesheets-entries.ts` — the import, and one `trx.create(...)` in `startTimerCommand.execute`. **No command in the module sets `deletedAt` on a segment.** The fix is small in code and mostly a matter of getting the undo round-trip and the backfill right.

## 📝 Problem Statement

| Path | Today | Should be |
|---|---|---|
| `start_timer` → **undo** | The work segment created by `execute` stays live **and open** | Segment soft-deleted with the entry |
| `time_entries.delete` | All the entry's segments stay live | Segments soft-deleted with the entry |
| `time_entries.delete` → **undo** | Restores the entry; segments were never deleted, so they reappear (accidentally correct) | Restores the entry **and exactly the segments that delete removed** |
| `time_entries.create` → **undo** / **redo** | Segments stay live on undo; redo cannot put them back | Cascade on undo, restore on redo, keyed off the row's own `deletedAt` |
| bulk grid save, duration zeroed | Segments stay live | Segments soft-deleted with the entry (forward only — the route writes no action log) |
| `start_timer_existing` | Leaves a stale `ended_at`, so the row can end before it starts | `endedAt` cleared as the segment opens, previous value carried in the undo state |

Reproduced on the QA instance:

```
entry:   deleted_at=2026-08-26 16:42:11+00   started_at=2026-08-26 16:41:36+00
segment: deleted_at=NULL                     ended_at=NULL
```

`startTimerCommand.execute` already declares the invariant — *"Create the timer entry AND start it inside a single transaction so a partial failure can never leave an orphaned, never-started timer entry"* — but enforces it only forward. The undo path reintroduces the very orphan the execute path guards against.

**Severity is low–medium, and the reasoning matters.** Nothing today reads segments without scoping through the parent: the single-active-timer invariant queries `staff_time_entries` with `deletedAt: null`, so an orphan cannot manufacture a phantom running timer. Exposure is to any consumer that aggregates segments directly — reporting, duration recomputation, exports — plus the ordinary cost of a soft-delete model whose children disagree with their parents.

**The pattern already exists in the codebase.** On the UX branch, `startTimerExistingCommand.undo` soft-deletes its `createdSegmentId`, and `stopTimerCommand.undo` re-opens its segment. Those newer commands are correct; this spec brings the two older ones in line.

## 📝 Proposed Solution

**One helper, called from every path that stamps `deletedAt` on an entry.** Cascade by `timeEntryId` rather than by a recorded segment id:

- No change to `TimeEntryUndoPayload`'s existing fields, so already-stored action-log entries stay readable.
- "The entry is going away, so its segments go with it" is the correct semantic for `delete`, where the entry may own many segments the command did not create.
- The alternative (record `createdSegmentId`, as `start_timer_existing` does) is precise but needs the cascade path anyway as a fallback for every log written before the fix — strictly more code for the same outcome.

**The delete round-trip is the part that needs care.** For `delete.undo` to restore exactly what it removed, `delete.execute` stamps the entry and its segments with the **same** `deletedAt` instant and records that instant in the undo payload. Undo then restores segments matching `(timeEntryId, deletedAt = recordedInstant)` — which cannot resurrect a segment the user had deleted individually beforehand, because that row carries a different timestamp.

Logs written **before** this change carry no recorded instant; their undo restores nothing, which is correct — those deletes never cascaded, so there is nothing to put back.

## 📝 Architecture

New module-local helper, beside the existing timesheets libs:

`packages/core/src/modules/staff/lib/timesheets/timeEntrySegmentCascade.ts`

```ts
export async function softDeleteSegmentsForEntry(
  em: EntityManager,
  timeEntryId: string,
  scope: { tenantId: string; organizationId: string },
  deletedAt: Date,
): Promise<number>

export async function restoreSegmentsForEntry(
  em: EntityManager,
  timeEntryId: string,
  scope: { tenantId: string; organizationId: string },
  deletedAt: Date,
): Promise<number>
```

Rules the helper obeys:

- **Tenant/organization scoped on every query** — never a bare `timeEntryId` lookup.
- **Caller-supplied `deletedAt`** so the entry and its segments share one instant; this is what makes the restore exact.
- **Open segments are closed on cascade**: a segment with `ended_at = NULL` gets `ended_at = deletedAt`. A soft-deleted row is already excluded from scoped reads, so this is defence-in-depth for any consumer that ignores `deleted_at` — and it removes the "still running" shape that made this finding worth filing. Restore reverses it only for segments it actually closed (tracked by `ended_at = deletedAt`).
- **No `em.flush()` inside the helper** — it participates in the caller's transaction, matching how the surrounding commands already work.

Call sites:

| Call site | Change |
|---|---|
| `startTimerCommand.undo` | After `entry.deletedAt = now`, cascade with the same `now` |
| `deleteTimeEntryCommand.execute` | After `entry.deletedAt = now`, cascade with the same `now`; record `now` in the undo payload |
| `deleteTimeEntryCommand.undo` | After restoring the entry, restore segments at the recorded instant (no-op when absent) |
| `createTimeEntryCommand.undo` | After `entry.deletedAt = now`, cascade with the same `now` (added in review) |
| `createTimeEntryCommand.redo` | `beforeRestore` restores segments keyed on the still-soft-deleted row's own `deletedAt` (added in review) |
| `bulk/route.ts` grid save, duration zeroed | After `existing.deletedAt = now`, cascade with the same `now` inside the route's existing transaction (added in review) |

`startTimerCommand.undo` needs no payload change: it deletes the entry outright, so cascading every live segment of that entry is unambiguous.

## 📝 Data Models

No schema change. `staff_time_entry_segments` already carries `deleted_at` and `ended_at` (both nullable).

`TimeEntryUndoPayload` gains one **optional** field:

```ts
segmentsDeletedAt?: string   // ISO instant; absent on logs written before this change
```

Additive and optional, so it does not break `BACKWARD_COMPATIBILITY.md`'s stored-payload expectations. Readers must treat absence as "no cascade happened".

### Migration — backfill existing orphans

One data migration in `packages/core/src/modules/staff/migrations/`:

```sql
UPDATE staff_time_entry_segments s
SET deleted_at = e.deleted_at,
    ended_at   = COALESCE(s.ended_at, e.deleted_at),
    updated_at = now()
FROM staff_time_entries e
WHERE s.time_entry_id = e.id
  AND e.deleted_at IS NOT NULL
  AND s.deleted_at IS NULL;
```

Adopting the parent's `deleted_at` (rather than `now()`) keeps the timestamps coherent, and deliberately does **not** collide with the recorded-instant restore path, since no pre-existing log carries `segmentsDeletedAt`.

The coalesce has **two** terms, not three: the entry's own `ended_at` is deliberately not consulted. A row in the population this backfill repairs can carry an `ended_at` that predates its newest segment's `started_at` — `staffTimeEntryCreateSchema` accepts `startedAt` and `endedAt` as independent optional fields, so a manual create could record an end with no start, and `POST .../timer-start` then gave that entry a `startedAt` and a fresh segment while leaving the stale `ended_at` untouched. Adopting the entry's end for such a row would write `ended_at < started_at`, a negative-duration segment that this migration's no-op `down()` can never take back. The two-term form reproduces the runtime cascade rule (`if (!segment.endedAt) segment.endedAt = deletedAt`) exactly, which is the property that matters: the repair rule and the write rule must not diverge.

**That producer is fixed in the same change** (see § *Stale `ended_at` on `start_timer_existing`* below): `startTimerExistingCommand.execute` now clears `endedAt` when it opens a segment, so no row written from here on acquires the shape. This does not make the third term safe to restore — the opposite. The backfill exists precisely for rows written *before* that fix, which are the rows that still carry the bad `ended_at`, so reintroducing it as a COALESCE term would corrupt exactly the population the migration is here to repair.

Per `AGENTS.md`, the migration ships in the PR; **applying it locally is the maintainer's call and this spec does not run `yarn db:migrate`.**

## 📝 Stale `ended_at` on `start_timer_existing`

Found while validating the backfill's COALESCE rule above, and fixed in the same change because the two are one story about rows where `ended_at < started_at`: the migration repairs that shape in historical data, this stops new rows acquiring it.

`startTimerExistingCommand.execute` set `startedAt` and `source` but never cleared `endedAt`. Starting a timer on an entry that already carried an end left `ended_at` pointing at a moment *before* the newly opened segment's `started_at`.

**Reachability.** Stop-then-restart is *not* reachable: `stopTimerCommand` never reassigns `startedAt`, so a stopped entry still carries one and `start_timer_existing` rejects it with 409 `timerAlreadyStarted`. The reachable route is a manually created entry that records `endedAt` while `startedAt` is still null, followed by `POST .../timer-start`.

**Consequences.**

| # | Consequence | Mechanism |
|---|---|---|
| 1 | The started entry vanishes from the running-timer lookup, and a *second* timer can be started alongside it | `buildTimeEntryListFilters` emits `started_at $exists: true, ended_at $exists: false`; the single-active-timer guard reads the same pair |
| 2 | Undo becomes permanently impossible | `startTimerExistingCommand.undo` treats a present `endedAt` as proof a stop landed after the start and throws 409 `timerAlreadyStopped` |
| 3 | Durations are unaffected | `stopTimerCommand` recomputes `durationMinutes` from segments only |

**The fix.** `execute` clears `endedAt` on start, records the previous value in `TimeEntryStartExistingUndoState` as an **optional** field, restores it in `undo`, and adds `endedAt` to `buildChanges`. Every reader of `endedAt` on `StaffTimeEntry` was checked (list filters, `ListView.formatTimeRange`, the undo guard, the stop-undo restore, snapshots, `buildChanges`); none depends on the stale value.

**Legacy payloads are safe by construction**, not by fallback: an action log written before the fix carries no `endedAt`, and such a log only ever reaches the restore with the row's `endedAt` already null, because the undo guard refuses whenever an end is present. Both halves of that argument are pinned by tests.

**Coverage.** Command-level, in `timesheets-start-timer-existing.test.ts`; all three original assertions were confirmed to fail with the source change reverted. The running-timer assertion goes through `buildTimeEntryListFilters` itself rather than a copied predicate.

Integration coverage closes the remaining gap: `TC-STAFF-044` drives the user-visible half of consequence 1 end to end — create an entry carrying `endedAt` with no `startedAt`, `POST .../timer-start`, then assert the entry comes back from a **live** `?running=true` request rather than from the filter builder. With `endedAt = null` reverted out of `execute`, that request returns an empty array, so the assertion fails for exactly the reason the defect predicts. The spec also pins the second-timer consequence (a concurrent start is rejected with 409) and the undo consequence (the start is undoable and restores the previous end and source).

## 📝 API Contracts

Unchanged. No route, request, or response shape is touched — `DELETE /api/staff/timesheets/time-entries` and the timer routes keep their contracts. Segment list endpoints already filter on `deleted_at IS NULL`, so cascaded rows simply stop appearing.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|---|---|
| Entry with zero segments | Helper returns 0; no-op |
| Entry with a mix of live and previously deleted segments | Only live ones cascade; the pre-deleted keep their original timestamp and are not restored later |
| Undo of a `delete` written before this change | `segmentsDeletedAt` absent → segments untouched (correct: they were never cascaded) |
| Segment individually deleted, then the entry deleted, then undone | Individually-deleted segment keeps its own timestamp, so restore skips it — it stays deleted, as the user intended |
| Cascade fails mid-transaction | Helper does not flush; the caller's transaction rolls back entry and segments together |
| Concurrent segment write during cascade | Serialized by the caller's existing transaction/lock; a segment created after the cascade is a new orphan only if the entry delete already committed — covered by the `delete` command running both in one transaction |
| Open orphan closed by the backfill | `ended_at` set to the parent's **`deleted_at`** — never the parent's `ended_at`, which in this population can predate the segment's own `started_at`; the row is soft-deleted so no duration total changes |
| `start_timer_existing` on an entry that already carried an end | `endedAt` cleared as the segment opens, and the previous value carried in the undo state; the row never reaches `ended_at < started_at` |
| Undo of a `start_timer_existing` written before the `endedAt` fix | Undo state carries no `endedAt`; the guard refuses whenever the row still has an end, so the restore is unreachable with a stale value |

## 📝 Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Backfill closes/deletes rows a consumer still expects | Medium | Reporting on historical data | Only touches segments whose parent is **already** soft-deleted — rows no scoped read returns today | Low: a consumer bypassing `deleted_at` would already be reading contradictory data |
| Restore resurrects a segment the user deleted deliberately | Medium | Undo correctness | Restore matches on the exact recorded instant, which an individually-deleted row cannot share | Low |
| Payload field breaks older readers | Low | Command bus | Field is optional and additive; absence is a defined case | Low |
| Cascade widens a transaction and increases lock time | Low | Timer throughput | Scoped single-table update by indexed `time_entry_id` | Low |
| Migration on a large table | Medium | Deploy | Single indexed UPDATE; row count knowable in advance via the same predicate | Low, but measure before applying |

**Blast radius:** one module, one new file, six call sites across two files, one data migration. **Rollback:** revert the code; the backfill is not reversed by a revert, but it only marks rows whose parent is already deleted, so leaving it applied is safe.

## 📋 Phasing

- **Phase 1 — cascade + tests.** Helper, six call sites, unit + integration coverage. Independently shippable; fixes all new orphans.
- **Phase 2 — backfill.** The data migration for rows already orphaned. Separately reviewable and separately appliable.

## 📋 Implementation Plan

**Phase 1**

1. Add `lib/timesheets/timeEntrySegmentCascade.ts` with `softDeleteSegmentsForEntry` / `restoreSegmentsForEntry`, both tenant+organization scoped, neither flushing.
2. Unit-test the helper directly: zero-segment entry, mixed live/pre-deleted, open-segment closing, scope isolation (a segment in another org is never touched).
3. Call the helper from `startTimerCommand.undo` using the same `Date` instance that stamps the entry. Test: undo a start → entry soft-deleted **and** segment soft-deleted with `ended_at` set.
4. Add the optional `segmentsDeletedAt` to `TimeEntryUndoPayload`; have `deleteTimeEntryCommand.execute` cascade and record the instant. Test: delete → all live segments soft-deleted at the same instant.
5. Restore in `deleteTimeEntryCommand.undo`, keyed on the recorded instant; no-op when the field is absent. Tests: full round-trip restores exactly the cascaded set; a legacy payload restores nothing; an individually-deleted segment stays deleted.
6. Integration specs under `packages/core/src/modules/staff/__integration__/`, self-contained with fixtures cleaned up in teardown per `.ai/qa/AGENTS.md`, covering every affected API path:
   - `TC-STAFF-041` — `POST .../time-entries/start-timer` → undo → assert no live orphan and nothing left running.
   - `TC-STAFF-042` — `DELETE .../time-entries` → undo → assert the segment set round-trips, and that a payload without `segmentsDeletedAt` restores none.
   - `TC-STAFF-043` — `POST .../time-entries/bulk` with `durationMinutes: 0` → assert the cascade, that a non-zero save does NOT cascade, and that a foreign-tenant entry is rejected with its segments untouched.
   - `TC-STAFF-044` — create with `endedAt` and no `startedAt` → `POST .../{id}/timer-start` → assert the entry is returned by a live `?running=true` request, that the stale end is cleared, that a second concurrent start is rejected with 409, and that undo restores the previous end and source. Covers the second defect (§ *Stale `ended_at` on `start_timer_existing`*) rather than the cascade.

**Phase 2**

7. Add the backfill migration plus the `.snapshot-open-mercato.json` update, and a short note in the spec's Changelog. Do not run `yarn db:migrate`.
8. Ship a count query in the PR description so the reviewer can size the affected rows before applying.

Each step leaves the app working: steps 1–2 add unused code, 3 fixes one path, 4–5 the other, 6 proves both, 7–8 are data-only.

## 📝 Landing sequence

Ships in one change with the #2609 command-bus fix and #3750's timer seeding, based on the latest `develop`. `startTimerExistingCommand.undo` (soft-deletes its `createdSegmentId`) and `stopTimerCommand.undo` (re-opens its segment) are the reference implementations this fix mirrors, and both must stay passing.

## 📝 Final Compliance Report

- **Module boundaries** — helper is module-local; no cross-module ORM relationship introduced.
- **Tenant scoping** — every helper query filters `tenantId` + `organizationId`; a scope-isolation test is mandatory (Step 2).
- **Canonical mechanisms** — reuses the existing command-bus undo contract and the module's existing soft-delete convention; invents nothing.
- **Backward compatibility** — one additive optional payload field; no API, event, DI-key, ACL or route change. No `BACKWARD_COMPATIBILITY.md` surface broken.
- **Migrations** — generated and committed with the snapshot; not applied.
- **Testability** — every step has a named test; the two undo round-trips get integration coverage.
- **Generated files** — none edited by hand.

## 📝 Changelog

| Date | Change |
|---|---|
| 2026-08-26 | Initial spec. Scope, cascade mechanism and backfill decided. |
| 2026-08-26 | Landing sequence resolved: ships alongside the #2609 and #3750 work on `develop`. |
| 2026-08-26 | Implemented. Phase 1 (cascade helper, three call sites, unit + integration coverage) and Phase 2 (backfill migration) landed. Two deviations from the plan, both recorded in the PR: the per-segment `DELETE` route the integration spec was to use does not exist (segments expose `POST`/`PATCH` only), so TC-STAFF-042 writes that precondition directly to the database; and the backfill is hand-written with the ORM snapshot unchanged, because a data-only migration moves no entity definition. |
| 2026-08-27 | Review found two further defects, both fixed in the same PR. `bulk/route.ts` zeroes a grid cell to soft-delete an entry and did not cascade — a fourth call site, now covered by `TC-STAFF-043`. The backfill preferred the entry's `ended_at` over the delete instant, diverging from the runtime cascade, which could write `ended_at < started_at`. Verified against that exact scenario in a rolled-back transaction: the corrected two-term coalesce yields the delete instant, the original would have produced a negative duration. |
| 2026-08-27 | Scope widened during review: `createTimeEntryCommand.undo` was a third instance of the same defect and is now fixed in the same PR. It needed more than the helper call — the command's `makeCreateRedo` is segment-unaware, so `beforeRestore` restores the cascaded segments keyed on the still-soft-deleted row's own `deletedAt`, keeping undo and redo symmetric without a payload field. |
| 2026-08-27 | Re-review corrected the written record, no runtime change. This spec's migration section still prescribed the three-term `COALESCE(s.ended_at, e.ended_at, e.deleted_at)` that the previous round had removed from the shipped migration as a defect — the normative SQL, the "open orphan closed by the backfill" edge case, and the changelog entry above are now aligned with the two-term form that actually ships. The mechanism recorded for that defect was also wrong in both the spec and the migration docblock: `start_timer_existing` cannot restart a stopped entry (it rejects one under `LockMode.PESSIMISTIC_WRITE` with 409 `timerAlreadyStarted`). The reachable shape is a manual create that records `endedAt` with `startedAt` still null — the validator accepts the two independently — followed by `POST .../timer-start`. |
| 2026-08-30 | Scope widened to the producer of the bad `ended_at` shape, previously carried as a separate change and now folded in here. `startTimerExistingCommand.execute` never cleared `endedAt`, so a timer started on an entry that already carried an end wrote `ended_at < started_at` — the exact shape the backfill's two-term COALESCE guards against in historical data. Both branches forked from the same commit and merged with zero conflicts, so the stacking recorded on both PRs was wrong; the fix was cherry-picked onto this one. Recorded in the new § *Stale `ended_at` on `start_timer_existing`*. |
| 2026-09-08 | `TC-STAFF-044` closes the integration gap this spec recorded for the second defect: the user-visible half of consequence 1 was only ever asserted through `buildTimeEntryListFilters`, never through a live `?running=true` request. Confirmed falsifiable against the real stack — with `endedAt = null` reverted out of `execute`, that request returns an empty array, so a user's own just-started timer is invisible to the route that feeds the timer bar. |
| 2026-08-30 | Documentation accuracy, no runtime change. The migration docblock and the § *Data Model & Migrations* rationale justified the two-term COALESCE in the present tense — "`POST .../timer-start` then gives that entry a `startedAt` … while leaving the stale `ended_at` untouched" — which the fix above makes false of the shipped runtime. Both are now scoped to the pre-fix population, with an explicit note that fixing the producer makes the third COALESCE term *more* wrong, not safe to restore: the rows the backfill repairs are precisely the ones still carrying the bad value. |
