# Access-log retention

> **Program:** package D4 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** Phase 1 of [`2026-11-16-operational-retention-pruners.md`](2026-11-16-operational-retention-pruners.md), which creates the shared prune helper; that spec is not yet approved, and this one states exactly what it needs from the helper. **Overlaps** PR #8472, recorded by the original review as bounding pending access-log writes. Recheck its disposition before implementation; this revision makes no claim about its current review/QA state.
> **Code baseline checked for this revision:** read-only snapshot `9e09023483`; specifications only, no runtime tests run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-11-16-operational-retention-pruners.md

## 📝 TLDR

Every list request writes one access-log row per record it returned, saying who read which record. Those rows are deleted by two unbounded `DELETE` statements that run inside the write path, at most once a minute per process, across all tenants. The windows — seven days for users and roles, eight hours for everything else — can be changed but not switched off, and "everything else" cannot be told apart. **Proposed (future):** deletion moves to a scheduled job that deletes in batches until it has caught up; the inline path stays as a safety net when a bounded table probe shows the job has fallen behind; the list of longer-kept record kinds becomes a setting; `0` means keep. Defaults do not change.

**Not in this spec:** the action log, which records changes and needs a spec of its own; what the access log records; the cap on pending writes (PR #8472); the query-engine export's first-page-only per-record trace. [`2026-11-16-export-audit-event.md`](2026-11-16-export-audit-event.md), assumption 2, deliberately leaves that trace unchanged and adds one summary entry/event for the full export; the enterprise security-alerting spec consumes that event rather than claiming per-record access-log coverage of every page.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Change the default windows | No | ⚠ NEEDS HUMAN CONFIRMATION. Eight hours is too short to answer "what did this account read last week" after a breach. But the table gets a row per record per list request, so a longer default multiplies its size on every installation. An operator who wants a longer trail sets it. |
| 2 | Where deletion runs | A scheduled job. Inline only when a bounded probe finds a row older than its window plus an hour; an indeterminate probe defers to the job | Deleting inside a request is the wrong place, but an installation whose scheduler is absent, disabled or has no worker must not grow without bound. Table evidence avoids assuming that registration means a live worker. A bounded request probe cannot always prove that no eligible row exists; that limit is explicit below. |
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
- **PR #8472**, according to the original review, proposes single-flight inline rotation and bounded pending writes. This revision did not fetch that diff; recheck its final code before implementation. The checked snapshot still has the two deletes described above.
- **A subject's rows.** With encryption on, the resource id is ciphertext, so rows *about* a person cannot be found; rows *by* a staff user can, through the acting-user column. Both are gone within the window.

## 📝 Proposed Solution

| Aspect | Today | Proposed |
|---|---|---|
| Where deletion runs | Inline after a write | A job on a system-scoped cron schedule, every fifteen minutes |
| How it deletes | Two unbounded statements | Batches of a fixed size, repeated until a batch comes back short or a time budget is spent; if rows remain, the job enqueues itself again at once |
| Safety net | — | After a write, at most once per interval, inspect at most 1,000 oldest rows beyond each nonzero window plus an hour using the created-time index. Select only id, kind and timestamp; test the kind condition after the bounded subquery. Found evidence starts a bounded delete; otherwise return none or indeterminate, never scan the whole backlog |
| Long-window kinds | Hard-coded | `AUDIT_LOGS_CORE_RESOURCE_KINDS`, a comma-separated list, default `auth.user,auth.role` |
| `0` | Falls back to the default | Keeps those rows indefinitely: the delete for that window is skipped, and the other still runs |
| When settings are read | Module load | Each run |
| Failure | A warning | Reported through the logger and the error reporter |

**Bound the request probe and its deletes.** Add `(created_at, id)` and `(resource_kind, created_at, id)` indexes, retaining existing ones. A listed-kind probe can seek each configured kind directly. The ordinary probe reads `ORDER BY created_at, id LIMIT 1000` inside a subquery with only the age condition, then applies `resource_kind NOT IN (...)` to those ids. The planner must not push the kind predicate inside that bounded selection. If all 1,000 are listed kinds, return `indeterminate`, not “none eligible”; do no ordinary deletion on that request. The scheduled job owns full-backlog traversal. This applies even when the long window is zero and listed-kind rows accumulate indefinitely. Tests inspect SQL structure and EXPLAIN/actual rows read against a large fixture backlog.

When evidence exists, inline deletion uses only the bounded probe's eligible ids and repeats the exact kind/cutoff condition in its delete. It never calls an unbounded `NOT IN` candidate scan. It can process another bounded probe within its short time budget, then stops; the request never inherits a full-backlog scan. A statement timeout covers each request probe/delete. The short path uses a module-local bounded-id adapter to the shared `pruneBatches`, whose parameterized condition restricts it to those ids. Both zero windows skip all probes and deletes. An indeterminate request probe logs a throttled warning directing the operator to check the scheduled worker; it is not evidence that retention is healthy.

**Performance limit.** Negative kind predicates cannot use the proposed kind index to prove absence cheaply; that index accelerates positive listed-kind probes only. The time index plus the inner 1,000-row limit bounds the ordinary probe. A database integration regression fixture with 20,000 old listed-kind rows, long window zero and a younger ordinary row verifies at most 1,000 candidate rows per probe, no full scan on the request, no listed-kind deletion, and eventual ordinary deletion by the scheduled worker.

**Why no fixed cap.** One row is written per record per list request. A run that stops after a fixed number of batches has a ceiling, and above that write rate the table would grow forever with everything healthy. The job therefore runs until it has caught up, bounded by time, not by count.

**The two deletes.** Their conditions are disjoint, as today (`accessLogService.ts:403-412`), so each row is judged only by its own kind's window. First, rows whose kind is on the list and that are older than the long window. Second, rows whose kind is not on the list and that are older than the short window. A delete whose window is `0` is skipped; the first is also skipped when the list is empty, and every row then has the short window. A module-local adapter reads bounded ordered candidate pages, advances on the last inspected row even when none match, and passes only matching ids to `pruneBatches`. The scheduled scans walk forward by `(created_at, id)`, including past non-matching inspected rows, within each run and carry that cursor through coalesced continuations. Request-path deletes use only the bounded probe ids. A new cron pass starts at the beginning for newly eligible/backdated rows. Neither delete drops the kind condition: a pure range on `created_at` would delete an ordinary row at the long window when the ordinary window is `0` or longer than the long one.

**What this needs from the shared helper.** One function that, given an entity manager, a table, a condition with its parameters, a cutoff, a batch size and a time budget, deletes in batches and returns how many it deleted and whether more remain. It must accept a cutoff computed from hours or fractions of a day, must not consult the helper's counting mode, and must be callable from a request with nothing but an entity manager. The pruner spec's Phase 1 owns the `pruneBatches` export with this contract; this spec consumes it and does not define a competing helper. The scheduled handler adds its kind-specific cursor and coalesced continuation around that loop.

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
- THEN no ordinary row is deleted, however old, and rows for the listed kinds are still deleted after the long window

##### Scenario: Zero for the listed kinds
- WHEN the long window is `0`
- THEN no row for a listed kind is deleted, and ordinary rows are still deleted after the ordinary window

##### Scenario: An ordinary window longer than the long window
- WHEN the ordinary window is ten days and the long window seven
- THEN an ordinary row nine days old remains, and a user row eight days old is gone

##### Scenario: A kind added to the list
- WHEN a resource kind is added to the long-window list
- THEN its rows are kept for the long window from then on

##### Scenario: The job is not running
- WHEN no job has run and a row is more than an hour past its window
- THEN a later write deletes it, in batches

##### Scenario: The job is keeping up
- WHEN no row is more than an hour past its window
- THEN a write deletes nothing

##### Scenario: The safety net and `0`
- WHEN the ordinary window is `0` and an ordinary row is a year old
- THEN the safety net finds nothing past its window and a write deletes nothing

##### Scenario: Backlog
- WHEN more rows are eligible than one run can delete within its time budget
- THEN the job runs again at once with a coalesced continuation and continues

##### Scenario: A large listed-kind backlog
- WHEN the long window is zero and more than 1,000 listed-kind rows precede an eligible ordinary row
- THEN the request probe is bounded and reports indeterminate without an ordinary delete; the scheduled job still deletes the ordinary row and keeps every listed-kind row

##### Scenario: Disabled retention diagnostic
- WHEN either effective window is zero
- THEN configuration-only doctor reports `audit_logs.access_retention_disabled` at warning with the affected kinds/window and indefinite-growth consequence

Frozen by: `packages/core/src/modules/audit_logs/services/__tests__/accessLogService.rotation.test.ts` (existing; extended)

## 📝 Architecture

- **`audit_logs/workers/`**: a prune handler on a queue of its own at concurrency 1.
- **`audit_logs/setup.ts`**: registers the schedule through a function that the module's upgrade action also calls; guarded by `hasRegistration('schedulerService')`. Declare `retentionSchedules: [{ key: 'audit_logs.access-log-prune', queue: 'audit-logs-access-log-prune', scopeType: 'system' }]` beside the audit module's existing default-export members. Both registration and the parent spec's “Enabled-handler schedule expectations” use that exact key's SHA-256-derived UUID, with null tenant/organization. This also supplies scheduler's `pruners.unscheduled`; a disabled retention window does not pretend that a missing schedule is present, and an enabled schedule does not prove a live worker.
- **`audit_logs/services/accessLogService.ts`**: the inline rotation becomes the safety net. It needs only the entity manager it already has; it does not look at the scheduler. The bounded probe returns found, none or indeterminate; full backlog traversal stays with the worker.
- **Settings:** `packages/shared/src/lib/retention/accessLogWindows.ts` owns the single side-effect-free effective parser for both windows, the configured kind list and the probe interval, read on each run. The additive `getAccessLogRetentionWindows()` accessor projects the process-window rows below from that parser. Both the scheduled handler and inline safety net use that accessor for their durations/disabled state and the same parser for kind membership and interval; no copied module-load constants remain. The register collector and doctor use the same shared source. Fractional windows remain valid; the operational pruners' integer parser is not substituted for this parser.
- **Doctor:** `audit_logs/privacy.ts.doctorChecks` declares `audit_logs.access_retention_disabled`, environment-only, using `getAccessLogRetentionWindows()` and the same effective kind-list parser as the deleting owner. Either window at zero warns that its affected kinds are kept indefinitely, naming both windows/kind list and the scheduled-worker requirement if bounded probes are indeterminate. Registration depends on R3-2 — The registry carries the whole `privacy.ts` default export, contract Phase 1, and DEC-I — The doctor's extension point, doctor Phase 3; it ships with the new zero semantics, not as an unowned follow-up. Preserve existing data classes and other owners' optional members in this module's default export. No database connection is opened by this declaration.

### Shared process-window accessor

`getAccessLogRetentionWindows(): Array<{ id: string; value: number | null; unit: 'hours' | 'days'; enabled: boolean; source: 'this_process' }>` uses exactly the result shape in `2026-11-16-privacy-ropa-generator.md`, Architecture. Return two rows, sorted by stable id: `audit_logs.core` with the effective `AUDIT_LOGS_CORE_RETENTION_DAYS` in days, and `audit_logs.non_core` with the effective `AUDIT_LOGS_NON_CORE_RETENTION_HOURS` in hours. These ids mean the configured listed kinds and their complement, not two overlapping table rules. Unset gives 7 days and 8 hours; invalid/non-finite/negative values use those same owner defaults; a finite positive fractional value is preserved. Explicit zero is returned as `value: 0, enabled: false`, meaning keep indefinitely. An empty listed-kind configuration also makes the core row disabled, retaining its parsed value, and applies the non-core rule to all kinds. No null value is needed because both settings have finite defaults. `source` is always `this_process`.

The accessor opens no container/database and makes no writes or import-time log calls. It reports effective age rules, never claims a schedule or worker is live. The register consumes it without copying settings/defaults; the configuration-only doctor uses the same result, including disabled/keep semantics. The worker and safety net derive disjoint predicates using the same kind configuration and skip disabled rows. Reporting an empty listed-kind group must not claim that any records are thereby kept indefinitely; only a zero window with an affected kind group creates that consequence.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Module → scheduler | `schedulerService` by DI key, in `setup.ts` only | Safety net deletes when its bounded probe finds evidence; indeterminate requires restoring the worker |
| Module → shared helper | Import from `@open-mercato/shared` | — |

## 📝 Data Models

Add concurrent non-transactional index migrations and snapshot updates for `(created_at, id)` and `(resource_kind, created_at, id)`. Preserve the existing indexes. The time/id index supports bounded ordered probes; the kind/time/id index supports positive listed-kind seeks, not an unbounded negative-kind request scan. No entity columns change.

## 📝 API Contracts

- **Settings.** `AUDIT_LOGS_CORE_RETENTION_DAYS` and `AUDIT_LOGS_NON_CORE_RETENTION_HOURS` keep their names and defaults; `0` now means keep. `AUDIT_LOGS_CORE_RESOURCE_KINDS` is new. `AUDIT_LOGS_ROTATE_INTERVAL_MS` now paces the safety net's check. Both `.env.example` files are updated.
- **Schedule** named `audit_logs.access-log-prune`, with the UUID derived from that exact key as its id, targeting dedicated queue `audit-logs-access-log-prune`. **Upgrade action** of the same name, with its locale keys and version. Upgrade actions are offered per organization; the registration is idempotent, so running it in several changes nothing. An installation that never runs it uses the bounded safety net; an indeterminate probe warns that the scheduled worker must be restored.
- **Doctor check id:** `audit_logs.access_retention_disabled`, configuration-only and warning for either zero window; informational otherwise.
- **Shared accessor:** `getAccessLogRetentionWindows()` has the exact register process-window result and stable group ids in Architecture; a new additive export from `@open-mercato/shared/lib/retention/accessLogWindows`.
- No route changes. The internal bounded-probe result is tri-state; existing public service signatures remain compatible.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Scheduler absent, disabled, or with no worker | Safety net deletes rows it can find within its bounded probe, at least an hour later; an indeterminate probe warns and requires restoration of the worker |
| An existing installation that has not run the upgrade action | The same |
| A value that is not a non-negative number | The default is used and the fact is reported once |
| Both windows `0` | Nothing is probed or deleted; daily warning and doctor warning say the table grows with every list request |
| Long window `0`, large listed-kind backlog | Ordinary request probe reads at most 1,000 candidates and can return indeterminate; scheduled traversal removes eligible ordinary rows without deleting listed kinds |
| One window `0` | That delete and its part of the safety net's check are skipped; the other runs as usual |
| The ordinary window longer than the long window | Each kind keeps its own window; an ordinary row outlives a listed one of the same age |
| An empty list of long-window kinds | The first delete is skipped and every row has the ordinary window |
| A long outage | The job re-enqueues itself until it has caught up; meanwhile the safety net also deletes |
| The job and the safety net run at once | Both delete by id in batches; a row deleted by one is simply absent for the other |
| Writes outpace one run's time budget | The job runs back to back. If three consecutive runs end on the budget, that is reported as a warning |

## 📝 Migration & Backward Compatibility

| Change | Class |
|---|---|
| Deletion moves to a schedule | Internal; same rows, same windows: the two deletes keep today's disjoint conditions, so no row is deleted earlier than today |
| `0` means keep | Behaviour change for an installation that had set `0`: it used to get the default. Dated entry and an upgrade note |
| New setting, schedule, upgrade action, queue, indexes, doctor check | Additive |

`UPGRADE_NOTES.md`: run the module's upgrade action; what zero now means; how to keep a longer trail and what it costs in rows; `privacy doctor` warns about indefinite keeping; bounded/indeterminate request probes do not replace a live worker for large mixed-kind backlogs. No claim is made that inline fallback can always keep up without the scheduler.

## 📋 Implementation Plan

1. Extend the existing rotation test to pin today's behaviour: the two windows, the fallback on `0`, the kinds. Commit alone.
2. Rebase on #8472 if it has merged. Add the shared parser and `getAccessLogRetentionWindows()` accessor, and adopt them in the scheduled owner, inline safety net, doctor and register without duplicate defaults. `accessLogWindows.test.ts` pins the exact process-window result shape/group ids, units, 7-day/8-hour defaults, invalid/non-finite/negative fallback, fractional values, either/both zero, empty kinds and a changed environment on a later invocation. Owner rotation/handler tests compare actual cutoff and keep predicates with these same accessor results; doctor/register consumer tests exercise parity, including the empty-kind distinction.
3. Replace the two deletes with the batched function, with the disjoint conditions and the forward walk described. Unit tests with an injected clock: each window, a fractional window, a backlog across two runs, the time budget; the ordinary window `0`, the long window `0`, an ordinary window longer than the long one, and an empty kind list, each asserting which rows remain.
4. Add concurrent index migrations and snapshot, then turn inline rotation into the bounded tri-state safety net and bounded-id deletes with a statement timeout. `accessLogService.rotation.test.ts` checks the inner limit before the negative kind filter, all-zero no queries and indeterminate handling; a real-database large listed-kind fixture verifies the query plan and bounded work. A unit test that a year-old ordinary row with the ordinary window at `0` triggers no delete. Update the rotation test and, if #8472 has merged, its `TC-AUD-016`, whose expired row must be more than an hour past its window to still be deleted inline.
5. Add the queue at concurrency 1, handler with coalesced re-enqueue and cursor preservation, registration and upgrade action, consuming the same `retentionSchedules` constant as the scheduler expectation collector; test exact id parity and disabled-row preservation. Recheck the parent's deployment connection budget. Add the disabled-retention doctor check after contract Phase 1 and doctor Phase 3, tested for each zero window and both disabled.
6. Integration test; both `.env.example` files; `UPGRADE_NOTES.md`; the dated compatibility entry; the audit-logs docs page.
7. Archive the Delta if the capabilities directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/audit_logs/{services/accessLogService.ts,workers/*,setup.ts,privacy.ts,migrations/*,i18n/*}` and snapshot | Modify / create |
| `packages/shared/src/lib/retention/accessLogWindows.ts` and `__tests__/accessLogWindows.test.ts` | Create — parser and accessor shared by deleting owner, doctor and register |
| `packages/core/src/modules/configs/lib/upgrade-actions.ts` | Modify |
| `packages/core/src/modules/audit_logs/services/__tests__/accessLogService.rotation.test.ts`, and `TC-AUD-016` if present | Modify |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUDIT-ACCESS-RETENTION-00{1,2}.spec.ts` | Create |
| `apps/mercato/.env.example`, the template copy, `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, `apps/docs/docs/user-guide/audit-logs.mdx` | Modify |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-AUDIT-ACCESS-RETENTION-001 | Rows are inserted directly with backdated times chosen so that only the job can delete them: an ordinary one eight and a half hours old and a user one seven days and thirty minutes old — past their windows, inside the safety net's extra hour — plus a user row a day old and a fresh ordinary one. The scheduler's API shows the schedule. The job is enqueued and drained through the integration queue helper. `GET /api/audit_logs/audit-logs/access` then returns the day-old user row and the fresh row and neither of the other two. The test removes what it inserted |
| TC-AUDIT-ACCESS-RETENTION-002 | In-process real-database service/handler with injected clock/settings: insert own 20,000 old listed-kind rows with long window zero plus a newer expired ordinary row. Capture EXPLAIN ANALYZE for the bounded ordinary probe; at most 1,000 candidates read before kind filtering, indeterminate returned, request performs no unbounded delete, listed rows survive, worker traverses and deletes ordinary row. Also cover zero on either side, longer ordinary window, empty kinds and repeat idempotency; assert the shared accessor reports the same effective windows/disabled groups used by both delete paths, register and configuration-only doctor |

Both tests create their own tenants, organizations and rows, use an isolated test database or fixture-only handler adapter, and clean rows/schedules/configuration/jobs in `finally`. The database performance test asserts bounded rows read and SQL shape, not wall-clock speed on shared CI hardware. Settings are injected in process, so they do not depend on the running app's environment.

## 📝 Risks & Impact Review

#### The table grows without bound
- **Scenario**: The job is not running, or cannot keep up with the write rate.
- **Severity**: High
- **Affected area**: database size; every list request adds rows
- **Mitigation**: The safety net uses bounded table evidence; the job runs until caught up with coalesced continuations; repeated exhaustion or indeterminate probes warn; doctor warns for indefinite windows.
- **Residual risk**: A write rate above back-to-back deletion capacity, or a stopped worker while bounded negative-kind probes are indeterminate. The latter requires restoring the scheduled worker; inline fallback cannot guarantee cleanup through an arbitrarily large listed-kind backlog.

#### A delete removes rows the operator chose to keep
- **Scenario**: A delete that ignores the kind, or a window set to `0`, removes ordinary rows at the long window while an operator keeps them for an investigation.
- **Severity**: High
- **Affected area**: access-log rows kept on purpose; the trail an investigation relies on
- **Mitigation**: The two deletes keep today's disjoint conditions; each is skipped when its window is `0`; the safety net checks under the same conditions; unit tests pin `0` on either side, an ordinary window longer than the long one and an empty kind list.
- **Residual risk**: None beyond a gap in those tests.

#### The shared helper is not there
- **Scenario**: The pruner spec is not approved, or its helper differs.
- **Severity**: Medium
- **Affected area**: this change's schedule
- **Mitigation**: The parent Phase 1 owns the exact `pruneBatches` export; sequence this change after it and the diagnostic dependencies.
- **Residual risk**: Approval or delivery delays in those prerequisites; no parallel definition of the helper.

#### An installation that set `0` stops deleting
- **Scenario**: Someone set a window to `0` expecting the default, which is what it did.
- **Severity**: Medium
- **Affected area**: that installation's table size
- **Mitigation**: The upgrade note and the dated entry; the run reports "keeping indefinitely" at warning level each day and `audit_logs.access_retention_disabled` warns in configuration-only doctor.
- **Residual risk**: An unread note.

#### Conflict with #8472
- **Scenario**: The recorded PR overlap still exists when implementation starts.
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
| Behaviour preserved | Compliant | Disjoint conditions per kind, as today; `0` skips only its own delete |
| Integration coverage | Compliant design | Default path plus injected settings/large-backlog real-database integration; owned fixtures and cleanup |
| Request-path cost | Compliant design | Bounded inner candidate probe and id-limited deletes; indeterminate is explicit, not reported as no eligible rows |

**Verdict:** approved for implementation after #8472 is resolved and the pruner spec's first phase is approved or folded in, subject to assumption 1.

## Changelog

### 2026-11-16
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): align the existing access-log schedule expectation to the doctor's exact pruners.unscheduled diagnostic id.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): use the current doctor-owned pruners.unscheduled diagnostic for the existing access-log schedule expectation.
- Council round two fixes, pass three (GPT-6.1 Sol workers): verified shared process-window shape, fractional/zero/empty-kind semantics and owner/register/doctor parser parity; declare the exact system schedule key and dedicated queue through the parent's expectation manifest.
- Council round two fixes, pass two (GPT-6.1 Sol workers): shared `getAccessLogRetentionWindows()` parser/accessor with the register's exact process-window shape, effective zero/empty-kind/fractional semantics, owner/doctor/register call sites, manifest and parity coverage; exact R3-2 and DEC-I citations.
- Council round two fixes (GPT-6.1 Sol workers): r8-23 bounded tri-state request probes, matching indexes, id-limited deletes and large-backlog integration evidence; F-55 configuration-only doctor warning for indefinite windows; helper ownership and residual scheduler dependence stated.
- Written autonomously with resolved assumptions.
- Revised after independent review. A fixed cap per run could lose to the write rate, so the job now runs until caught up within a time budget and re-enqueues itself. The inline path is kept as a safety net triggered by the table's own state, because "a schedule exists" is also true when it is disabled or has no worker. The needs from the shared helper are written out. The schedule id is a derived UUID. The existing rotation test is extended instead of a new characterization file, and the integration test uses rows only the job can delete.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g5-02 — the first delete no longer ignores kind; both deletes keep today's disjoint conditions, each is skipped when its window is `0`, the safety net checks under the same conditions, and scenarios, edge cases, unit tests, a risk and a compliance row cover `0` on either side, an ordinary window longer than the long one and an empty kind list.
