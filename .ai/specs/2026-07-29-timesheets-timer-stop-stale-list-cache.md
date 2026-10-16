# Timesheets timer writes bypass the command bus and leave the CRUD list cache stale

- **Status**: Implemented — verified (unit + build gate green; every regression gate confirmed fail-before / pass-after, including `TC-STAFF-031` for the `[id]/timer-start` conversion)
- **Date**: 2026-07-29
- **Upstream issue**: [open-mercato/open-mercato#2609](https://github.com/open-mercato/open-mercato/issues/2609) (`bug`, `priority-high`, unassigned)
- **Umbrella**: upstream #2456 (Timesheets manual QA)

## TLDR

`POST /api/staff/timesheets/time-entries/{id}/timer-stop` is a hand-rolled route that writes the
time entry directly through the ORM instead of going through the command bus. The command bus is
what invalidates the opt-in CRUD list response cache, so any list payload cached **before** the stop
keeps serving the pre-stop `ended_at: null` snapshot afterwards. The UI rehydrates that as a running
timer.

Fix: implement the stop as a real command (`staff.timesheets.time_entries.stop_timer`) and have the
route delegate via `commandBus.execute`, mirroring the existing `start-timer` route/command pair.
Ship an integration test that performs a list GET **before** the stop — the step the existing
TC-STAFF-011 omits, which is why the bug has looked unreproducible.

Two things this refactor must **not** do: widen authorization (the stop endpoint is owner-only today,
unlike the sibling commands it otherwise mirrors), and lose the #2416 locking guarantee that the
current route-level unit test pins. Both are detailed below.

`[id]/timer-start` has the same defect class. It was deferred while this plan was written, then
fixed in the same branch as a third commit once the deferral was empirically confirmed and this
spec's conversion existed as a template — `staff.timesheets.time_entries.start_timer_existing`, with
`TC-STAFF-031` as the pre-*start* regression gate. See § Follow-ups.

## Problem Statement

Manual QA (upstream #2456) reported that stopping a running timer leaves the timesheets list and
sidebar showing the timer as still running. The stop endpoint returns `200`, a direct `id=` lookup
shows the entry stopped, but the filtered date/staff list keeps returning `ended_at: null` and
`duration_minutes: 0`.

The issue stalled because a contributor could not reproduce it:

> "@pkarw Still valid? Doesn't reproduce on develop, TC-STAFF-011 passes with cache on, and QA #2855
> reported the same." — [comment, 2026-06-13](https://github.com/open-mercato/open-mercato/issues/2609#issuecomment-4698785436)

Both halves of that comment are true, and neither clears the bug. See § Why it looked unreproducible.

## Verified reproduction

Reproduced live on 2026-07-29 against the ephemeral QA environment (`yarn test:integration:ephemeral:start`,
`http://127.0.0.1:5001` — the same URL and cache configuration as the environment in the issue).

Sequence: create project → assign employee → create `source: 'timer'` entry → `timer-start` →
**filtered list GET** → `timer-stop` → filtered list GET → `?ids=` GET.

```
pre-stop  list -> ended_at=null                          duration_minutes=0
timer-stop -> 200 {"ok":true,"durationMinutes":0}
post-stop list -> ended_at=null                          duration_minutes=0   <- stale
post-stop ids= -> ended_at="2026-07-29 18:05:33.289+00"  duration_minutes=0   <- fresh
```

Control run — identical except the pre-stop list GET is removed:

```
post-stop list -> ended_at="2026-07-29 18:05:47.207+00"  duration_minutes=0   <- fresh
post-stop ids= -> ended_at="2026-07-29 18:05:47.207+00"  duration_minutes=0
```

The **only** difference between the two runs is whether the list cache key was warmed before the
stop. That isolates the mechanism to the response cache, not to the write itself.

In the issue's manual repro the warming request is step 5, "navigate away/back and reload".

## Root cause

### The write path

[`api/timesheets/time-entries/[id]/timer-stop/route.ts`](../../packages/core/src/modules/staff/api/timesheets/time-entries/%5Bid%5D/timer-stop/route.ts)
resolves scope, runs the staff mutation guards, then performs the whole mutation itself inside
`em.transactional(...)` with a `PESSIMISTIC_WRITE` lock, ending at `trx.flush()` (line 151). It then
fires `emitStaffEvent('staff.timesheets.time_entry.timer_stopped', …)` (line 155) and returns.

Nothing in that path invalidates any cache:

- No subscriber consumes `staff.timesheets.time_entry.timer_stopped` — the staff module has no
  `subscribers/` directory, and the only other references to that event id are the declaration in
  `events.ts` and the emit itself.
- The route never calls `invalidateCrudCache`.
- It never reaches the command bus, which is where invalidation normally happens.

This violates the rule in [`packages/core/AGENTS.md`](../../packages/core/AGENTS.md):

> "Implement domain writes through commands so audit, undo, cache, events, and indexing stay consistent."

### The read path

[`api/timesheets/time-entries/route.ts`](../../packages/core/src/modules/staff/api/timesheets/time-entries/route.ts)
is a `makeCrudRoute`. When `ENABLE_CRUD_API_CACHE` is on, its GET stores the **whole list payload**
under a key derived from the request query params, tagged with collection tags plus one record tag
per item ([`factory.ts:1487-1511`](../../packages/shared/src/lib/crud/factory.ts:1487)).

`invalidateCrudCache` is reachable from exactly four places:

| Caller | File |
|---|---|
| CRUD factory POST | [`factory.ts:2326`](../../packages/shared/src/lib/crud/factory.ts:2326) |
| CRUD factory PUT | [`factory.ts:2659`](../../packages/shared/src/lib/crud/factory.ts:2659) |
| CRUD factory DELETE | [`factory.ts:2946`](../../packages/shared/src/lib/crud/factory.ts:2946) |
| Command bus (after execute / after undo) | [`command-bus.ts:624`](../../packages/shared/src/lib/commands/command-bus.ts:624), `:656` |

A hand-rolled route that is neither of those invalidates nothing.

### Why the `id=` query stays fresh

The cache key includes the request's query params, so `?ids=<uuid>` and
`?staffMemberId=…&from=…&to=…` are different keys. Only the second was warmed before the stop. The
`ids=` key was cold, so it read through to the database — which is why the issue's evidence shows the
two queries disagreeing.

### Not the query index

An early hypothesis was query-index staleness (the custom routes also never reindex). Ruled out: the
query engine selects base columns from the **base table** (alias `b`) and LEFT JOINs the index only
for `cf:` custom-field access ([`query_index/lib/engine.ts:404`](../../packages/core/src/modules/query_index/lib/engine.ts:404)).
A stale index cannot produce a wrong `ended_at`. Missing reindexing on these routes is a separate,
lower-severity concern and is **out of scope** here.

## Why it looked unreproducible

**`ENABLE_CRUD_API_CACHE` is off by default** ([`crud/cache.ts:17`](../../packages/shared/src/lib/crud/cache.ts:17)
— `parseBooleanToken(process.env.ENABLE_CRUD_API_CACHE ?? '')`), so a plain `yarn dev` cannot show
the bug at all. It is on in:

- `docker-compose.fullapp.yml` and `docker-compose.fullapp.dev.yml` (`${ENABLE_CRUD_API_CACHE:-true}`)
- every `test:integration*` script in `package.json`
- the ephemeral runner, which hardcodes `ENABLE_CRUD_API_CACHE: 'true'`
  ([`integration.ts:1982`](../../packages/cli/src/lib/testing/integration.ts:1982), `:3327`)

**TC-STAFF-011 cannot catch it, cache on or off.** Its only `time-entries` list GET happens *after*
the stop ([`TC-STAFF-011.spec.ts:140`](../../packages/core/src/modules/staff/__integration__/TC-STAFF-011.spec.ts:140)).
With no pre-stop list request the key is cold and the assertion reads through to the database. The
test is structurally identical to the control run above, which is exactly why it passes.

## Proposed solution

Move the timer writes onto the command bus, so cache invalidation, audit logging and undo come from
the same mechanism the rest of the module already uses.

### Why this rather than a direct `invalidateCrudCache` call

Calling `invalidateCrudCache` from the route would fix #2609 with a smaller diff (there is precedent
for that shape in customers, #3663 — see the comments at
[`customers/api/deals/[id]/route.ts:339`](../../packages/core/src/modules/customers/api/deals/%5Bid%5D/route.ts:339)).
It was rejected because it leaves the underlying command-pattern violation in place: stopping a timer
would still produce no audit entry and no undo token, and the next hand-rolled write on this entity
would reintroduce the same class of bug. The command route fixes the cache as a *consequence* of
doing the write the way the package guide requires.

### How invalidation will reach the right tags

Two details are load-bearing and must not be dropped during implementation:

1. **`buildLog` is mandatory.** `invalidateCacheAfterExecute` returns early when
   `metadata?.resourceKind` is absent ([`command-bus.ts:576`](../../packages/shared/src/lib/commands/command-bus.ts:576)).
   The metadata comes from the command's `buildLog`. A command without `buildLog`, or one that
   returns `null`, invalidates **nothing** — the bug would survive the refactor. `buildLog` must
   return `resourceKind: 'staff.timesheets.time_entry'` and the entry id as `resourceId`.

2. **The alias is what makes the tags match.** The list route derives its `resourceKind` from its
   `actions.create.commandId` via `deriveResourceFromCommandId('staff.timesheets.time_entries.create')`
   → `staff.timesheet`, and caches under that tag. The command bus adds
   `deriveResourceFromCommandId(commandId)` to the alias set before invalidating
   ([`command-bus.ts:621`](../../packages/shared/src/lib/commands/command-bus.ts:621)), so a command
   id of `staff.timesheets.time_entries.stop_timer` also yields `staff.timesheet` and the record and
   collection tags line up. Keep the `staff.timesheets.time_entries.*` command-id prefix — a
   different prefix silently breaks invalidation.

## Architecture

### Files to add / change

| File | Change |
|---|---|
| `packages/core/src/modules/staff/data/validators.ts` | Add `staffTimeEntryStopTimerSchema` + inferred type. Scoped fields + `id: z.string().uuid()`. Mirror `staffTimeEntryStartTimerSchema` (line 294). |
| `packages/core/src/modules/staff/commands/timesheets-entries.ts` | Add `stopTimerCommand` (`prepare` + `execute` + `buildLog` + `undo`); `registerCommand(stopTimerCommand)` next to the existing four registrations. Add `cacheAliases: ['staff.timesheet']` to `timeEntryCrudIndexer`. |
| `packages/core/src/modules/staff/api/timesheets/time-entries/[id]/timer-stop/route.ts` | Replace the inline mutation with `commandBus.execute`, following `start-timer/route.ts`. Keep the mutation-guard wiring. |
| `packages/core/src/modules/staff/api/timesheets/time-entries/__tests__/timer-segment-atomic-write.test.ts` | Rework — relocate the #2416 lock assertions to a command-level test (§ Rework). |
| `packages/core/src/modules/staff/__integration__/TC-STAFF-029-timer-stop-list-cache-consistency.spec.ts` | New regression test with the pre-stop list GET. |
| `packages/core/src/modules/staff/__integration__/TC-STAFF-011.spec.ts` | Add a pre-stop list GET. |
| `packages/core/src/modules/staff/i18n/*.json` | Any new audit-label key (`staff.audit.timesheets.time_entries.stopTimer`). |

### `stopTimerCommand` shape

Model it on `startTimerCommand` ([`timesheets-entries.ts:310`](../../packages/core/src/modules/staff/commands/timesheets-entries.ts:310)).
The business logic moves verbatim out of the route — do not rewrite it:

- `ensureTenantScope` / `ensureOrganizationScope` / `commandInputScope` from the parsed input.
- **Ownership check — owner-only, no `manage_all` bypass.** The current route resolves the caller's
  staff member via `getStaffMemberByUserId` and 403s unless `entry.staffMemberId` matches
  ([route line 72](../../packages/core/src/modules/staff/api/timesheets/time-entries/%5Bid%5D/timer-stop/route.ts:72)).
  It has **no** `manage_all` bypass. Port that check verbatim into the command.

  Do **not** copy the `callerHasManageAll(ctx)` + `resolveCallerStaffMemberId(em, ctx)` pattern from
  `startTimerCommand` / `updateTimeEntryCommand`. Those commands do let `staff.timesheets.manage_all`
  holders act on other people's entries; adopting it here would grant a new ability — stopping a
  colleague's running timer — that the endpoint does not currently permit. That is an RBAC behavior
  change, not a refactor, and it is explicitly **out of scope** for this spec. If it is wanted, it
  needs its own spec, its own approval and its own coverage.

  Preserve the existing 403 status and message key (`staff.timesheets.errors.notOwner`).

  This is a deliberate divergence from the sibling commands. Add a code comment saying so, or the
  next reader will "fix" the inconsistency and silently widen authorization.
- The transaction body is unchanged: `PESSIMISTIC_WRITE` lock on the entry, load segments, 409 on no
  active segment (`staff.timesheets.errors.noActiveSegment`), close the active segment, recompute
  `durationMinutes` from all `work` segments, set `endedAt`.
- After the transaction: `emitCrudSideEffects({ action: 'updated', events: staffTimeEntryCrudEvents,
  indexer: timeEntryCrudIndexer, … })` — this is also what gets the entry reindexed, which the route
  never did.
- **Add `cacheAliases: ['staff.timesheet']` to `timeEntryCrudIndexer`**
  ([`timesheets-entries.ts:13`](../../packages/core/src/modules/staff/commands/timesheets-entries.ts:13)),
  which currently declares only `entityType`. `packages/core/AGENTS.md` requires
  `indexer: { entityType, cacheAliases }` in both `emitCrudSideEffects` and
  `emitCrudUndoSideEffects`. This is a compliance fix, not the mechanism that closes #2609 — the
  command bus already derives the same `staff.timesheet` alias from the command id — but it makes the
  side-effect path carry the alias explicitly instead of relying on that derivation, and it covers
  the undo path the same way. `cacheAliases` is a supported field on `CrudIndexerConfig`
  ([`crud/types.ts:28`](../../packages/shared/src/lib/crud/types.ts:28)); `staff/commands/leave-requests.ts:53`
  is an in-repo example.

  **Correction (review):** the field is declared but **unread**. `emitCrudSideEffects` →
  `DataEngine.markOrmEntityChange` → `emitOrmEntityEvent` consumes only `entityType`,
  `buildUpsertPayload` and `buildDeletePayload`, and performs no cache invalidation at all;
  the only readers of `cacheAliases` anywhere are `command-bus.ts` (`buildLog(...).context`
  / `log.contextJson`) and the audit-logs redo route reading that same `contextJson`. So the
  declaration does not "carry the alias explicitly" — the derivation is doing all of the work,
  on both execute and undo. It is kept purely for the `packages/core/AGENTS.md` convention,
  with a comment saying so, because dropping it would put the file at odds with a documented
  rule. A command needing an alias the command id cannot derive must set
  `buildLog(...).context.cacheAliases` instead, the way
  `planner/commands/availability-weekly.ts:322` does. See § Follow-ups.

  Blast radius: `timeEntryCrudIndexer` is shared by the four existing time-entry commands
  (create/start/update/delete), so they all gain the alias too. That is additive — a broader tag
  flush, never a narrower one — but mention it in the PR description.
- Keep the `emitStaffEvent('staff.timesheets.time_entry.timer_stopped', …, { persistent: true })`
  emit with its existing payload shape (event ids are a frozen contract surface).
- `buildLog` as described in § How invalidation will reach the right tags.
- Return `{ timeEntryId, durationMinutes }` so the route can keep its response body.

### Undo — needs a before-snapshot, not `startTimerCommand`'s shape

`startTimerCommand.undo` soft-deletes the entry it created. Stop-undo is a different problem: it must
*reverse* a mutation that spans two rows (the entry and one segment), so an after-capture alone is
not enough to reconstruct it.

**`prepare` (before-snapshot) is required.** Follow `updateTimeEntryCommand.prepare`
([`timesheets-entries.ts:474`](../../packages/core/src/modules/staff/commands/timesheets-entries.ts:474)),
which returns `{ before: snapshot }`. Note `loadTimeEntrySnapshot` captures the **entry only** — it
does not capture segments — so the stop command needs an extended snapshot recording:

| Field | Why |
|---|---|
| `endedAt` (pre-stop, i.e. `null`) | Restore the running state |
| `durationMinutes` (pre-stop) | **Not** reconstructible — it is not necessarily `0`; an entry may carry earlier completed segments |
| Active segment `id` | Identifies which segment to reopen; there is no other way to find it once it is closed |
| Active segment `endedAt` (pre-stop, `null`) | Restore the open segment |
| `updatedAt` | Optimistic-lock coherence |

**Undo must run inside a transaction with the same `PESSIMISTIC_WRITE` lock** on the entry row that
`execute` uses. Without it, an undo racing a concurrent segment write reintroduces #2416 through the
back door.

**Undo must not break the single-active-timer invariant (#2855).** Reopening a stopped timer makes it
running again — but the staff member may have started another timer in the meantime, and both
`start-timer` paths enforce "at most one running entry per staff member". Under the lock, re-check
for another entry with `startedAt != null, endedAt: null, deletedAt: null` for the same
`staffMemberId`; if one exists, **refuse the undo** rather than creating a second running timer —
throw `CrudHttpError(409, …)` with the existing `staff.timesheets.errors.timerAlreadyRunning` key.

**The `409` is internal only; the public undo API still answers `400`.** The shared undo endpoint
wraps `commandBus.undo` in a `try/catch` that swallows the error and returns a fixed
`{ error: 'Undo failed' }` at status `400`
([undo route line 122](../../packages/core/src/modules/audit_logs/api/audit-logs/actions/undo/route.ts:122)),
so the `CrudHttpError` status never reaches the caller. Use `409` anyway — it is the correct internal
signal, it is what the command's unit test asserts, and it is what would surface if the endpoint
later learns to preserve `CrudHttpError` statuses.

Do **not** change that endpoint as part of this work: it is shared by every undoable command in the
platform, so altering its error contract is a separate, wider change needing its own spec. If the
opaque `400` proves to be a real UX problem for this flow, file it as a follow-up.

Finish with `emitCrudUndoSideEffects({ action: 'updated', events: staffTimeEntryCrudEvents, indexer:
timeEntryCrudIndexer, … })`, matching `updateTimeEntryCommand.undo`.

### Route shape

Copy [`start-timer/route.ts`](../../packages/core/src/modules/staff/api/timesheets/time-entries/start-timer/route.ts)
wholesale: `buildContext` helper, `parseScopedCommandInput`, `commandBus.execute`, and the
`x-om-operation` undo header block. The entry id comes from the URL, not the body — keep the
existing `extractEntryIdFromUrl` helper and merge it into the command input.

### Mutation guards

The route currently calls `runStaffMutationGuards` before the write and
`runStaffMutationGuardAfterSuccess` after it. `packages/core/AGENTS.md` requires this wiring for
custom write routes, so **keep the guard calls in the route**, around the `commandBus.execute` call.
Do not move them into the command and do not drop the `afterSuccessCallbacks` loop.

## API contracts (must not change)

`POST /api/staff/timesheets/time-entries/{id}/timer-stop` is a public contract surface under
`BACKWARD_COMPATIBILITY.md`. Preserve exactly:

| Aspect | Value |
|---|---|
| Success body | `{ ok: true, durationMinutes: number }` at `200` |
| Entry not found | `404` `{ error }` (`staff.timesheets.errors.entryNotFound`) |
| Not owner | `403` `{ error }` (`staff.timesheets.errors.notOwner`) — applies to **every** caller, including `staff.timesheets.manage_all` holders; this endpoint has no bypass and must not gain one here |
| No active segment | `409` `{ error }` (`staff.timesheets.errors.noActiveSegment`) |
| Unauthorized | `401` `{ error }` |
| Missing scope / generic failure | `400` `{ error }` (`staff.timesheets.errors.timerStop`) |
| Guard block | `guardResult.errorStatus ?? 422` with `guardResult.errorBody` |
| Route metadata | `requireAuth: true`, `requireFeatures: ['staff.timesheets.manage_own']` |
| `openApi` export | Keep as-is. Do **not** try to document the `x-om-operation` response header — `OpenApiResponseDoc` has no `headers` field ([openapi/types.ts:13](../../packages/shared/src/lib/openapi/types.ts:13)); the `headers` on `OpenApiMethodDoc` describes *request* headers. Documenting response headers would require extending the shared OpenAPI model, which is out of scope. `start-timer` sets the same header undocumented today. |

Additive only: the `x-om-operation` header (undo token) appears on success, matching `start-timer`.

**Documented deltas.** Three behaviours do change, all fail-closed and all intended:

1. **Guard ordering.** Guards now run before entry resolution, so a blocking guard on a
   missing entry answers with the guard's status rather than `404`.
2. **Non-UUID `{id}`.** The command input is zod-validated (`scopedUpdateFields.id` is
   `z.string().uuid()`), so a malformed path segment now fails validation instead of reaching
   a lookup that would have returned `404`.
3. **Tenant resolution narrows to the authenticated tenant.** The old routes scoped by
   `scope?.tenantId ?? auth.tenantId`; the command path resolves the tenant through
   `withScopedPayload` as `ctx.auth?.tenantId`, and `ensureTenantScope` then hard-requires
   input and auth tenant to match. A superadmin operating under a tenant override therefore
   gets `404` where the route previously acted. This is deliberate: auth-tenant-only is the
   invariant every command-bus write already enforces, and restoring the old preference would
   require relaxing the shared `ensureTenantScope` guard. Organization scoping is unchanged
   (`ctx.selectedOrganizationId ?? ctx.auth?.orgId` matches the old
   `scope?.selectedId ?? auth.orgId`).

Both UI call sites must keep working unchanged:
[`TimerBar.tsx:234`](../../packages/core/src/modules/staff/lib/timesheets-ui/TimerBar.tsx:234) and
[`widget.client.tsx:188`](../../packages/core/src/modules/staff/widgets/dashboard/timesheets-time-reporting/widget.client.tsx:188).

## Data models

No schema change. No migration. `StaffTimeEntry` and `StaffTimeEntrySegment` are untouched.

## Scope

This spec covers **`timer-stop` only**. That is the endpoint #2609 reports, and it closes the issue
on its own: its own route, its own command, its own regression test.

### Implementation steps

1. Add `staffTimeEntryStopTimerSchema` to `data/validators.ts`.
2. Add `stopTimerCommand` (with `prepare`, `buildLog` and the transactional `undo`) to
   `commands/timesheets-entries.ts` and register it. Add `cacheAliases: ['staff.timesheet']` to
   `timeEntryCrudIndexer` in the same file.
3. Rewrite `[id]/timer-stop/route.ts` as a delegating route, keeping the mutation-guard wiring and
   the response/status contract.
4. Add the audit label translation key.
5. Rework the unit coverage per § Testing (route-delegation test + command test).
6. Add `TC-STAFF-029` (below). Confirm it fails before step 3 and passes after.

### Follow-ups

**`[id]/timer-start` — same defect class. Now fixed in this branch (third commit).**
The route set `lockedEntry.startedAt` and `lockedEntry.source` on the entry row and never
invalidated, so a list cached before a start kept showing the entry as not started.

This was originally deferred to its own spec on the grounds that proving the cache fix needs its own
regression test (a pre-*start* list GET) that this spec's test plan did not provide. That reason
expired once the deferral was empirically confirmed (§ Separate defect found during manual QA) and
`stopTimerCommand` plus `TC-STAFF-029` existed as templates: the remaining work was a mirror of an
already-reviewed conversion, and `TC-STAFF-031` supplies the missing pre-start gate. The two `409`
invariants — the already-started check and the single-active-timer check (#2855) — moved into the
command with the rest of the logic.

It is distinct from `start-timer/route.ts`: that one **creates and starts** a new entry (already
command-backed); this one starts an **existing** entry. It therefore took its own command id,
`staff.timesheets.time_entries.start_timer_existing`, rather than overloading `start_timer`.

Undo differs from `startTimerCommand`'s in a way worth noting: that command creates the entry and so
undoes by soft-deleting it, whereas this one only flips an entry that already existed, so undo
restores the prior `startedAt`/`source` and soft-deletes the work segment the start opened. It
refuses with `409` when the timer has since been stopped, because the stop's `endedAt` and
`durationMinutes` were computed from the very segment undo would retire.

### Follow-ups — separate specs/issues, not this PR

**Segment routes — not this bug.** `[id]/segments/route.ts` (POST) and
`[id]/segments/[segmentId]/route.ts` (PATCH) also bypass the command bus, but they mutate only
`StaffTimeEntrySegment`, never the parent `StaffTimeEntry` row, and neither exposes a cached GET — so
no cached list projection goes stale. Converting them is a consistency/audit improvement only.

**Establish what actually gates `TC-STAFF-030`.** Per the corrected root cause above, the
`$exists` predicate compiles to the same SQL as its predecessor on the base-column path, so it
cannot be what turned that spec green. Re-run it on an ephemeral env against a build with the
`timer-start` conversion applied and the predicate reverted. If it passes, `TC-STAFF-030` is a
second gate on the timer-start cache bug and its name/description should say so; if it fails,
there is a third defect behind the TimerBar symptom that nothing in this branch addresses.

**`CrudIndexerConfig.cacheAliases` is declared but unread.** Either wire the ORM side-effect
path to honour it, or drop it from `crud/types.ts` and correct the
`packages/core/AGENTS.md` § Command Side Effects rule that tells every command to set it. Until
one of those happens, the rule instructs authors to write configuration with no effect —
`staff/commands/leave-requests.ts:53` and this file both follow it. Platform-level, not this PR.

**Review nits carried forward** (deliberately not fixed here to keep this diff scoped; recorded here
so they can be filed as follow-ups):

- `stopTimerCommand` writes `lockedEntry.updatedAt` by hand in both `execute` and `undo`, but
  `StaffTimeEntry.updatedAt` already declares `onUpdate`, and `startTimerExistingCommand.undo`
  correctly relies on that hook. Related: `TimeEntryStopUndoState.updatedAt` is captured and
  never restored, so it is a dead field in the undo payload.
- Both commands pass the pre-transaction `entry` instance to `emitCrudSideEffects`, whose
  `endedAt` / `durationMinutes` / `startedAt` are the pre-write values. Harmless — the reindex
  payload carries only `recordId` plus scope and the subscriber re-reads, and the CRUD event
  payload is identifiers-only — but passing the `lockedEntry` returned from the transaction
  would make the intent match the mechanism.

## Testing

### New: `TC-STAFF-029-timer-stop-list-cache-consistency.spec.ts`

The point of the test is the ordering, not the assertion — it must warm the cache first.

```
1. auth as employee; GET /api/staff/team-members/self
2. create time project; assign the staff member
3. POST /time-entries  { date: today, durationMinutes: 0, source: 'timer' }
4. POST /time-entries/{id}/timer-start
5. GET  /time-entries?staffMemberId=…&from=today&to=today   <- REQUIRED: warms the cache key
6. POST /time-entries/{id}/timer-stop                        -> 200
7. GET  /time-entries?staffMemberId=…&from=today&to=today    <- same key as step 5
     expect ended_at   toBeTruthy()
     expect started_at toBeTruthy()
8. GET  /time-entries?ids={id}
     expect ended_at matches step 7 (the two read paths must agree)
9. finally: delete entry + project
```

Requirements from `.ai/qa/AGENTS.md`: self-contained, creates its own fixtures via the API, cleans up
in `finally`, no reliance on seeded data. Reuse the helpers in
`@open-mercato/core/helpers/integration/timesheetFixtures` as
`TC-STAFF-028-timer-note-edits-persist.spec.ts` does.

The test only has teeth with `ENABLE_CRUD_API_CACHE=true`, which every `yarn test:integration*`
script and the ephemeral runner already set. Do not add a cache-disabled variant — it would pass
vacuously.

### Rework: `__tests__/timer-segment-atomic-write.test.ts`

This existing unit test is **not** carried over as-is, and the implementation must not simply patch
it until it goes green.

It currently mocks `findOneWithDecryption`, `getStaffMemberByUserId`, `runStaffMutationGuards`,
`emitStaffEvent` and `parseScopedCommandInput`, invokes the **route** directly, and asserts that
`LockMode.PESSIMISTIC_WRITE` was requested and that the read-modify-write happened inside one
transaction — the #2416 regression gate. Once the route delegates to `commandBus.execute`, the route
no longer touches the ORM, so those assertions stop proving anything about locking even if the test
is made to pass.

Split the coverage:

| Test | Asserts |
|---|---|
| **Route delegation** (new/rewritten, route-level) | Calls `commandBus.execute` with the right command id and scoped input; runs `runStaffMutationGuards` **before** the call and returns `guardResult.errorBody`/`errorStatus` when blocked; runs `afterSuccessCallbacks` on success; maps command errors to the documented status codes; emits the `x-om-operation` header |
| **Command transaction/lock** (new, command-level) | `PESSIMISTIC_WRITE` on the entry row, single transaction for the read-modify-write — the #2416 gate, relocated to where the ORM work now lives |
| **Command undo** (new) | Restores `endedAt`/`durationMinutes`, reopens the recorded segment, and refuses with `409` when another timer is already running |

Keep the `#2416` issue reference in whichever test inherits the lock assertions, so the regression's
provenance is not lost.

### Also update

`TC-STAFF-011.spec.ts` — add a pre-stop list GET so the existing timer test stops being blind to this
failure mode. Keep its current post-stop assertions.

Integration coverage (TC-STAFF-029) remains the cache-regression gate; the unit tests above cover
delegation, locking and undo, not caching.

### Manual verification

```bash
yarn test:integration:ephemeral:start
```

Then in the UI at `http://127.0.0.1:5001` (`employee@acme.com` / `secret`): start a timer, navigate
away and back (this warms the cache), stop it, reload — the timer must stay stopped in the grid, the
list view and the sidebar.

### Validation gate

```bash
yarn generate
yarn build:packages
yarn typecheck
yarn lint
yarn test
```

Plus the integration run for the two staff specs.

## Risks & impact review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Command omits `buildLog`, or it returns `null` → no `resourceKind` → cache never invalidated and the bug survives the refactor | **High** | `stopTimerCommand` | Explicitly asserted in § How invalidation will reach the right tags; TC-STAFF-029 fails if invalidation does not happen | Low — the test is the gate |
| Command id prefix changed → `deriveResourceFromCommandId` yields a different alias → tags never match | High | Cache invalidation | Keep the `staff.timesheets.time_entries.*` prefix | Low |
| **Authorization widening**: adopting the sibling commands' `callerHasManageAll` pattern would let `manage_all` holders stop a colleague's timer — an ability the endpoint does not grant today | **High** | RBAC | Owner-only check ported verbatim, called out in § stopTimerCommand shape with a code comment explaining the deliberate divergence; add a case asserting a `manage_all` holder still gets 403 on someone else's entry | Low once tested |
| Concurrency regression: losing the `PESSIMISTIC_WRITE` lock or the transaction boundary reintroduces #2416, **and** the existing unit gate stops covering it once the route no longer touches the ORM | **High** | Timer correctness | Move the transaction body verbatim; relocate the lock assertions from `timer-segment-atomic-write.test.ts` to a command-level test (§ Rework) rather than patching the route test green | Low once relocated |
| Undo restores a half-state (entry reopened but segment left closed, `durationMinutes` not restored), or reopens a timer while another is already running — violating #2855 | **High** | Undo / timer correctness | `prepare` before-snapshot capturing entry **and** active-segment identity; undo runs under the same lock in a transaction and refuses with `409` when another timer is running (§ Undo) | Medium — the least-exercised path; must ship with the undo test |
| New `x-om-operation` header surfaces an undo affordance for timer stops where none existed | Low | UX | Additive and consistent with `start-timer`; flag in the PR description for QA | Low |
| Response-shape drift (e.g. returning `{ ok, id }` like `start-timer` instead of `{ ok, durationMinutes }`) breaks both UI call sites | Medium | API contract | Contract table above; TimerBar reads `durationMinutes` | Low |

### Backward compatibility

- No contract surface is removed. Event id `staff.timesheets.time_entry.timer_stopped` keeps its id,
  payload and `persistent: true`.
- Route path, method, metadata, status codes and success body are unchanged.
- New command ids are additive.
- No DB schema change, so no migration and no snapshot update.
- No `UPGRADE_NOTES.md` entry required.

## PR / labelling notes

Per `.ai/docs/pr-workflow.md`: this is `bug`, `priority-high` (upstream label), `risk-high` — the
change touches a shared write path, carries an authorization check that must not drift, relocates a
concurrency regression gate, and adds an undo path. Three High risks in the table below; per the
"when signals conflict pick the higher one" rule, `risk-medium` understates it. The change touches no
`.tsx` outside tests and no
`packages/ui/src/`, but it **does** change API behavior beyond a pure refactor, so it should keep
`needs-qa` rather than take the automated-verification `skip-qa` exemption.

Post the reproduction evidence above on #2609 so its "doesn't reproduce" thread is resolved, and
reference the control run — it explains why TC-STAFF-011 was never going to catch it.

## Implementation Status

| Step | Status | Date | Notes |
|---|---|---|---|
| 1 — `staffTimeEntryStopTimerSchema` | Done | 2026-07-29 | `data/validators.ts`; scoped create fields + `id` |
| 2 — `stopTimerCommand` + `cacheAliases` | Done | 2026-07-29 | `commands/timesheets-entries.ts`; registered next to the existing four |
| 3 — Delegating `timer-stop` route | Done | 2026-07-29 | Guards kept in the route, around `commandBus.execute` |
| 4 — Audit label translation | Done | 2026-07-29 | `staff.audit.timesheets.time_entries.stopTimer` in en/de/es/pl |
| 5 — Unit coverage rework | Done | 2026-07-29 | Route-delegation + command lock/undo tests; #2416 gate relocated |
| 6 — `TC-STAFF-029` + `TC-STAFF-011` pre-stop GET | Done | 2026-07-29 | Both fail pre-fix, pass post-fix on the ephemeral env |
| 7 — `[id]/timer-start` conversion (was deferred) | Done | 2026-08-08 | `start_timer_existing` command + delegating route + `TC-STAFF-031`; unit + build gate green, integration confirmed fail-before / pass-after |

### Deliberate implementation decisions

**Undo's before-state is captured inside `execute`, under the lock — not in `prepare`.**
`prepare` still runs and supplies the entry-level `snapshotBefore` for the audit log as the spec
requires, but it executes *outside* the transaction, so a segment identity read there is
inherently racy: a `POST .../segments` landing between `prepare` and `execute` would make
`prepare` record a segment that `execute` never closed, and undo would reopen the wrong row.
`execute` therefore captures `endedAt`, `durationMinutes`, `updatedAt` and the active segment's
id/`endedAt` after taking the `PESSIMISTIC_WRITE` lock and returns them on its result, which
`buildLog` folds into the undo payload. This is strictly stronger than the spec's shape; the
recorded segment is provably the one that was closed. The command result is
`{ timeEntryId, durationMinutes, undoState }` — the route reads only `durationMinutes`, so the
`{ ok, durationMinutes }` response body is unchanged.

**Guard ordering shifted.** The old route resolved the entry (404) and checked ownership (403)
*before* running the mutation guards; the entry lookup now lives in the command, so guards run
first. A blocking guard on a non-existent entry therefore answers with the guard's status rather
than `404`. No documented contract covers that ordering, and the spec requires the guards to wrap
`commandBus.execute`.

**Scope-error message key preserved.** `parseScopedCommandInput` defaults to
`errors.tenant_required` / `errors.organization_required`; both are overridden to
`staff.errors.missingScope` so the 400 body keeps the message it had before the refactor.

### Verification

`yarn generate`, `yarn build:packages`, `yarn typecheck`, `yarn lint` (0 errors) and the staff unit
suites all pass. Two full-monorepo `yarn test` runs each hit one flaky `SIGSEGV` jest-worker crash —
`@open-mercato/app` `bootstrap.test.ts` on the first run, `@open-mercato/ai-assistant` on the second —
and both suites pass in isolation; neither touches staff. One genuine pre-existing failure is
unrelated to this change: `packages/core/src/__tests__/explicit-sort-comparators.test.ts` flags
`scripts/check-agents-md-budget.mjs:93`, a file this change does not touch.

#### Integration: the "fails before the fix" gate is confirmed

Both specs were run on 2026-07-29 against an ephemeral environment (`http://127.0.0.1:5001`) whose
build predated the refactor — verified, not assumed: its server bundle contains
`staff.timesheets.time_entries.start_timer` but no `…stop_timer`, so the requests hit the old
hand-rolled route.

| Spec | Result against pre-fix code |
|---|---|
| `TC-STAFF-029` | **FAIL** — `ended_at` is `null` in the list served from the cache key warmed before the stop |
| `TC-STAFF-011` (with the new pre-stop GET) | **FAIL** — same assertion, at its own step 7 |

This satisfies § Implementation steps 6 ("Confirm it fails before step 3") and independently
confirms the § Why it looked unreproducible analysis: TC-STAFF-011 passed for months and now fails
on the *identical* code, with the pre-stop list GET as the only difference. The test was
structurally blind, not the bug absent.

#### Integration: the fix is confirmed

The environment was then rebuilt (fresh Postgres, full app rebuild) and came up on
`http://127.0.0.1:49332`. Its bundle now contains `staff.timesheets.time_entries.stop_timer`,
confirming the new command is the code under test.

| Spec | Pre-fix build | Post-fix build |
|---|---|---|
| `TC-STAFF-029` | FAIL | **PASS** |
| `TC-STAFF-011` (with the pre-stop GET) | FAIL | **PASS** |

Same specs, same assertions, same warmed cache key — only the route implementation changed. That is
the end-to-end proof that the command bus now invalidates the `staff.timesheet` tag the list route
caches under, which no unit test can establish.

#### Wider regression check — full `staff/__integration__` suite

An initial run was blocked on a missing Chromium binary (Playwright 1.61.1 wanted build 1228, the
cache held 1217). After `npx playwright install chromium`, the full folder ran with browsers:
**43 passed, 3 failed**.

| Spec | Verdict |
|---|---|
| `TC-STAFF-014` | Flake — failed under full-suite load, **passes** in isolation and did not recur |
| `TC-STAFF-027` | Pre-existing failure, unrelated to this change |
| `TC-STAFF-028` | Pre-existing failure, unrelated to this change |

Final suite state after the separate `running=true` fix (below): **45 passed, 2 failed** —
`TC-STAFF-027` and `TC-STAFF-028` only.

The two reproducible failures are inherited from the timesheets-UX work that landed immediately
before this branch, not regressions here. The handoff doc committed with them
([`.ai/analysis/2026-07-27-timesheets-ux-handoff.md`](../analysis/2026-07-27-timesheets-ux-handoff.md)
§ Verification status) states plainly: *"No integration tests were executed. `TC-STAFF-028` has not
been run."* — and its next-steps list names `TC-STAFF-027` and `TC-STAFF-028` as specs still to be
run and confirmed. Neither has ever been observed passing on this branch.

Their failure modes are also outside this change's blast radius: `TC-STAFF-027` waits on a
grid save-confirmation dialog that never renders, and `TC-STAFF-028`'s note edit goes through
`PUT /api/staff/timesheets/time-entries` (the CRUD factory, which invalidates directly) — neither
touches `timer-stop`. This change modifies **no `.tsx` file at all**.

They should be triaged on their own issue; they are pre-existing debt this PR inherits rather than
creates, and they should not gate it.

#### Integration: `TC-STAFF-031` proven non-vacuous

The `[id]/timer-start` conversion shipped with the same fail-before/pass-after standard applied to
`TC-STAFF-029`, because a new regression gate that has only ever been observed passing proves
nothing — that is precisely how `TC-STAFF-011` masked #2609 for two months.

Post-fix, on a fresh ephemeral env (isolated port 58146, `ENABLE_CRUD_API_CACHE=true`):
`TC-STAFF-011`, `TC-STAFF-029`, `TC-STAFF-030` and `TC-STAFF-031` all **pass** — so the three
pre-existing specs that `POST` to `timer-start` did not regress. Those four are the complete affected
surface; no other spec in `staff/__integration__` touches that endpoint.

Pre-fix, the route was checked out at `50cf84394` (the commit before the conversion) in a **detached
git worktree with its own `yarn install`** — deliberately not a symlinked `node_modules`, since the
workspace link `node_modules/@open-mercato/core` would then resolve back to the fixed source and
silently invalidate the experiment. Verified before building: the resolved route file contained zero
`commandBus` references, and the workspace link was relative (`../../packages/core`).

| Spec | Pre-fix build | Post-fix build |
|---|---|---|
| `TC-STAFF-031` | **FAIL** — `Started entry must have started_at in the list served from the warmed cache key` | **PASS** |

The failure lands on the cache-staleness assertion itself, not on setup, which is what makes it a
gate rather than a smoke test. Playwright's retry then failed differently — `POST timer-start`
returned `409` instead of `200` — because the first attempt left a running timer that teardown could
not see: `stopActiveEntries` reads the same stale list. That cascade is a downstream artifact of the
bug, not a second defect.

#### `running=true` hardened to `$exists` — and a corrected root cause

Manual verification of this fix was blocked by a separate symptom: the TimerBar never left
the "Start" state, so the stop flow could not be exercised by hand at all.

`buildTimeEntryListFilters` built the #3717 running-timer lookup as
`{ started_at: { $ne: null }, ended_at: null }`, and this spec originally recorded that as
the cause, on the theory that the query engine renders `$ne` as SQL `!=` and a bare value as
`=`, matching zero rows. **That mechanism was wrong for these two fields**, and the correction
matters more than the fix does. The engine has two operator dispatchers
([`query/engine.ts`](../../packages/shared/src/lib/query/engine.ts)):

| Dispatcher | Used when | `{ $ne: null }` | bare `null` | `$exists` |
|---|---|---|---|---|
| `applyColumnOp` / `buildColumnOpExpression` | the field is a real base column | `IS NOT NULL` | `IS NULL` | `IS NOT NULL` / `IS NULL` |
| `applyIndexDocFilter` | `resolveBaseColumn` found no column, so the field is read from `entity_indexes.doc` | `doc->>'f' <> NULL` → UNKNOWN, **zero rows** | `= NULL` → UNKNOWN, **zero rows** | `IS NOT NULL` / `IS NULL` |

Both base dispatchers null-guard `eq` and `ne` explicitly. `started_at` and `ended_at` are
real columns on `staff_time_entries`, so the list route takes the **first** row: the pre-fix
predicate and `$exists` compile to identical SQL, and the ORM fallback path agrees
(MikroORM maps `$exists` to `not null` and already handled `$ne: null`). The change is
therefore **behaviour-preserving hardening**, not a bug fix, and the "blind to running
timers" conclusion does not follow from it.

`$exists` is still the right spelling and stays: it is the only one that is null-safe
regardless of how a field resolves, which is a real hazard for any filter over a field that
falls through to the index doc. The unit test's `nullSemanticsOf` helper models the strict
(index-doc) dispatcher for exactly that reason.

**Open question, deliberately not closed here:** if `TC-STAFF-030` genuinely failed pre-fix,
the cause was not this predicate. The most likely explanation is the item below — the
`[id]/timer-start` cache staleness confirmed in the same debugging session, whose fix landed
in this branch's third commit. Re-running `TC-STAFF-030` against a build with commit 3 applied
and this predicate reverted would settle it; that needs an ephemeral env and has not been done.

Two things this investigation established that matter beyond the fix:

- **`{ $ne: null }` is safe far more often than first recorded.** It is correct on the
  MikroORM path *and* on the query engine's base-column path. The genuine hazard is narrower
  and was previously unnamed: null equality against a field resolved from `entity_indexes.doc`.
  The earlier claim that this was "the only query-engine occurrence" of a broken predicate
  does not hold and should not be used to justify skipping other call sites.
- **`[id]/timer-start` really does leave the cache stale**, confirmed empirically while
  debugging TC-STAFF-030: with a key warmed before the start, the warmed read returns
  `total 0` while a cold key returns the entry. That reproduction is what retired the
  deferral: the route was converted in this branch's third commit (see § Follow-ups). The UI
  was never affected, because TimerBar starts through the command-backed atomic
  `/start-timer` route (#3311); only the legacy per-entry route was.

A predicted knock-on did **not** materialise: changing the filter did not recover
`TC-STAFF-028`, which fails identically afterwards. Its cause is still unidentified.

## Changelog

| Date | Change |
|---|---|
| 2026-08-10 | Review fixes (`om-auto-fix-pr`): (1) **corrected the `running=true` root cause** — the query engine's base-column dispatchers (`applyColumnOp` / `buildColumnOpExpression`) null-guard `eq`/`ne` into `IS NULL` / `IS NOT NULL`, so the pre-fix predicate compiled to the same SQL as `$exists` and the "matches zero rows" claim only holds on the `applyIndexDocFilter` path, which these real columns do not take; `$exists` is retained as null-safe-on-both-paths hardening, and the open question of what actually gates `TC-STAFF-030` is recorded as a follow-up; (2) recorded that `CrudIndexerConfig.cacheAliases` has **no runtime reader** — the declaration is kept for the `packages/core/AGENTS.md` convention with a comment saying so, and the platform gap is a follow-up; (3) documented the tenant-resolution narrowing (auth-tenant-only via `ensureTenantScope`) alongside the guard-ordering and non-UUID-`{id}` deltas in § API contracts; (4) added the four missing `staff.timesheets.my.*` keys across all four locales so `yarn i18n:check-usage` exits clean on this branch; (5) corrected the `nullSemanticsOf` unit-test helper to model the index-doc dispatcher and fixed its wrong engine path reference. |
| 2026-08-08 | Third commit: converted the deferred `[id]/timer-start` to `staff.timesheets.time_entries.start_timer_existing`, with `TC-STAFF-031` as the pre-start cache gate and the route's #2416/#2855 assertions relocated to a command-level test. Full unit suite green (7929 passed); the only failure is the pre-existing `explicit-sort-comparators` one, which flags `scripts/check-agents-md-budget.mjs:93` — a file untouched here. Integration: `TC-STAFF-011`, `TC-STAFF-029`, `TC-STAFF-030` and `TC-STAFF-031` all pass post-fix, and `TC-STAFF-031` was confirmed failing pre-fix (§ Integration: `TC-STAFF-031` proven non-vacuous). |
| 2026-07-29 | Separate commit: fixed the `running=true` filter (`$exists` instead of null equality), added `TC-STAFF-030` as the execution-level gate, and empirically confirmed the deferred `[id]/timer-start` cache-staleness follow-up. Suite now 45 passed / 2 failed. |
| 2026-07-29 | Full staff integration suite run with browsers installed: 43 passed, 3 failed. `TC-STAFF-014` is a load flake (passes in isolation); `TC-STAFF-027` and `TC-STAFF-028` are pre-existing failures inherited from the preceding timesheets-UX commit, whose own handoff doc records them as never executed. |
| 2026-07-29 | Integration verified end to end: `TC-STAFF-029` and the amended `TC-STAFF-011` both FAIL against a pre-fix build and PASS against the rebuilt one. |
| 2026-07-29 | Implemented steps 1-6. Undo's before-state moved from `prepare` into `execute` under the lock (see § Deliberate implementation decisions); everything else follows the spec as written. |
| 2026-07-29 | Spec created. Root cause verified live on the ephemeral env (repro + control). Scope narrowed from four routes to two after confirming the segment routes do not mutate the parent entry. |
| 2026-07-29 | Second review pass: (1) clarified that the undo `409` is internal only — the shared undo endpoint returns a fixed `400`, and changing it is out of scope; (2) dropped the "document `x-om-operation` in `openApi`" requirement — `OpenApiResponseDoc` has no response-header field, the header stays additive and undocumented as `start-timer`'s already is; (3) added `cacheAliases: ['staff.timesheet']` to `timeEntryCrudIndexer` for command-side-effect compliance, with its shared blast radius noted. |
| 2026-07-29 | Review fixes: (1) ownership stays owner-only — the `manage_all` bypass copied from the sibling commands would have widened authorization, now explicitly out of scope; (2) undo respecified with a `prepare` before-snapshot (entry + active-segment identity), a locked transaction, and `409` handling for the #2855 single-active-timer invariant; (3) `[id]/timer-start` moved out of scope to its own follow-up, since this test plan does not prove its cache fix; (4) `timer-segment-atomic-write.test.ts` rework specified — its #2416 lock assertions must move to a command-level test, not be patched green at the route. |
