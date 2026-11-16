# Access-log retention

> **Program:** package D4 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** Phase 1 of [`2026-11-16-operational-retention-pruners.md`](2026-11-16-operational-retention-pruners.md), which creates the shared prune helper; that spec is not yet approved, and this one states exactly what it needs from the helper. **Touches the same file as** open PR #8472, which bounds pending access-log writes. That PR still awaits review and QA.
> **Verified at** `main` @ `08dada9624` by reading code, and PR #8472 by reading its diff; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-11-16-operational-retention-pruners.md

## 📝 TLDR

Every list request writes one access-log row per record it returned, saying who read which record. Those rows are deleted by two unbounded `DELETE` statements that run inside the write path, at most once a minute per process, across all tenants. The windows — seven days for users and roles, eight hours for everything else — can be changed but not switched off, and "everything else" cannot be told apart. **Proposed (future):** deletion moves to a scheduled job that deletes in batches until it has caught up; the inline path stays as a safety net that acts only when the table shows the job has fallen behind; the list of longer-kept record kinds becomes a setting; `0` means keep. Defaults do not change.

**Not in this spec:** the action log, which records changes and needs a spec of its own; what the access log records; the cap on pending writes (PR #8472); the fact that a multi-page export logs only its first page, which is a defect for the security-alerting spec to depend on.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Change the default windows | No | ⚠ NEEDS HUMAN CONFIRMATION. Eight hours is too short to answer "what did this account read last week" after a breach. But the table gets a row per record per list request, so a longer default multiplies its size on every installation. An operator who wants a longer trail sets it. |
| 2 | Where deletion runs | A scheduled job. Inline only when a row older than its window plus an hour exists | Deleting inside a request is the wrong place, but an installation whose scheduler is absent, disabled or has no worker must not grow without bound. Asking the table is the only test that is true in all three cases. |
| 3 | Counting period before the first delete | None | These rows are already deleted today on the same windows. |
| 4 | Which kinds get the long window | A setting, defaulting to today's two | The split is hard-coded to `auth.user` and `auth.role`. |
| 5 | Per-tenant windows | Not here | The enterprise policy engine owns per-tenant retention. |
| 6 | The unused `deleted_at` column | Left alone | It is filtered on read and never set; removing a column is a contract change with no benefit. |

## 📝 Problem Statement

- **What is stored.** `access_logs` holds tenant, organization, acting user, resource kind, resource id, access type, the names of the fields returned and a small context (`packages/core/src/modules/audit_logs/data/entities.ts:108-145`). Resource id, field names and context are encrypted; the kind and the acting user are not (`audit_logs/encryption.ts:16-23`). There is no address or user agent.
- **What writes it.** `logCrudAccess` writes one row per distinct record returned, on every list request including cache hits, from `makeCrudRoute` and eleven hand-written routes (`packages/shared/src/lib/crud/factory.ts:933-1007, 1860, 2042, 2291`).
- **How it is deleted.** After a successful write, at most once per interval per process, the service issues two `nativeDelete` calls with no tenant filter and no batch limit; an error is logged as a warning (`audit_logs/services/accessLogService.ts:140-143, 396-415`).
- **The settings.** `AUDIT_LOGS_CORE_RETENTION_DAYS` (7), `AUDIT_LOGS_NON_CORE_RETENTION_HOURS` (8) and `AUDIT_LOGS_ROTATE_INTERVAL_MS` (60000) are read once at module load. Zero or an unparsable value falls back to the default, so deletion cannot be turned off (`accessLogService.ts:17-40`). "Core" is exactly `auth.user` and `auth.role`.
- **Consequences.**
  - A quiet process never deletes; a busy one runs two table-wide deletes on a request's tail.
  - After a long outage or a window change, the first delete is as large as the backlog.
  - An operator cannot keep access logs for an investigation without editing code.
- **Who reads it.** One API route and the Access tab of the audit page. Nothing else: no undo path, no "last accessed" display, no export.
- **PR #8472** makes the inline rotation single-flight and bounds pending writes. It leaves the windows and the two deletes as they are.
- **A subject's rows.** With encryption on, the resource id is ciphertext, so rows *about* a person cannot be found; rows *by* a staff user can, through the acting-user column. Both are gone within the window.

## 📝 Proposed Solution

| Aspect | Today | Proposed |
|---|---|---|
| Where deletion runs | Inline after a write | A job on a system-scoped cron schedule, every fifteen minutes |
| How it deletes | Two unbounded statements | Batches of a fixed size, repeated until a batch comes back short or a time budget is spent; if rows remain, the job enqueues itself again at once |
| Safety net | — | After a write, at most once per interval, the service asks whether any row is more than an hour past its window. If one is, it runs the same batched delete for a short time budget |
| Long-window kinds | Hard-coded | `AUDIT_LOGS_CORE_RESOURCE_KINDS`, a comma-separated list, default `auth.user,auth.role` |
| `0` | Falls back to the default | Keeps those rows indefinitely |
| When settings are read | Module load | Each run |
| Failure | A warning | Reported through the logger and the error reporter |

**Why no fixed cap.** One row is written per record per list request. A run that stops after a fixed number of batches has a ceiling, and above that write rate the table would grow forever with everything healthy. The job therefore runs until it has caught up, bounded by time, not by count.

**The two deletes.** First, every row older than the long window, whatever its kind — a pure range on `created_at`. Second, rows older than the short window whose kind is not on the list. The second walks forward by `(created_at, id)` within a run, so the listed kinds' rows it must leave are passed once, not rescanned by every batch.

**What this needs from the shared helper.** One function that, given an entity manager, a table, a condition with its parameters, a cutoff, a batch size and a time budget, deletes in batches and returns how many it deleted and whether more remain. It must accept a cutoff computed from hours or fractions of a day, must not consult the helper's counting mode, and must be callable from a request with nothing but an entity manager. If the pruner spec's helper does not offer this when it lands, this change adds it there.

The eight-hour window stays in hours, and fractional values stay valid.

| Alternative | Why rejected |
|---|---|
| Lengthen the defaults | See assumption 1. |
| Remove the inline path | An installation with no working scheduler would never delete. |
| Keep the inline path while "no schedule exists" | A schedule exists on every new installation, including ones where it is disabled or no worker runs. |
| A fixed number of batches per run | See above. |
| One window for everything | Loses the longer trail for the two kinds that matter most for account investigations. |

## 📝 Delta

### Capability: operational-retention

#### MODIFIED Requirement: Access-log deletion
The system SHALL delete access-log rows older than their window in batches on a schedule, SHALL keep them indefinitely when the window is set to `0`, and SHALL delete after a write only when a row is more than an hour past its window.

##### Scenario: Scheduled run
- WHEN the job runs with default settings
- THEN rows for ordinary kinds older than eight hours and rows for the listed kinds older than seven days are gone, and newer rows remain

##### Scenario: Zero
- WHEN the ordinary window is `0`
- THEN no ordinary row is deleted

##### Scenario: A kind added to the list
- WHEN a resource kind is added to the long-window list
- THEN its rows are kept for the long window from then on

##### Scenario: The job is not running
- WHEN no job has run and a row is more than an hour past its window
- THEN a later write deletes it, in batches

##### Scenario: The job is keeping up
- WHEN no row is more than an hour past its window
- THEN a write deletes nothing

##### Scenario: Backlog
- WHEN more rows are eligible than one run can delete within its time budget
- THEN the job runs again at once and continues

Frozen by: `packages/core/src/modules/audit_logs/services/__tests__/accessLogService.rotation.test.ts` (existing; extended)

## 📝 Architecture

- **`audit_logs/workers/`**: a prune handler on a queue of its own at concurrency 1.
- **`audit_logs/setup.ts`**: registers the schedule through a function that the module's upgrade action also calls; guarded by `hasRegistration('schedulerService')`. The schedule's id is a UUID derived from a stable key, as the cart module derives its own.
- **`audit_logs/services/accessLogService.ts`**: the inline rotation becomes the safety net. It needs only the entity manager it already has; it does not look at the scheduler.
- **Settings** are parsed in one place, on each run.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Module → scheduler | `schedulerService` by DI key, in `setup.ts` only | The safety net does all the deleting |
| Module → shared helper | Import from `@open-mercato/shared` | — |

## 📝 Data Models

No change. The existing `(created_at)` index serves both deletes and the safety net's check.

## 📝 API Contracts

- **Settings.** `AUDIT_LOGS_CORE_RETENTION_DAYS` and `AUDIT_LOGS_NON_CORE_RETENTION_HOURS` keep their names and defaults; `0` now means keep. `AUDIT_LOGS_CORE_RESOURCE_KINDS` is new. `AUDIT_LOGS_ROTATE_INTERVAL_MS` now paces the safety net's check. Both `.env.example` files are updated.
- **Schedule** named `audit_logs.access-log-prune`, with a derived UUID as its id. **Upgrade action** of the same name, with its locale keys and version. Upgrade actions are offered per organization; the registration is idempotent, so running it in several changes nothing. An installation that never runs it keeps deleting through the safety net.
- No route or type changes.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Scheduler absent, disabled, or with no worker | The safety net deletes, an hour later than the job would |
| An existing installation that has not run the upgrade action | The same |
| A value that is not a non-negative number | The default is used and the fact is reported once |
| Both windows `0` | Nothing is deleted; the example file says the table then grows with every list request |
| A long outage | The job re-enqueues itself until it has caught up; meanwhile the safety net also deletes |
| The job and the safety net run at once | Both delete by id in batches; a row deleted by one is simply absent for the other |
| Writes outpace one run's time budget | The job runs back to back. If three consecutive runs end on the budget, that is reported as a warning |

## 📝 Migration & Backward Compatibility

| Change | Class |
|---|---|
| Deletion moves to a schedule | Internal; same rows, same windows |
| `0` means keep | Behaviour change for an installation that had set `0`: it used to get the default. Dated entry and an upgrade note |
| New setting, schedule, upgrade action, queue | Additive |

`UPGRADE_NOTES.md`: run the module's upgrade action; what `0` now means; how to keep a longer trail and what it costs in rows.

## 📋 Implementation Plan

1. Extend the existing rotation test to pin today's behaviour: the two windows, the fallback on `0`, the kinds. Commit alone.
2. Rebase on #8472 if it has merged. Parse settings in one function, per run, with the new list and the meaning of `0`. Unit tests.
3. Replace the two deletes with the batched function, in the order and with the forward walk described. Unit tests with an injected clock: each window, a fractional window, a backlog across two runs, the time budget.
4. Turn the inline rotation into the safety net: the existence check, then the same function with a short budget. Update the rotation test and, if #8472 has merged, its `TC-AUD-016`, whose expired row must be more than an hour past its window to still be deleted inline.
5. Add the queue, the handler with self re-enqueue, the schedule registration and the upgrade action.
6. Integration test; both `.env.example` files; `UPGRADE_NOTES.md`; the dated compatibility entry; the audit-logs docs page.
7. Archive the Delta if the capabilities directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/audit_logs/{services/accessLogService.ts,workers/*,setup.ts,i18n/*}` | Modify / create |
| `packages/core/src/modules/configs/lib/upgrade-actions.ts` | Modify |
| `packages/core/src/modules/audit_logs/services/__tests__/accessLogService.rotation.test.ts`, and `TC-AUD-016` if present | Modify |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUDIT-ACCESS-RETENTION-001.spec.ts` | Create |
| `apps/mercato/.env.example`, the template copy, `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, `apps/docs/docs/user-guide/audit-logs.mdx` | Modify |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-AUDIT-ACCESS-RETENTION-001 | Rows are inserted directly with backdated times chosen so that only the job can delete them: an ordinary one eight and a half hours old and a user one seven days and thirty minutes old — past their windows, inside the safety net's extra hour — plus a user row a day old and a fresh ordinary one. The scheduler's API shows the schedule. The job is enqueued and drained through the integration queue helper. `GET /api/audit_logs/audit-logs/access` then returns the day-old user row and the fresh row and neither of the other two. The test removes what it inserted |

Windows other than the defaults, and `0`, are unit-tested: they come from the running app's environment.

## 📝 Risks & Impact Review

#### The table grows without bound
- **Scenario**: The job is not running, or cannot keep up with the write rate.
- **Severity**: High
- **Affected area**: database size; every list request adds rows
- **Mitigation**: The safety net is driven by the table's own state, not by configuration; the job runs until caught up; repeated runs that end on the time budget are reported.
- **Residual risk**: A write rate above what back-to-back runs can delete. At that point the access log's volume is itself the problem.

#### The shared helper is not there
- **Scenario**: The pruner spec is not approved, or its helper differs.
- **Severity**: Medium
- **Affected area**: this change's schedule
- **Mitigation**: The needed function is stated here and small enough to add with this change.
- **Residual risk**: Two specs adding to the same new file; whichever lands second adapts.

#### An installation that set `0` stops deleting
- **Scenario**: Someone set a window to `0` expecting the default, which is what it did.
- **Severity**: Medium
- **Affected area**: that installation's table size
- **Mitigation**: The upgrade note and the dated entry; the run reports "keeping indefinitely" at warning level each day.
- **Residual risk**: An unread note.

#### Conflict with #8472
- **Scenario**: Both changes rewrite the rotation in the same file.
- **Severity**: Low
- **Affected area**: this change's PR
- **Mitigation**: This work starts after that PR merges or is closed; its integration test is listed among the files to update.
- **Residual risk**: None once sequenced.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/queue/AGENTS.md` (MUST rules), `BACKWARD_COMPATIBILITY.md` for the changed meaning of a setting.

| Rule | Status | Notes |
|---|---|---|
| Background work through the worker contract | Compliant | — |
| Behaviour-changing setting documented | Compliant | Dated entry and upgrade note |
| A catch that records an error also reports it | Compliant | The helper reports |
| Template sync for env vars | Compliant | Named |
| Integration coverage | Compliant | One test for the default path; the rest unit-tested for the reason given |

**Verdict:** approved for implementation after #8472 is resolved and the pruner spec's first phase is approved or folded in, subject to assumption 1.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. A fixed cap per run could lose to the write rate, so the job now runs until caught up within a time budget and re-enqueues itself. The inline path is kept as a safety net triggered by the table's own state, because "a schedule exists" is also true when it is disabled or has no worker. The needs from the shared helper are written out. The schedule id is a derived UUID. The existing rotation test is extended instead of a new characterization file, and the integration test uses rows only the job can delete.
