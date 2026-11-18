# Access-log retention

> **Program:** package D4 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** Phase 1 of [`2026-11-16-operational-retention-pruners.md`](2026-11-16-operational-retention-pruners.md), which creates the shared prune helper; that spec's OSS placement is settled (DEC-2), this one waits only for that phase to land or be folded in, and it states exactly what it needs from the helper. **Overlaps** PR #8472, recorded by the original review as bounding pending access-log writes. Recheck its disposition before implementation; this revision makes no claim about its current review/QA state.
> **Code baseline checked for this revision:** read-only snapshot `9e09023483`; specifications only, no runtime tests run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/GDPR/2026-11-16-operational-retention-pruners.md

## 📝 TLDR

Every list request writes one access-log row per record it returned, saying who read which record. Those rows are deleted by two unbounded `DELETE` statements that run inside the write path, at most once a minute per process, across all tenants. The windows — seven days for users and roles, eight hours for everything else — can be changed but not switched off, and "everything else" cannot be told apart. **Proposed (future):** deletion moves to a scheduled job that deletes in batches until it has caught up; the inline path stays as a safety net when a bounded table probe, walking forward with a per-process cursor, shows the job has fallen behind; the list of longer-kept record kinds becomes a setting; the explicit value `keep` keeps a group's rows, while `0` keeps today's meaning (the default). Defaults do not change. The audit module publishes the table's retention bound for coverage verification.

## 📝 Overview

> **Market reference.** PostgreSQL's own `log_rotation_age`, Elasticsearch index lifecycle policies and Matomo's raw-log deletion all expire access/read logs by age on a background schedule rather than in the request path, and treat "keep forever" as an explicit choice. Adopted: background, batched deletion with documented defaults and an explicit keep value. Rejected: request-path table-wide deletes, and silently reinterpreting an existing configuration value.

**Scope and ownership.** This spec owns the `access_logs` deletion schedule, its inline safety net, the shared window accessor and the table's `operational_pruner` retention bound. The operational-pruners spec owns the shared `pruneBatches` helper and the schedule-expectation and bound collectors it plugs into; the action log and its history retention are owned elsewhere (see "Not in this spec").

**Not in this spec:** the action log, which records changes and needs a spec of its own; what the access log records; the cap on pending writes (PR #8472); the query-engine export's first-page-only per-record trace. [`2026-11-16-export-audit-event.md`](2026-11-16-export-audit-event.md), assumption 2, deliberately leaves that trace unchanged and adds one summary entry/event for the full export; the enterprise security-alerting spec consumes that event rather than claiming per-record access-log coverage of every page.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Change the default windows | No. Seven days for the listed kinds and eight hours for the rest stay the defaults, as the program's D4 states | The table gets a row per record per list request, so a longer default multiplies its size on every installation and keeps more about who read which record; storage limitation favours the short default. The accepted cost: on defaults, reads of ordinary records more than eight hours old cannot be reconstructed after a breach. An operator who needs a longer trail lengthens a window, adds kinds to `AUDIT_LOGS_CORE_RESOURCE_KINDS`, or sets `keep` while an investigation runs; the upgrade note and the audit-logs docs page say how, and what it costs in rows. |
| 2 | Where deletion runs | A scheduled job. Inline only when a bounded probe finds a row older than its window plus an hour; an indeterminate probe advances a per-process cursor, so later probes move past the rows it could not use | Deleting inside a request is the wrong place, but an installation whose scheduler is absent, disabled or has no worker must not grow without bound. Table evidence avoids assuming that registration means a live worker. A single bounded probe cannot always prove that no eligible row exists; successive bounded sweeps revisit timestamps behind the forward cursor and give late-visible rows another opportunity for deletion. |
| 3 | Counting period before the first delete | None | These rows are already deleted today on the same windows. |
| 4 | Which kinds get the long window | A setting, defaulting to today's two | The split is hard-coded to `auth.user` and `auth.role`. |
| 5 | Per-tenant windows | Not here | The enterprise policy engine owns per-tenant retention. |
| 6 | The unused `deleted_at` column | Left alone | It is filtered on read and never set; removing a column is a contract change with no benefit. |
| 7 | How an operator keeps rows indefinitely | The explicit value `keep` (trimmed, case-insensitive) on either window variable. `0` keeps its current meaning, the default, and is reported once as such | Today `0` falls back to the default (`accessLogService.ts:19-23`); turning it into "keep forever" would silently stop deleting who-read-which-record data on installations that set it. The operational-pruners spec leaves the existing AI-usage variable's zero unchanged for the same reason. A distinct token makes the keep choice explicit and needs no bridge. |

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
| Safety net | — | After a write, at most once per interval, inspect at most 1,000 rows per page beyond each enabled window plus an hour using the created-time index, starting after a per-process forward cursor. Select only id, kind and timestamp; test the kind condition after the bounded subquery. Found evidence starts a bounded delete; otherwise advance the cursor and return none or indeterminate, never scan the whole backlog |
| Long-window kinds | Hard-coded | `AUDIT_LOGS_CORE_RESOURCE_KINDS`, a comma-separated list, default `auth.user,auth.role` |
| `keep` | Not accepted (falls back to the default) | Keeps those rows indefinitely: the delete for that window is skipped, and the other still runs |
| `0` | Falls back to the default | Unchanged: falls back to the default, reported once with a pointer to `keep` |
| When settings are read | Module load | Each run |
| Failure | A warning | Reported through the logger and the error reporter |

**Bound the request probe and its deletes.** Add `(created_at, id)` and `(resource_kind, created_at, id)` indexes, retaining existing ones. A listed-kind probe can seek each configured kind directly. The ordinary probe reads `ORDER BY created_at, id LIMIT 1000` inside a subquery with only the age condition and `(created_at, id) > cursor`, then applies `resource_kind NOT IN (...)` to those ids. The planner must not push the kind predicate inside that bounded selection. If all 1,000 are listed kinds, return `indeterminate`, not “none eligible”, and do no ordinary deletion on that page; the scheduled job still owns full-backlog traversal.

**The safety net's forward cursor.** Each process keeps an in-memory ordinary sweep state containing a fixed cutoff and the last examined `(created_at, id)`. Start a sweep at the beginning with the current window plus the extra hour. Every page advances to its last inspected row, including an all-listed page. A short page or empty page completes that sweep at its fixed cutoff. The next paced probe starts a new sweep at the beginning with a fresh cutoff, at most once per rotate interval. Do not wrap again in the same request. Reset on process start, a change in the effective configurations, or a failed deletion. Listed-kind probes seek by kind and need no cursor.

A delayed commit, imported row or writer with clock skew can become visible behind the cursor. It is eligible for the next sweep that starts after its commit if already past the window plus an hour. Freezing the cutoff keeps new timestamps from indefinitely moving a sweep's upper bound forward. A completed sweep says only that the bounded walk reached its cutoff. It cannot certify table-wide absence of late-visible rows. Progress depends on successful paced probes, enough capacity to finish each sweep, and bounded work per request even when a listed-kind band must be crossed again. Very large eligible bands, concurrent backdated inserts, no writes or sustained failures can delay expiry. The worker remains the normal retention path.

When evidence exists, inline deletion uses only the bounded probe's eligible ids and repeats the exact kind/cutoff condition in its delete. It never calls an unbounded `NOT IN` candidate scan. It can process another bounded page within its short time budget, then stops; the request never inherits a full-backlog scan. A statement timeout covers each request probe/delete. The short path uses a module-local bounded-id adapter to the shared `pruneBatches`, whose parameterized condition restricts it to those ids. When both windows are `keep`, all probes and deletes are skipped. An indeterminate request probe logs a throttled warning directing the operator to check the scheduled worker; it is not evidence that retention is healthy.

**Performance limit.** Negative kind predicates cannot use the proposed kind index to prove absence cheaply; that index accelerates positive listed-kind probes only. The time index, the cursor and the inner 1,000-row limit bound the ordinary probe. Two database integration regression fixtures verify it: 20,000 old listed-kind rows with the long window `keep` and a younger expired ordinary row; and, under the default windows, 20,000 `auth.user` rows aged between nine hours and seven days preceding an expired ordinary row. Each verifies at most 1,000 candidate rows per page, no full scan on the request, no listed-kind deletion inside its window, a cursor that advances across probes, and deletion of the ordinary row by the safety net within 21 pages with no scheduled job — and by the scheduled worker when it runs.

**Why no fixed cap.** One row is written per record per list request. A run that stops after a fixed number of batches has a ceiling, and above that write rate the table would grow forever with everything healthy. The job therefore runs until it has caught up, bounded by time, not by count.

**The two deletes.** Their conditions are disjoint, as today (`accessLogService.ts:403-412`), so each row is judged only by its own kind's window. First, rows whose kind is on the list and that are older than the long window. Second, rows whose kind is not on the list and that are older than the short window. A delete whose window is `keep` is skipped; the first is also skipped when the list is empty, and every row then has the short window. A module-local adapter reads bounded ordered candidate pages, advances on the last inspected row even when none match, and passes only matching ids to `pruneBatches`. The scheduled scans walk forward by `(created_at, id)`, including past non-matching inspected rows, within each run and carry that cursor through coalesced continuations. Request-path deletes use only the bounded probe ids and the safety net's own per-process cursor. A new cron pass starts at the beginning for newly eligible/backdated rows. Neither delete drops the kind condition: a pure range on `created_at` would delete an ordinary row at the long window when the ordinary window is `keep` or longer than the long one.

**What this needs from the shared helper.** One function that, given an entity manager, a table, a condition with its parameters, a cutoff, a batch size and a time budget, deletes in batches and returns how many it deleted and whether more remain. It must accept a cutoff computed from hours or fractions of a day, must not consult the helper's counting mode, and must be callable from a request with nothing but an entity manager. The pruner spec's Phase 1 owns the `pruneBatches` export with this contract; this spec consumes it and does not define a competing helper. The scheduled handler adds its kind-specific cursor and coalesced continuation around that loop.

The eight-hour window stays in hours, and fractional values stay valid.

| Alternative | Why rejected |
|---|---|
| Lengthen the defaults | See assumption 1. |
| Remove the inline path | An installation with no working scheduler would never delete. |
| Keep the inline path while "no schedule exists" | A schedule exists on every new installation, including ones where it is disabled or no worker runs. |
| Re-read the oldest 1,000 rows on every probe | Under the default windows the in-window listed-kind band fills every page, so an installation without a running job would keep ordinary rows for up to seven days. The forward cursor preserves progress across pages within a sweep. Each completed sweep can revisit the band. |
| `0` means keep | Silently changes the meaning of an existing configuration value; see assumption 7. |
| A fixed number of batches per run | See above. |
| One window for everything | Loses the longer trail for the two kinds that matter most for account investigations. |

## 📝 Delta

### Capability: operational-retention

#### MODIFIED Requirement: Access-log deletion
The system SHALL delete access-log rows older than their window in batches on a schedule, SHALL keep them indefinitely when the window is set to `keep`, SHALL keep treating `0` as the default, and SHALL delete after a write only when a row is more than an hour past its window.

##### Scenario: Scheduled run
- WHEN the job runs with default settings
- THEN rows for ordinary kinds older than eight hours and rows for the listed kinds older than seven days are gone, and newer rows remain

##### Scenario: Keep
- WHEN the ordinary window is `keep`
- THEN no ordinary row is deleted, however old, and rows for the listed kinds are still deleted after the long window

##### Scenario: Keep for the listed kinds
- WHEN the long window is `keep`
- THEN no row for a listed kind is deleted, and ordinary rows are still deleted after the ordinary window

##### Scenario: Zero keeps today's meaning
- WHEN an existing installation has the ordinary window set to `0`
- THEN ordinary rows are still deleted after the default eight hours, and the run reports once that `0` uses the default and `keep` keeps rows

##### Scenario: An ordinary window longer than the long window
- WHEN the ordinary window is ten days and the long window seven
- THEN an ordinary row nine days old remains, and a user row eight days old is gone

##### Scenario: A kind added to the list
- WHEN a resource kind is added to the long-window list
- THEN its rows are kept for the long window from then on

##### Scenario: The job is not running
- WHEN no job has run and a row is more than an hour past its window
- THEN later writes delete it, in batches, once the safety net's per-process cursor reaches it

##### Scenario: Default windows with no job
- WHEN the windows are the defaults, no job runs, and more than 1,000 `auth.user` rows between nine hours and seven days old precede an ordinary row more than an hour past its window
- THEN the first probes report indeterminate while the cursor advances past the user rows, a later probe deletes the ordinary row, and no user row inside its window is deleted

##### Scenario: An expired row commits behind the ordinary cursor
- WHEN the scheduler is off, the safety net advances past a timestamp, and another connection commits an already expired ordinary row behind that cursor
- THEN the current sweep can miss it, but a later bounded sweep starts at the beginning and deletes it without deleting a listed-kind control inside its window

##### Scenario: The job is keeping up
- WHEN no row is more than an hour past its window
- THEN a write deletes nothing

##### Scenario: The safety net and `keep`
- WHEN the ordinary window is `keep` and an ordinary row is a year old
- THEN the safety net finds nothing past its window and a write deletes nothing

##### Scenario: Backlog
- WHEN more rows are eligible than one run can delete within its time budget
- THEN the job runs again at once with a coalesced continuation and continues

##### Scenario: A large listed-kind backlog
- WHEN the long window is `keep` and more than 1,000 listed-kind rows precede an eligible ordinary row
- THEN each request probe is bounded and reports indeterminate without an ordinary delete until its cursor passes the listed rows; a later probe or the scheduled job deletes the ordinary row, and every listed-kind row is kept

##### Scenario: Disabled retention diagnostic
- WHEN either effective window is `keep`
- THEN configuration-only doctor reports `audit_logs.access_retention_disabled` at warning with the affected kinds/window and indefinite-growth consequence; a window set to `0` is reported as informational, naming the default it uses and the `keep` value

##### Scenario: Retention bound for coverage
- WHEN C5/G6 resolve `{ kind: 'operational_pruner', prunerId: 'audit_logs.access_logs' }` and evaluate a captured row
- THEN the audit owner's handler returns the projection and per-row state from the same windows and kind list as deletion, and a `keep` group, a missing schedule or a null-tenant row never yields a finite-deadline allowance

Frozen by: `packages/core/src/modules/audit_logs/services/__tests__/accessLogService.rotation.test.ts` (existing; extended)

## 📝 Architecture

- **`audit_logs/workers/`**: a prune handler on a queue of its own at concurrency 1.
- **`audit_logs/setup.ts`**: registers the schedule through a function that the module's upgrade action also calls; guarded by `hasRegistration('schedulerService')`. Declare `retentionSchedules: [{ key: 'audit_logs:access-log-prune:system', queue: 'audit-logs-access-log-prune', scopeType: 'system' }]` beside the audit module's existing default-export members, in the `<module>:<name>:system` form every sibling carrier uses. Both registration and the parent spec's “Enabled-handler schedule expectations” use that exact key's SHA-256-derived UUID, with null tenant/organization. This also supplies scheduler's `pruners.unscheduled`; a disabled retention window does not pretend that a missing schedule is present, and an enabled schedule does not prove a live worker.
- **`audit_logs/services/accessLogService.ts`**: the inline rotation becomes the safety net. It needs only the entity manager it already has; it does not look at the scheduler. The bounded probe returns found, none or indeterminate and advances the per-process forward cursor within a fixed-cutoff sweep. Repeated paced sweeps cover late-visible rows; full backlog traversal in one pass stays with the worker.
- **Settings:** `packages/shared/src/lib/retention/accessLogWindows.ts` owns the single side-effect-free effective parser for both windows, the configured kind list and the probe interval, read on each run. The additive `getAccessLogRetentionWindows()` accessor projects the process-window rows below from that parser. Both the scheduled handler and inline safety net use that accessor for their durations/disabled state and the same parser for kind membership and interval; no copied module-load constants remain. The register collector and doctor use the same shared source. Fractional windows remain valid; the operational pruners' integer parser is not substituted for this parser.
- **Doctor:** `audit_logs/privacy.ts.doctorChecks` declares `audit_logs.access_retention_disabled`, environment-only, using `getAccessLogRetentionWindows()` and the same effective kind-list parser as the deleting owner. Either window at `keep` warns that its affected kinds are kept indefinitely, naming both windows/kind list and the scheduled-worker requirement if bounded probes are indeterminate. A window set to `0` is informational: it names the default it uses and the `keep` value. Registration depends on R3-2 — The registry carries the whole `privacy.ts` default export, contract Phase 1, and DEC-I — The doctor's extension point, doctor Phase 3; it ships with the `keep` value, not as an unowned follow-up.
- **Retention bound:** `audit_logs/privacy.ts.retentionBounds` declares the table's `operational_pruner` bound and `audit_logs/di.ts` registers its read-only handler `auditLogsOperationalRetentionBounds`; see "Retention bound for C5/G6" below. Preserve existing data classes and other owners' optional members in this module's default export. No database connection is opened by this declaration.

### Shared process-window accessor

`getAccessLogRetentionWindows(): Array<{ id: string; value: number | null; unit: 'hours' | 'days'; enabled: boolean; source: 'this_process' }>` uses exactly the result shape in `2026-11-16-privacy-ropa-generator.md`, Architecture. Return two rows, sorted by stable id: `audit_logs.core` with the effective `AUDIT_LOGS_CORE_RETENTION_DAYS` in days, and `audit_logs.non_core` with the effective `AUDIT_LOGS_NON_CORE_RETENTION_HOURS` in hours. These ids mean the configured listed kinds and their complement, not two overlapping table rules. Unset gives 7 days and 8 hours; `0` and invalid/non-finite/negative values use those same owner defaults, as today; a finite positive fractional value is preserved. The value `keep`, trimmed and case-insensitive, is returned as `value: 0, enabled: false`, the register's established "keep" encoding. An empty listed-kind configuration also makes the core row disabled, retaining its parsed value, and applies the non-core rule to all kinds. No null value is needed because both settings have finite defaults. `source` is always `this_process`.

The accessor opens no container/database and makes no writes or import-time log calls. It reports effective age rules, never claims a schedule or worker is live. The register consumes it without copying settings/defaults; the configuration-only doctor uses the same result, including disabled/keep semantics. The worker and safety net derive disjoint predicates using the same kind configuration and skip disabled rows. Reporting an empty listed-kind group must not claim that any records are thereby kept indefinitely; only a `keep` window with an affected kind group creates that consequence. The parser also exposes whether a raw value was `0` or invalid, so the run and the doctor can report it; the accessor's result shape is unchanged.

### Retention bound for C5/G6

`access_logs` holds who read which record and cannot be found by subject when encryption is on, so C5 classifies it `retention_bounded`. This spec owns its bound under R4-13 — Operational retention bounds, using the operational-pruners spec's registry and C5's exact contracts from [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md), “Retention bounds for independent verification” and “API Contracts”. It is published beside, not inside, the pruners spec's sixteen declarations.

- **Classification.** `audit_logs/privacy.ts.tables` classifies the whole `access_logs` table `{ kind: 'retention_bounded', boundedBy: { kind: 'operational_pruner', prunerId: 'audit_logs.access_logs' } }`. The configured kind list is runtime configuration, so no static C5 subset is declared; the per-row kind decides the window inside the owner's evaluation.
- **Declaration.** `retentionBounds` gains `{ id: 'audit_logs.access_logs', kind: 'operational_pruner', handlerService: 'auditLogsOperationalRetentionBounds', scheduleKey: 'audit_logs:access-log-prune:system', targets: [{ table: 'access_logs', columns: ['access_type', 'actor_user_id', 'context_json', 'created_at', 'deleted_at', 'fields_json', 'id', 'organization_id', 'resource_id', 'resource_kind', 'tenant_id'], ageAnchor: { columns: ['created_at'], rule: 'audit_logs.access_logs.created_at' }, eligibility: 'audit_logs.access_logs.kind_window' }] }`. The column list is the complete canonical snapshot of the table; the rule ids name the deleting code's shared predicate constants. `getOperationalRetentionBounds(modules)` validates it with the same rules as the sixteen pruner tables, including the schedule key against `retentionSchedules`.
- **`resolve`.** Returns the target with `mode: 'delete'` and no counting period (these rows are deleted today; DEC-H does not apply). `effectiveWindow` is in hours: the longer of the enabled groups' windows from `getAccessLogRetentionWindows()` (core days × 24, non-core hours), which is the latest any row may survive. When a group that has affected kinds is `keep`, the projection is `mode: 'off'`, `enabled: false`, `effectiveWindow: null`, `unboundedReason: 'access_log_keep'`; an empty listed-kind group alone does not disable it. A missing or disabled schedule row gives `scheduled: false` and `unboundedReason: 'unscheduled'`; the inline safety net is never enforcement evidence. Worker execution is `unknown` unless observed through scheduler-owned evidence, and an outstanding continuation is `mode: 'pending'`.
- **`evaluateFixtureRow`.** Reads only the captured row's id, tenant, organization, kind and `created_at` on the supplied read-only manager. A row of another tenant, or of another organization when the scope names one, returns `not_found`; a row with null `tenant_id` returns `unknown` with reason `installation_row`, because a tenant-required `PrivacyScope` cannot attribute it. Otherwise it classifies the kind with the same parser as deletion: a `keep` group returns `unbounded`; else `anchorAt` is `created_at`, `expiresAt` is `created_at` plus that group's window, and the row is `within_window` or `expired`. Disabled, unscheduled or unobserved enforcement returns `unbounded`. It returns no resource id, fields or context.
- **Fail closed.** A missing handler, a throwing evaluation or a mismatched column inventory never excuses a survivor, exactly as for the pruner tables.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Module → scheduler | `schedulerService` by DI key, in `setup.ts` only | Safety net deletes when its bounded probe finds evidence; its cursor walks past indeterminate pages; the bound projects `unscheduled` |
| Module → shared helper | Import from `@open-mercato/shared` | — |
| C5/G6 → bound | `auditLogsOperationalRetentionBounds` by DI key, through `getOperationalRetentionBounds(modules)` | Missing handler: verification fails closed |

## 📝 Data Models

Add concurrent non-transactional index migrations and snapshot updates for `(created_at, id)` and `(resource_kind, created_at, id)`. Preserve the existing indexes. The time/id index supports bounded ordered probes; the kind/time/id index supports positive listed-kind seeks, not an unbounded negative-kind request scan. No entity columns change.

## 📝 API Contracts

- **Settings.** `AUDIT_LOGS_CORE_RETENTION_DAYS` and `AUDIT_LOGS_NON_CORE_RETENTION_HOURS` keep their names, defaults and the meaning of `0` (the default); each additionally accepts `keep`, which keeps that group's rows. `AUDIT_LOGS_CORE_RESOURCE_KINDS` is new. `AUDIT_LOGS_ROTATE_INTERVAL_MS` now paces the safety net's check. Both `.env.example` files are updated.
- **Schedule** with key `audit_logs:access-log-prune:system`, with the UUID derived from that exact key as its id, targeting dedicated queue `audit-logs-access-log-prune`. **Upgrade action** `audit_logs.access-log-prune`, with its locale keys and version; the action id keeps the dotted upgrade-action form and is not the schedule key. Upgrade actions are offered per organization; the registration is idempotent, so running it in several changes nothing. An installation that never runs it uses the bounded safety net; an indeterminate probe warns that the scheduled worker must be restored.
- **Doctor check id:** `audit_logs.access_retention_disabled`, configuration-only and warning for either `keep` window; informational otherwise, including a window set to `0`.
- **Shared accessor:** `getAccessLogRetentionWindows()` has the exact register process-window result and stable group ids in Architecture; a new additive export from `@open-mercato/shared/lib/retention/accessLogWindows`.
- **Retention bound:** `retentionBounds` entry `audit_logs.access_logs` (`operational_pruner`), table classification `retention_bounded` with `{ kind: 'operational_pruner', prunerId: 'audit_logs.access_logs' }`, and DI key `auditLogsOperationalRetentionBounds` implementing C5's `PrivacyRetentionBoundHandler`; additive, stable once released.
- No route changes. The internal bounded-probe result is tri-state; existing public service signatures remain compatible.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Scheduler absent, disabled, or with no worker | Safety net deletes rows it finds, at least an hour past their window; its per-process cursor walks past listed-kind pages, and wraps after each completed sweep, so a row that committed behind the cursor is reconsidered in a later sweep. Indeterminate pages still warn that the worker should be restored |
| An existing installation that has not run the upgrade action | The same |
| A value that is neither `keep` nor a positive number | The default is used and the fact is reported once; `0` is reported with a pointer to `keep` |
| Both windows `keep` | Nothing is probed or deleted; daily warning and doctor warning say the table grows with every list request |
| Long window `keep`, large listed-kind backlog | Each ordinary request page reads at most 1,000 candidates and can return indeterminate while the cursor advances; the safety net and the scheduled traversal both reach eligible ordinary rows without deleting listed kinds |
| Default windows, no job, a busy user list | The in-window `auth.user`/`auth.role` band may be walked once per sweep. Ordinary rows behind it are deleted when the cursor reaches them and can outlive their window during repeated sweeps |
| Process restart or a changed window/kind list | The safety net's cursor restarts at the beginning of the table |
| One window `keep` | That delete and its part of the safety net's check are skipped; the other runs as usual |
| The ordinary window longer than the long window | Each kind keeps its own window; an ordinary row outlives a listed one of the same age |
| An empty list of long-window kinds | The first delete is skipped and every row has the ordinary window |
| A long outage | The job re-enqueues itself until it has caught up; meanwhile the safety net also deletes |
| The job and the safety net run at once | Both delete by id in batches; a row deleted by one is simply absent for the other |
| Writes outpace one run's time budget | The job runs back to back. If three consecutive runs end on the budget, that is reported as a warning |

## 📝 Migration & Backward Compatibility

| Change | Class |
|---|---|
| Deletion moves to a schedule | Internal; same rows, same windows: the two deletes keep today's disjoint conditions, so no row is deleted earlier than today. With the job running, rows go at their windows as today. Without it, the safety net reaches an ordinary row behind a large in-window listed-kind band only when its cursor gets there, so such a row can outlive eight hours during repeated sweeps. The per-request bound is stated under "The safety net's forward cursor" |
| `keep` value | Additive: a value that was previously invalid (and fell back to the default) now keeps rows. `0` and every other value keep today's meaning |
| New setting, schedule, upgrade action, queue, indexes, doctor check, retention bound | Additive |

`UPGRADE_NOTES.md`: run the module's upgrade action; that `keep` keeps a group's rows and `0` still means the default; how to keep a longer trail and what it costs in rows; `privacy doctor` warns about indefinite keeping; the safety net's cursor bounds its work per request but does not replace a live worker, and without one ordinary rows can outlive eight hours while the cursor walks the in-window listed-kind band during a sweep. No claim is made that inline fallback keeps today's timing without the scheduler.

## 📋 Implementation Plan

1. Extend the existing rotation test to pin today's behaviour: the two windows, the fallback on `0`, the kinds. Commit alone.
2. Rebase on #8472 if it has merged. Add the shared parser and `getAccessLogRetentionWindows()` accessor, and adopt them in the scheduled owner, inline safety net, doctor and register without duplicate defaults. `accessLogWindows.test.ts` pins the exact process-window result shape/group ids, units, 7-day/8-hour defaults, invalid/non-finite/negative fallback, `0` still giving the default (and flagged for a once-only report), `keep` in any case or with surrounding spaces on either/both windows, fractional values, empty kinds and a changed environment on a later invocation. Owner rotation/handler tests compare actual cutoff and keep predicates with these same accessor results; doctor/register consumer tests exercise parity, including the empty-kind distinction.
3. Replace the two deletes with the batched function, with the disjoint conditions and the forward walk described. Unit tests with an injected clock: each window, a fractional window, a backlog across two runs, the time budget; the ordinary window `keep`, the long window `keep`, an existing `0` that still deletes at the default, an ordinary window longer than the long one, and an empty kind list, each asserting which rows remain.
4. Add concurrent index migrations and snapshot, then turn inline rotation into the bounded tri-state safety net with its per-process forward cursor and bounded-id deletes with a statement timeout. `accessLogService.rotation.test.ts` checks the inner limit before the negative kind filter, both-`keep` no queries, indeterminate handling, cursor advance past an all-listed page, a cutoff fixed across pages, reset only on the next paced probe after exhaustion and on restart, configuration change or failed delete, and a default-window fixture in which more than 1,000 in-window `auth.user` rows precede an expired ordinary row that a later probe deletes; a real-database large listed-kind fixture verifies the query plan and bounded work. A unit test that a year-old ordinary row with the ordinary window at `keep` triggers no delete. Update the rotation test and, if #8472 has merged, its `TC-AUD-016`, whose expired row must be more than an hour past its window to still be deleted inline.
5. Add the queue at concurrency 1, handler with coalesced re-enqueue and cursor preservation, registration and upgrade action, consuming the same `retentionSchedules` constant as the scheduler expectation collector; test exact id parity and disabled-row preservation. Recheck the parent's deployment connection budget. Add the disabled-retention doctor check after contract Phase 1 and doctor Phase 3, tested for each `keep` window, both kept, and an informational `0`.
6. Add the `audit_logs.access_logs` table classification, `retentionBounds` entry and `auditLogsOperationalRetentionBounds` handler after C1 Phase 1 and C5's `operational_pruner` variant. `accessLogRetentionBounds.test.ts` validates the declaration through `getOperationalRetentionBounds(modules)` (exact snapshot columns, schedule key) and the handler on the read-only snapshot manager: default windows projected in hours; a `keep` group as off; an empty kind list not disabling it; a missing or disabled schedule as unscheduled; listed and ordinary fixture rows within and past their windows; a `keep`-group row as unbounded; another tenant's or organization's row as `not_found`; a null-tenant row as `unknown`; and attempted writes refused.
7. Integration test; both `.env.example` files; `UPGRADE_NOTES.md`; the dated compatibility entry; the audit-logs docs page.
8. Archive the Delta if the capabilities directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/audit_logs/{services/accessLogService.ts,workers/*,setup.ts,privacy.ts,di.ts,lib/accessLogRetentionBounds.ts,migrations/*,i18n/*}` and snapshot | Modify / create |
| `packages/core/src/modules/audit_logs/lib/__tests__/accessLogRetentionBounds.test.ts` | Create — bound declaration and handler |
| `packages/shared/src/lib/retention/accessLogWindows.ts` and `__tests__/accessLogWindows.test.ts` | Create — parser and accessor shared by deleting owner, doctor and register |
| `packages/core/src/modules/configs/lib/upgrade-actions.ts` | Modify |
| `packages/core/src/modules/audit_logs/services/__tests__/accessLogService.rotation.test.ts`, and `TC-AUD-016` if present | Modify |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUDIT-ACCESS-RETENTION-00{1,2}.spec.ts` | Create |
| `apps/mercato/.env.example`, the template copy, `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, `apps/docs/docs/user-guide/audit-logs.mdx` | Modify |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-AUDIT-ACCESS-RETENTION-001 | Rows are inserted directly with backdated times chosen so that only the job can delete them: an ordinary one eight and a half hours old and a user one seven days and thirty minutes old — past their windows, inside the safety net's extra hour — plus a user row a day old and a fresh ordinary one. The scheduler's API shows the schedule. The job is enqueued and drained through the integration queue helper. `GET /api/audit_logs/audit-logs/access` then returns the day-old user row and the fresh row and neither of the other two. The test removes what it inserted |
| TC-AUDIT-ACCESS-RETENTION-002 | In-process real-database service/handler with injected clock/settings: insert own 20,000 old listed-kind rows with the long window `keep` plus a newer expired ordinary row. Capture EXPLAIN ANALYZE for the bounded ordinary probe; at most 1,000 candidates read per page before kind filtering, indeterminate returned while the cursor advances, request performs no unbounded delete, listed rows survive, and both the safety net (within 21 pages, no worker) and the worker delete the ordinary row. Repeat under the default windows with 20,000 own `auth.user` rows aged between nine hours and seven days preceding an expired ordinary row: the safety net alone deletes it and no in-window user row. With scheduler disabled, use a second connection to commit an expired ordinary row behind a cursor already advanced over more than one page of listed rows. Exhaust the current sweep, assert the late row remains, then advance the probe clock and assert the next sweep deletes it with the same page bound and keeps the listed controls. Also cover `keep` on either side, `0` still deleting at the default, longer ordinary window, empty kinds and repeat idempotency; assert the shared accessor reports the same effective windows/disabled groups used by both delete paths, register, configuration-only doctor and the `auditLogsOperationalRetentionBounds` projection/fixture evaluation of own rows |

Both tests create their own tenants, organizations and rows, use an isolated test database or fixture-only handler adapter, and clean rows/schedules/configuration/jobs in `finally`. The database performance test asserts bounded rows read and SQL shape, not wall-clock speed on shared CI hardware. Settings are injected in process, so they do not depend on the running app's environment.

## 📝 Risks & Impact Review

#### The table grows without bound
- **Scenario**: The job is not running, or cannot keep up with the write rate.
- **Severity**: High
- **Affected area**: database size; every list request adds rows
- **Mitigation**: The safety net uses bounded table evidence and repeated fixed-cutoff sweeps, so successful later sweeps reconsider rows that committed behind the cursor without reading the whole table on one request; the job runs until caught up with coalesced continuations; repeated exhaustion or indeterminate probes warn; doctor warns for indefinite windows; the retention bound projects an unscheduled job as unbounded.
- **Residual risk**: A write rate above back-to-back deletion capacity. With the worker stopped, ordinary rows behind a large in-window listed-kind band outlive their window while each process's cursor first walks that band; that first-walk delay can recur in later sweeps. Expiry depends on continued probes and available capacity, and restoring the worker restores normal scheduling.

#### A delete removes rows the operator chose to keep
- **Scenario**: A delete that ignores the kind, or a window set to `keep`, removes ordinary rows at the long window while an operator keeps them for an investigation.
- **Severity**: High
- **Affected area**: access-log rows kept on purpose; the trail an investigation relies on
- **Mitigation**: The two deletes keep today's disjoint conditions; each is skipped when its window is `keep`; the safety net checks under the same conditions; unit tests pin `keep` on either side, an ordinary window longer than the long one and an empty kind list.
- **Residual risk**: None beyond a gap in those tests.

#### The shared helper is not there
- **Scenario**: The pruner spec's Phase 1 has not landed, or its helper differs.
- **Severity**: Medium
- **Affected area**: this change's schedule
- **Mitigation**: The parent Phase 1 owns the exact `pruneBatches` export; sequence this change after it and the diagnostic dependencies.
- **Residual risk**: Delivery delays in those prerequisites; no parallel definition of the helper.

#### An operator sets `0` expecting rows to be kept
- **Scenario**: Someone sets a window to `0` during an investigation, expecting it to stop deletion, as the new pruner variables' `0` does.
- **Severity**: Medium
- **Affected area**: the access-log trail an investigation relies on
- **Mitigation**: `0` keeps its existing meaning, so no installation changes behaviour on upgrade; the run reports once that `0` uses the default and names `keep`; the doctor reports it as informational; the `.env.example` comment and docs page name `keep`.
- **Residual risk**: An operator who reads none of these loses rows at the default window, as today.

#### Coverage treats the table as bounded when it is not
- **Scenario**: C5/G6 accept a configured window as proof while the job is unscheduled, a group is kept, or the row has no tenant.
- **Severity**: High
- **Affected area**: C5 table coverage and G6 survivor checks for `access_logs`
- **Mitigation**: The owner's `resolve`/`evaluateFixtureRow` share the deletion parser and kind list; `keep`, unscheduled and unobserved states are unbounded; null-tenant rows are `unknown`; the safety net is never enforcement evidence.
- **Residual risk**: None beyond a gap in `accessLogRetentionBounds.test.ts`; verification fails closed.

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
| No setting changes meaning | Compliant | `0` keeps today's meaning; `keep` is a new, previously invalid value; upgrade note |
| A catch that records an error also reports it | Compliant | The helper reports |
| Template sync for env vars | Compliant | Named |
| Behaviour preserved | Compliant | Disjoint conditions per kind, as today; `keep` skips only its own delete |
| Integration coverage | Compliant design | Default path plus injected settings, default-window and large-backlog real-database integration; owned fixtures and cleanup |
| Request-path cost | Compliant design | Bounded inner candidate page, forward cursor and id-limited deletes; indeterminate is explicit, not reported as no eligible rows |
| R4-13 / C5 retention bound | Compliant design | `audit_logs.access_logs` `operational_pruner` entry and owner handler, fail-closed projection and fixture evaluation |

**Verdict:** Design ready after #8472 is resolved and the pruner spec’s first phase has landed or is folded in. Written upstream approval must name this proposed OSS carrier under [DEC-2](2026-11-15-gdpr-ready-deployments-program.md#decisions) before implementation or OSS submission. An independently approved fix can proceed under its own carrier.

## Changelog

### 2026-11-18
- The inline safety net now completes fixed-cutoff sweeps and revisits late-visible or backdated rows. Acceptance covers a commit behind the cursor with the scheduler disabled.

### 2026-11-17
- The safety net's ordinary probe walks forward with a per-process cursor, so it no longer stalls behind the in-window listed-kind band under the default windows; Delta, edge cases, migration row, tests and risks state the bounded first-walk lag.
- `0` keeps its existing meaning (the default); the new explicit value `keep` keeps a group's rows, so no existing configuration changes behaviour.
- The audit module now publishes the `audit_logs.access_logs` `operational_pruner` retention bound, its table classification and the `auditLogsOperationalRetentionBounds` handler for C5/G6.
- The schedule key is `audit_logs:access-log-prune:system`, matching sibling carriers; an Overview section was added.

### 2026-11-16
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): align the existing access-log schedule expectation to the doctor's exact pruners.unscheduled diagnostic id.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): use the current doctor-owned pruners.unscheduled diagnostic for the existing access-log schedule expectation.
- Council round two fixes, pass three (GPT-6.1 Sol workers): verified shared process-window shape, fractional/zero/empty-kind semantics and owner/register/doctor parser parity; declare the exact system schedule key and dedicated queue through the parent's expectation manifest.
- Council round two fixes, pass two (GPT-6.1 Sol workers): shared `getAccessLogRetentionWindows()` parser/accessor with the register's exact process-window shape, effective zero/empty-kind/fractional semantics, owner/doctor/register call sites, manifest and parity coverage; exact R3-2 and DEC-I citations.
- Council round two fixes (GPT-6.1 Sol workers): r8-23 bounded tri-state request probes, matching indexes, id-limited deletes and large-backlog integration evidence; F-55 configuration-only doctor warning for indefinite windows; helper ownership and residual scheduler dependence stated.
- Written autonomously with resolved assumptions.
- Revised after independent review. A fixed cap per run could lose to the write rate, so the job now runs until caught up within a time budget and re-enqueues itself. The inline path is kept as a safety net triggered by the table's own state, because "a schedule exists" is also true when it is disabled or has no worker. The needs from the shared helper are written out. The schedule id is a derived UUID. The existing rotation test is extended instead of a new characterization file, and the integration test uses rows only the job can delete.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g5-02 — the first delete no longer ignores kind; both deletes keep today's disjoint conditions, each is skipped when its window is `0`, the safety net checks under the same conditions, and scenarios, edge cases, unit tests, a risk and a compliance row cover `0` on either side, an ordinary window longer than the long one and an empty kind list.
