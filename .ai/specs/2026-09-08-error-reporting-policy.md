# Error Reporting Policy — recorded errors reach the active telemetry backend

- **Status:** Draft — Open Questions resolved (see [Decisions](#decisions)); awaiting review
- **Scope:** OSS (cross-cutting: `packages/telemetry`, `packages/shared`, `packages/queue`, `core:integrations`, `core:data_sync`)
- **Issue:** [#60](https://github.com/open-mercato/open-mercato/issues/60) — *feat: add global telemetry handler for exception handling*
- **Origin:** Phase 3 of [`2026-04-29-telemetry-and-otel.md`](2026-04-29-telemetry-and-otel.md) §S8, which shipped `reportError` as the conduit and deferred the *policy* to "issue #60's spec". That spec was never written; #60 was later marked a duplicate of the conduit spec, leaving the policy unowned.
- **Related:** [`2026-07-02-structured-logging-facade.md`](2026-07-02-structured-logging-facade.md) (transport only); PR [#5450](https://github.com/open-mercato/open-mercato/pull/5450) *Background Work* part 6 (`2026-08-21-background-work-06-data-sync-hardening.md`, lands with that PR) §4 (run-level fault taxonomy; does not cover per-item failures or outward routing)
- **Risk:** `risk-medium` (additive contract surface; touches a chokepoint every integration writes through) · **Priority:** `priority-medium`
- **Category:** `feature`

## TLDR

**What is wrong.** When a `data_sync` run dead-letters 115 items, nobody is told. The reasons exist in exactly one place — the `integration_logs` rows behind the run page in the admin UI. No error reaches Sentry, SigNoz, New Relic or any other backend, because the code that catches those failures *writes a database row and continues*: it never calls `reportError`, and it never even calls `logger.error`, so there is nothing for the telemetry log bridge to pick up either. The framework's error funnel has **two call sites in the entire repo** (the API dispatcher and the CRUD factory); `packages/core` has none.

**Who this is for.** The operator on call for a tenant's integrations, and the developer they escalate to. Today both learn about a failed import from a human opening a page.

**What we are asking for.** Adopt one rule — *recording an error is not reporting it* — and wire the framework's own three chokepoints so the rule holds without per-module effort:

1. `integrationLogService.write()` at `level: 'error'` tees to `reportError` (covers `data_sync`, `payment_gateways`, `gateway_stripe` and every future integration in one place);
2. the queue runner's job-failure path tees to `reportError` (covers a worker that crashes outright);
3. `reportError` gains a stable `code` — the fingerprint the backend groups on, and the one thing a backend cannot derive for itself here.

**The argument.** The gap is not missing infrastructure. `reportError` exists, is vendor-neutral, and any OTLP backend is one env var away. The gap is that *the places errors actually land* — a log row, a `failed` status, a dead-letter entry — are not connected to it, and connecting them per call site is a treadmill. Three chokepoints cover essentially every integration and background-work error path in the repo, and the rule keeps new ones connected.

**Scope**
- The policy rule, documented where agents and reviewers actually read it, and checkable in review.
- The `integrations` log-service tee and the `queue` job-failure tee.
- `reportError` policy: the `code` fingerprint attribute, and the PII posture (message + code + ids only, never `payload`).
- One aggregated report per partially-failed sync run, plus item counts on `data_sync.run.completed`.
- Optional `reportError?()` on `TelemetryProvider` + a documented recipe for an issue-tracker provider (Sentry-shaped backends), with no upstream vendor dependency.

**Concerns**
- `integration_logs.payload` carries the full failed item; teeing it outward would export customer data to a third party. The tee sends message + `code` + ids only.
- **Every** error is reported; the framework adds no sampling, throttling or suppression of its own. Volume, grouping and quota control belong to the backend and the collector, which already own them — see [S3](#s3--fingerprint-policy-report-everything).
- Root `AGENTS.md` has **8 bytes of budget headroom** (`yarn agents:check-budget`), so the rule cannot simply be appended there. See [S5](#s5--where-the-rule-lives-and-how-it-is-enforced).

## Decisions

The skeleton's Open Questions, resolved as recommended. Rationale is inlined below at the section each decision governs.

| # | Question | Decision |
|---|---|---|
| Q1 | Where does the per-item failure `code` contract live? | **Part 6 §4 owns it**; this spec consumes it, with a named fallback so Phase 1 is not blocked ([P1](#prerequisite-p1)) |
| Q2 | Provider contract for issue-tracker backends? | **Optional `reportError?(error, ctx)` on `TelemetryProvider`** + docs recipe. No upstream Sentry dependency ([S4](#s4--optional-provider-error-hook)) |
| Q3 | Tee scope | **Every `level: 'error'` write through `integrationLogService`**, plus the queue job-failure path ([S1](#s1--tee-at-the-chokepoints)) |
| Q4 | Rate-limit default | **Reversed after review: no framework-side rate limit at all.** Report everything; carry a `code` so the backend groups correctly ([S3](#s3--fingerprint-policy-report-everything)) |
| Q5 | Other swallow sites | **Out of scope, named owners** — this spec ships the rule + the chokepoints ([Out of scope](#out-of-scope--named-owners)) |

---

## Problem Statement

### The three layers an error can occupy today

| Layer | What reaches a backend | Repo examples |
|---|---|---|
| **Reported** — `reportError` | span exception + `setStatus('error')`, an error log record, `om.errors` counter | API dispatcher 5xx (`apps/mercato/src/app/api/[...slug]/route.ts:467`, twin in `packages/create-app/template/…:467`), CRUD factory 500 (`packages/shared/src/lib/crud/factory.ts:645`) |
| **Logged only** — `logger.error` | the log record, via the telemetry logger extension (`packages/telemetry/src/facade/logger-bridge.ts:40-49`) — no span exception, no `om.errors`, no fingerprint to group on | `packages/queue/src/strategies/async.ts:417` (`Job failed`), `local.ts:495`, `data_sync/workers/sync-import.ts:67` |
| **Recorded only** — a DB row / a status / a dropped promise | **nothing** | every `integrationLogService.write({ level: 'error' })` (7 sites), `refreshCoverageSnapshots`' `Promise.allSettled` (`sync-engine.ts:231-242`) |

The third layer is where `data_sync`'s failures live. That is the bug.

### Evidence

- **`reportError` call sites, non-test, whole repo:** the API dispatcher and the CRUD factory. Nothing in `packages/core` calls it; core cannot import `@open-mercato/telemetry` and reaches the funnel through `getTelemetryRuntime()?.reportError(...)` (`packages/shared/src/lib/telemetry/runtime.ts:47-53`), which no core module does.
- **Per-item failures are row-only.** `logImportItemFailures` (`sync-engine.ts:245-280`) and `logExportItemFailures` (`:282-305`) do one `integrationLogService.write()` per failed item — a Postgres insert, nothing else. No log line, no span event, no metric, no event.
- **Run faults are row-only too.** The import fault catch (`sync-engine.ts:705-733`, export mirror `:927-955`) writes an `error` row and calls `finalizeRun(…, 'failed')`. The *second* run-level error record, `writeOperationalLog` (`:472-484`), is gated on `adapter.operationalTelemetry === true` (`:546`) — and exactly one adapter in the repo sets it (`sync_excel/lib/adapters/customers.ts:993`). So for `sync_akeneo` and every third-party adapter, observability of a run failure is one row and a status column.
- **Counts are visible; reasons are not.** Per-batch span attributes already carry `data_sync.failed_count` (`:657-663`) and `sync_runs` persists the counters, so a metric alert on failures works. `data_sync.run.completed` (`:489-496`) carries no counts at all, and *no* signal carries the failure reasons.
- **`integration_logs.code` is dead weight for `data_sync`.** The column exists (`log-service.ts:37`) and all five `data_sync` writers omit it; a failed import item carries only a loose `data.errorMessage` string (`sync-engine.ts:251-253`). Repo-wide only two writers pass a `code`: the `payment_gateways` log helper passthrough (`lib/gateway-service.ts:170-185`) and `gateway_stripe`'s webhook processor (`workers/webhook-processor.ts:109`). Without a stable code there is nothing for a backend to group on.
- **Silent drops.** `refreshCoverageSnapshots` (`sync-engine.ts:231-242`) awaits `Promise.allSettled` and never inspects the results — a rejected coverage refresh leaves no row, no log, no signal. The heartbeat and cancellation timer ticks (`:194`, `:220`) and `closeQuietly` (`lib/batch-stream.ts:38-45`) degrade to `logger.warn`, which is the deliberate choice for a timer but means the failure is invisible to error tooling.
- **The same shape outside `data_sync`.** `payment_gateways/workers/status-poller.ts:40-55` and `gateway_stripe/workers/webhook-processor.ts:105-112`: caught, written as a row, continued.
- **Observed consequence (production deployment, 2026-09-04).** 115 dead-lettered items, two real defects. Discovered by a human opening the run page and pasting the log list into a ticket. The metric alert on `sync_runs.failed_count` fired correctly and could not say *why*.

## Proposed Solution

### The rule

> **Recording an error is not reporting it.** A `catch` that does anything other than rethrow — persists a row, sets a `failed` status, dead-letters an item, returns a fallback — MUST also route the error to `reportError`, either directly or through a chokepoint that does. `logger.error` alone does not satisfy the rule: it produces a log record with no span exception, no `om.errors` sample and no fingerprint.

### S1 — Tee at the chokepoints

**(a) `createIntegrationLogService().write()`** (`packages/core/src/modules/integrations/lib/log-service.ts:43-58`). After the row is flushed, when `input.level === 'error'`:

```ts
getTelemetryRuntime()?.reportError(new IntegrationLogError(input.message), {
  module: 'integrations',
  code: input.code ?? 'integrations.log_error',
  attributes: {
    integrationId: input.integrationId,
    runId: input.runId ?? undefined,
    scopeEntityType: input.scopeEntityType ?? undefined,
    scopeEntityId: input.scopeEntityId ?? undefined,
  },
})
```

- `IntegrationLogError` is a named `Error` subclass exported from `integrations` so the backend groups these apart from raw adapter throws. The row's `message` is its message; **`input.payload` never leaves the row**.
- The whole tee is wrapped in `try/catch` that logs at `warn` and continues. Observability never alters behaviour — the same rule the logger extension follows, and the reason a telemetry outage cannot fail a sync batch.
- Fires after `flush()`, so a telemetry hiccup cannot roll back a durable record.
- `scoped().error()` (`:60-66`) routes through `write()`, so it inherits the tee.

Why the service and not the call sites (Q3): it is the single chokepoint all seven `level: 'error'` writers already pass through, and the non-`data_sync` writers (payment status poller, Stripe webhook processor) have the identical gap. One edit covers them and every future integration.

**(b) The queue job-failure path** — `packages/queue/src/strategies/async.ts:417` and `strategies/local.ts:495` (plus `async.ts:242/251/291` abandonment-sweep failures). Each keeps its `logger.error` and adds `reportError` with `module: 'queue'`, `code: 'queue.job_failed'` / `'queue.job_exhausted'` / `'queue.abandon_sweep_failed'`, and attributes `{ queue, jobId, attemptNumber }`. This is what catches a `data_sync` worker that rethrows (`workers/sync-import.ts:41-71`, `sync-export.ts` mirror) rather than finishing through the engine's own fault path.

A job failure reports **once**, coded by what the failure means: `queue.job_exhausted` on the attempt that dead-letters the job, `queue.job_failed` while retries remain. Two reports on the final attempt would double-count `om.errors` and raise two issues in an issue-shaped backend, and an operator pages on dead-lettering, not on a first attempt that will be retried. Both strategies implement it identically — `local.ts` from its own `attemptCount`, `async.ts` from BullMQ's `job.attemptsMade` against the job's `opts.attempts` — so an alert written against one holds for the other. There is no `jobName`: `QueuedJob` has no name field and the async strategy passes the job id as BullMQ's job name.

**(c) `refreshCoverageSnapshots`** (`sync-engine.ts:231-242`) inspects its `Promise.allSettled` results and reports each rejection (`code: 'data_sync.coverage_refresh_failed'`, attributes `{ entityType }`) instead of dropping it. Behaviour is otherwise unchanged: a coverage-refresh failure still does not fail the batch.

### S2 — One aggregated report per partially-failed run

`finalizeRun` (`sync-engine.ts:348-500`), on `status === 'completed'` with `run.failedCount > 0`, reports exactly one error:

```ts
getTelemetryRuntime()?.reportError(new SyncRunPartialFailureError(
  `Sync run completed with ${run.failedCount} failed item(s)`
), {
  module: 'data_sync',
  code: 'data_sync.run_partial_failure',
  attributes: { runId, integrationId, entityType, direction, failedCount: run.failedCount },
})
```

This is the signal that answers *"a run finished badly"* at run granularity, independent of per-item volume. It is deliberately not gated on `adapter.operationalTelemetry`: an adapter flag may decide how chatty the *operational log* is, never whether a failure is observable.

`data_sync.run.completed`'s payload gains `createdCount` / `updatedCount` / `skippedCount` / `failedCount` (additive optional fields — BACKWARD_COMPATIBILITY §5 permits this), so a subscriber or a tenant webhook can distinguish a clean run from a partial one without querying `sync_runs`.

### S3 — Fingerprint policy: report everything

`ReportErrorContext` gains `code?: string` — a **stable, enumerated, low-cardinality token** (`module.reason`), never an interpolated message. `reportError`:

1. stamps `error.code` on the span exception attributes and the log record;
2. labels the counter `om.errors{module, code}` — `code` is enumerable, so this stays a legal metric label; ids stay off metrics and on span attributes (the telemetry spec's R4);
3. reports every occurrence. No sampling, no throttling, no suppression.

**Why `code` and not a limiter.** These are two separable halves of what looked like one design, and only one of them is ours to own.

*Grouping is worth owning, and the backends cannot do it for us here.* Sentry fingerprints on the stack trace; New Relic groups on error class and message. The `integrations` tee synthesizes a single `IntegrationLogError` at one line in `log-service.ts`, so without an explicit `code` **every integration error in the product collapses into one group** — one issue titled "IntegrationLogError", 40 000 events deep, spanning a broken Akeneo cursor and a declined card. SigNoz has no error-grouping concept at all; it groups at query and alert time, on the attributes we send. So the more capable the backend's grouping, the more it depends on us supplying a discriminator that the synthesized error object does not carry. `code` is that discriminator, and it is why this section exists.

*Rate limiting is not worth owning, because three layers below us already do it — better.*

| Layer | What it already does |
|---|---|
| Backend | Sentry: per-project/per-key rate limits, spike protection, client `sampleRate`, `beforeSend`. New Relic: ingest quotas and NRQL drop rules. SigNoz: whatever the collector in front of it is configured to do. |
| Collector | The OTel Collector is the designed home for filtering, sampling and rate limiting, per pipeline, per deployment, changeable without a release. |
| SDK | This repo's provider uses `BatchSpanProcessor` and `BatchLogRecordProcessor` at SDK defaults (`otlp-provider.ts:256-258`): a bounded queue that sheds load under flood, plus the default 128-events-per-span cap that truncates excess span exceptions. |

A fourth limiter in the facade would be the worst of the four:

- **It drops data irreversibly at the source.** Nothing downstream can recover a suppressed report — no drill-in, no later re-aggregation, no "show me the 40 I did not see". The backend's own limiters drop at ingest, where the operator can see the drop and raise the quota.
- **Its guarantee is fictional.** The budget is per process. With `DATA_SYNC_QUEUE_CONCURRENCY = 5`, several workers and the web tier all running, "10 per 60s" is really "10 per 60s **per process**", which is neither a number an operator can reason about nor one an alert can be written against.
- **It solves an alerting problem in the wrong layer.** The original justification — *115 events would make an operator mute the channel* — is about alert routing, not about data collection. The fix is the alert rule: group by `code`, threshold on the `om.errors` rate, re-notify on an interval. Every one of these backends supports that; none of them needs us to have thrown the events away first.
- **It costs the thing it was meant to protect.** Reporting is cheap (a serialize, a redaction pass, a queue push) and already bounded by the SDK's queue; a per-fingerprint table with an eviction policy is new state, new config, and a new failure mode inside the error path.

*What survives the deletion*, because neither is rate limiting:

- **The aggregate run report** ([S2](#s2--one-aggregated-report-per-partially-failed-run)) — it exists because "this run ended with 115 failures" is a *different fact* from any one item's failure, not because 115 reports were too many. It stays either way.
- **A re-entrancy guard.** `reportError` sets a module-level flag for its own duration and no-ops on a nested call, so an error raised *inside* reporting (a provider hook that reports its own failures, a redaction bug) cannot recurse. A plain flag is sufficient only because the funnel is synchronous end to end; introducing an `await` in it would require an async-context-scoped flag, or concurrent reports would suppress each other. ~10 lines, no config, no window, no eviction — a correctness guard, not a policy. It bounds recursion, not propagation: a hook that *throws* is handled separately, by wrapping the call ([S4](#s4--optional-provider-error-hook)).

*If a deployment does hit ingest cost*, the documented answer is the collector or the backend's own controls, named in the docs page. Adding a framework knob "just in case" would put the control at the layer with the least context: the collector knows the deployment's budget, the facade knows only that an error happened.

### S4 — Optional provider error hook

`TelemetryProvider` gains an **optional** method:

```ts
reportError?(error: { name: string; message: string; stack?: string }, ctx: { module?: string; code?: string; attributes?: Attributes }): void
```

The facade always does its three existing things (span exception, error log, counter) and **additionally** calls `provider.reportError?.()` when the active provider implements it, passing the already-serialized, already-redacted error. It is additive rather than a replacement so no path can lose signal; a provider that models errors as issues owns its own dedup. `TelemetrySignal` already lists `'errors'` (`types.ts:10`) — this makes that entry mean something.

**The call is wrapped, and this is load-bearing.** The hook is implemented by third parties, and `reportError` is called from `catch` blocks that still have work to do after it: the API dispatcher records a duration metric, emits `application.request.failed` and rethrows the original error; the CRUD factory returns a 500 carrying its `x-request-id`. An unguarded hook that throws would take all of that with it and replace the caller's error with the telemetry provider's — the exact inverse of "a telemetry failure cannot fail application work". The facade therefore catches around the hook and degrades to a `warn`; the interface documents it as non-throwing and the README recipe repeats that, but the guard is what makes it a property rather than a request. `code` reaches the hook in the context only, never duplicated into `attributes`.

No Sentry dependency is added upstream. `packages/telemetry/README.md` gains a ~20-line recipe: implement `TelemetryProvider` (delegating tracing to the OTLP provider or a no-op), implement `reportError`, `registerProvider(provider)` before `initTelemetry()`, set `TELEMETRY_BACKEND` to the provider's name. Providers stay a bootstrap concern; the facade stays vendor-neutral.

### S5 — Where the rule lives and how it is enforced

Root `AGENTS.md` is at 31,224 of 31,232 bytes — **8 bytes free** — and `yarn agents:check-budget` is a hard gate, so the rule cannot be appended there. Anything past the limit is never delivered to the agent, which would make an appended rule worse than no rule.

- **Canonical text**: `packages/telemetry/AGENTS.md` → **Always** (one bullet, ~4 lines). That file is 3.3 KB and is read by anything touching telemetry.
- **Long form**: a new `apps/docs/docs/framework/runtime/error-reporting.mdx` — the rule, the three chokepoints, the `code` naming convention, where volume control belongs, the custom-provider recipe, and the "`logger.error` is not reporting" distinction. Sibling of `logging.mdx`.
- **Router**: rewrite the existing logging row (`AGENTS.md:100`) **byte-neutrally or shorter** to cover both, pointing at the telemetry package guide and the new docs page. The step is not done until `yarn agents:check-budget` passes; if the row cannot absorb it, the fallback is to trim the same row's now-redundant parenthetical rather than to grow the file.
- **Review**: a new `.ai/review-checklist.md` section — *Observability & Error Reporting* — with the rule as two checkboxes (catch-that-records also reports; `code` is an enumerated token, not an interpolated string). This is the enforcement surface `om-code-review` actually reads.
- No new lint gate in Phase 1. A static check for "catch blocks that record without reporting" is inherently noisy; an advisory script in the spirit of `yarn logger:check-console` is a Phase 2 option, not a blocker.

### Prerequisite P1

Per-item failures need a stable `code`, and today a failed import item carries only `data.errorMessage`. Part 6 §4 (in PR #5450, not yet on `develop`) already introduces the fault taxonomy (`classifySyncError`, `TransientSyncError`, `TerminalSyncError`) and already names `logImportItemFailures` in its post-commit-bookkeeping paragraph, so the per-item contract belongs there (Q1a) — one additive paragraph:

> A failed `ImportBatch` item MAY carry `data.errorCode` (a stable `module.reason` token) alongside `data.errorMessage`. `logImportItemFailures` passes it to `integrationLogService.write({ code })`; absent, the engine substitutes `data_sync.item_failed`.

**Fallback (not a blocker):** if part 6 lands without that paragraph, Step 1.4 of this spec adds the same contract in `data_sync`. Either way the fallback code is a real token (`data_sync.item_failed` / `data_sync.export_item_failed`), never `'unknown'` — grouping must work for adapters that supply nothing. Run faults reuse part 6's classification: `data_sync.run_transient` / `data_sync.run_terminal`.

## Definition of Done

Ordered by what the change is for. Each line is checkable by a named test or a stated command; the first is the one the spec exists to fix.

### The capability

- [ ] **Errors during a data sync are reported.** With `TELEMETRY_BACKEND=console` (or any OTLP backend) and an import whose adapter fails items:
  - [ ] each dead-lettered item produces a reported error carrying `code`, `runId`, `integrationId` and the item's identifier — every item, never gated on an adapter flag;
  - [ ] a run that ends `failed` produces exactly one `data_sync.run_failed` report with the fault's `runId`, for **every** adapter — including those with `operationalTelemetry` set, whose operational status row carries no `code` precisely so it cannot duplicate the fault's fingerprint;
  - [ ] a run that ends `completed` with `failedCount > 0` produces exactly one `data_sync.run_partial_failure` report carrying `failedCount`;
  - [ ] a `data_sync` worker that crashes outright produces a `queue.job_failed` report naming the queue and job — `queue.job_exhausted` once it has spent its last attempt;
  - [ ] a rejected coverage refresh produces a `data_sync.coverage_refresh_failed` report instead of being dropped.
- [ ] **Every `level: 'error'` integration log row is reported**, for all seven current writers across `data_sync`, `payment_gateways` and `gateway_stripe` — verified by a service-level test, not per call site.
- [ ] **Every reported error names its cause.** No covered writer reports a constant message with the reason only in `payload`, since the payload never egresses: the payment status poller and the Stripe webhook processor interpolate the cause into the message.
- [ ] **A `code` that came from outside the framework is validated, not trusted.** An adapter's `data.errorCode` is used only when it is shaped `module.reason`; anything else falls back to the engine's own code, because metric labels are unbounded in cardinality and — unlike attributes — skip redaction.
- [ ] **A job failure is reported once, coded by what it is.** `queue.job_exhausted` on the attempt that dead-letters the job, `queue.job_failed` while retries remain, identically on the `async` and `local` strategies.
- [ ] **A burst groups, and nothing is dropped.** 115 item failures produce 115 reports that share one `code`, so the backend collapses them into one group of 115 and `om.errors{module, error.code}` counts 115 — no framework-side suppression anywhere in the path. Drilling into any one of the 115 still yields its own item id and message.
- [ ] **Reporting cannot recurse.** An error raised inside the reporting path (a provider hook that reports its own failures, a redaction bug) is not itself reported; the re-entrancy guard no-ops the nested call and the original report still completes.
- [ ] **A provider hook that throws cannot escape `reportError`.** The call into `provider.reportError?.()` is wrapped and degrades to a `warn`, so the API dispatcher still records its duration metric, emits `application.request.failed` and rethrows the caller's error, and the CRUD factory still returns its 500 with `x-request-id`. Asserted by a test with a throwing hook that also checks the span exception, the error log record and the `om.errors` sample all landed.
- [ ] **An issue-tracker backend can be plugged in** without patching the facade: a test provider implementing `reportError?()` receives every reported error, with `code` and attributes intact, and the built-in span/log/metric path still fires.

### Non-regression

- [ ] **Telemetry off changes nothing.** With `TELEMETRY_BACKEND` unset: no new allocations on the hot path beyond one global lookup per tee, `@open-mercato/telemetry` is never imported, and existing tests pass unchanged.
- [ ] **A telemetry failure cannot fail application work.** A provider that throws from `reportError` leaves the `integration_logs` row committed, the batch committed and the run's outcome unchanged — asserted by a test with a throwing provider.
- [ ] **No payload egress.** No reported error carries `integration_logs.payload`, adapter row content, or credentials; asserted by a test that puts a marker value in `payload` and a secret-looking key in the row, then inspects everything the provider received.
- [ ] **`packages/core` still does not depend on `@open-mercato/telemetry`** — the tees go through `getTelemetryRuntime()`; asserted by the existing decoupling test surface.
- [ ] **Existing `reportError` callers are behaviourally unchanged.** The API dispatcher and CRUD factory pass no `code` and keep reporting every 5xx exactly as today; `code` is absent on their reports rather than defaulted. Nothing in this spec makes an existing path emit less.

### Contract and docs

- [ ] `ReportErrorContext.code`, `TelemetryRuntime.reportError`'s `code`, and `TelemetryProvider.reportError?()` are additive and optional; `BACKWARD_COMPATIBILITY.md` records all three, including that `TelemetryProvider.reportError` MUST stay optional (third parties implement this interface).
- [ ] `data_sync.run.completed` gains four optional payload fields; no existing field changes.
- [ ] The rule is in `packages/telemetry/AGENTS.md`, `apps/docs/docs/framework/runtime/error-reporting.mdx`, and `.ai/review-checklist.md`; the root `AGENTS.md` router row is updated and **`yarn agents:check-budget` passes**.
- [ ] **No new environment variable.** Volume control is documented as a collector/backend concern in the docs page, so `.env.example` and the create-app template are untouched.

### Gate

- [ ] `yarn generate && yarn build:packages && yarn typecheck && yarn lint && yarn test` pass (the ordered `validation.commands` list in `.ai/agentic.config.json`).
- [ ] No UI-rendering file, no database structure change, no API-surface change, and automated tests for every behaviour above ship in the same PR — so the PR takes `skip-qa` under the automated-verification exemption in [`.ai/docs/pr-workflow.md`](../docs/pr-workflow.md). If any of those become untrue, it takes `needs-qa` instead.

## Contracts

### `packages/telemetry` (additive)

```ts
export type ReportErrorContext = {
  module?: string
  /** Stable, enumerated, low-cardinality fingerprint: `module.reason`. Never an interpolated message. */
  code?: string
  attributes?: Attributes
}
```

`TelemetryProvider` gains optional `reportError?()` as in [S4](#s4--optional-provider-error-hook). Required methods are untouched.

### `packages/shared` (additive)

`TelemetryRuntime['reportError']`'s context gains `code?: string` (`lib/telemetry/runtime.ts:47-53`). The runtime bridge is constructed from the facade (`packages/telemetry/src/init.ts:123`), so no wiring changes.

### `core:integrations` (additive)

`IntegrationLogError` exported from the module. `LogInput` is unchanged — `code` already exists (`log-service.ts:37`) and merely becomes load-bearing.

### `core:data_sync` (additive)

`data_sync.run.completed` payload gains `createdCount` / `updatedCount` / `skippedCount` / `failedCount` (all optional). `SyncRunPartialFailureError` exported. Per-item `data.errorCode` per [P1](#prerequisite-p1).

### Codes introduced

| Code | Raised at |
|---|---|
| `integrations.log_error` | `integrationLogService.write()` fallback when the row carries no `code` |
| `payment_gateways.status_poll_failed` | the payment status poller's per-transaction failure, so it groups apart from the catch-all |
| `data_sync.item_failed` / `data_sync.export_item_failed` | per-item failure with no adapter-supplied code |
| `data_sync.run_failed` | run fault (import and export). Splits into `data_sync.run_transient` / `data_sync.run_terminal` when part 6's `classifySyncError` lands — one constant in `sync-engine.ts` is the only site to change |
| `data_sync.run_partial_failure` | `finalizeRun`, `completed` with `failedCount > 0` |
| `data_sync.coverage_refresh_failed` | rejected coverage refresh |
| `queue.job_failed` / `queue.job_exhausted` | a handler that threw with retries remaining; the attempt that dead-letters the job. Mutually exclusive — one report per failure, on both strategies |
| `queue.worker_error` / `queue.abandon_sweep_failed` / `queue.abandon_report_failed` / `queue.abandon_ack_failed` | worker-level fault; the abandonment sweep and its two report failures |

## Configuration

**None.** No env var is added, and `TELEMETRY_BACKEND` continues to be the only switch that matters: off means off, on means every error is reported.

Volume, sampling and quota controls stay where they already exist and where the deployment's budget is known — the collector pipeline, or the backend's own limits. The docs page names the concrete levers (collector filter/sampling processors; Sentry `sampleRate`, spike protection and per-key rate limits; New Relic drop rules and ingest quotas) so an operator who needs one is not left to invent it in application code.

## Privacy

Inherits the telemetry spec's **don't-emit** posture with the active `redactPii`/`redactAttributes` backstop (`facade/redact.ts`), and adds one hard boundary: **`integration_logs.payload` is never reported.** The tee sends the row's `message`, its `code` and opaque ids (`integrationId`, `runId`, `scopeEntityType`, `scopeEntityId`). Row messages are adapter-authored free text and can pick up an email or a token a layer down, which is exactly what the existing backstop is for — and the provider boundary redacts again. `code` is enumerated by construction, so it cannot carry data.

## Implementation Plan

### Phase 1 — the rule and the chokepoints (ships value with any OTLP backend today)

1. **`code` passthrough.** Add `code?: string` to `ReportErrorContext` and to the shared `TelemetryRuntime` context; stamp `error.code` on the span exception and log record; label `om.errors{module, code}`. Unit tests: code present / absent, label shape.
2. **`integrations` tee.** `IntegrationLogError`; the post-flush tee in `write()`; wrapped so a throwing provider cannot fail the write. Tests: error level tees, info/warn do not, `payload` never egresses, throwing provider is swallowed, telemetry-off is a no-op.
3. **`queue` tee.** `reportError` alongside the existing `logger.error` at the four failure paths in `strategies/async.ts` and `strategies/local.ts`. Tests per strategy.
4. **`data_sync` codes.** Per-item `code` (consuming [P1](#prerequisite-p1) or adding the contract), run-fault codes from part 6's classifier, the `data_sync.run_partial_failure` report in `finalizeRun`, the coverage-refresh rejection report, and the four additive `run.completed` payload fields. Tests: each code appears with the right attributes; the partial-failure report fires exactly once per run; `operationalTelemetry: false` still reports.
5. **Rule + docs.** `packages/telemetry/AGENTS.md` bullet; `apps/docs/docs/framework/runtime/error-reporting.mdx`; byte-neutral root router row (`yarn agents:check-budget` must pass); `.ai/review-checklist.md` section; `BACKWARD_COMPATIBILITY.md` entries.

### Phase 2 — policy and pluggability (additive to the contract)

6. **Re-entrancy guard.** A per-async-context flag in `report-error.ts` that no-ops a nested `reportError`. Tests: a throwing provider hook does not recurse and does not lose the original report.
7. **Provider hook.** Optional `reportError?()` on `TelemetryProvider`; facade calls it additively; `packages/telemetry/README.md` recipe. Tests: provider with and without the hook; serialized+redacted payload only.
8. **Volume-control docs.** The collector/backend levers in `error-reporting.mdx`, with the reasoning from [S3](#s3--fingerprint-policy-report-everything) compressed to a paragraph. No UPGRADE_NOTES entry is needed: no existing path changes what it emits.

Both phases are additive and independently deployable; Phase 1 is useful without Phase 2, and Phase 2 does not depend on part 6.

### File manifest

| File | Action | Purpose |
|---|---|---|
| `packages/telemetry/src/facade/report-error.ts` | Modify | `code` attribute + metric label, re-entrancy guard, provider hook |
| `packages/telemetry/src/types.ts` | Modify | Optional `TelemetryProvider.reportError?()` |
| `packages/telemetry/{AGENTS.md,README.md}` | Modify | The rule; custom-provider recipe |
| `packages/shared/src/lib/telemetry/runtime.ts` | Modify | `code` in the bridge context type |
| `packages/core/src/modules/integrations/lib/log-service.ts` | Modify | The tee |
| `packages/core/src/modules/integrations/lib/log-service.ts` | Modify | `IntegrationLogError` lives beside the service that raises it, per the module's own convention (`CredentialsEncryptionUnavailableError` in `credentials-service.ts`) rather than a new `errors.ts` |
| `packages/queue/src/strategies/{async,local}.ts` | Modify | Job-failure tees |
| `packages/core/src/modules/data_sync/lib/sync-engine.ts` | Modify | Codes, partial-failure report, coverage-refresh report, run.completed counts |
| `apps/docs/docs/framework/runtime/error-reporting.mdx` | Create | Long-form policy |
| `AGENTS.md`, `.ai/review-checklist.md`, `BACKWARD_COMPATIBILITY.md` | Modify | Routing, review gate, contract record |

## Test Coverage

No API route, database structure or UI file changes, so the coverage is unit/behavioural against a fake provider — the harness `packages/telemetry/src/__tests__/telemetry.test.ts` already establishes (`registerProvider` + `initTelemetry`, asserting on captured signals). Every DoD line above maps to one of:

| Test | Location |
|---|---|
| `code` on span/log/metric; absent `code` leaves existing callers unchanged; N identical errors produce N reports | `packages/telemetry/src/__tests__/report-error.test.ts` |
| Re-entrancy guard: a provider hook that reports from inside the sink neither recurses nor loses the original report | `packages/telemetry/src/__tests__/report-error.test.ts` |
| A provider hook that **throws** does not escape `reportError`, and the span exception, error log and `om.errors` sample all still land | `packages/telemetry/src/__tests__/report-error.test.ts` |
| Provider hook called with serialized+redacted error; absent hook is fine | `packages/telemetry/src/__tests__/report-error.test.ts` |
| `error` tees / `info`+`warn` do not / `payload` withheld / throwing provider swallowed / telemetry-off no-op | `packages/core/src/modules/integrations/lib/__tests__/log-service.test.ts` |
| Job failure, exhaustion and abandon-sweep report per strategy; exactly one report per failure; a per-job `attempts` override decides exhaustion | `packages/queue/src/__tests__/` |
| Per-item, run-fault, partial-failure and coverage-refresh reports; `operationalTelemetry: false` still reports; `operationalTelemetry: true` reports the fault exactly once; a malformed adapter `errorCode` falls back; `run.completed` counts | `packages/core/src/modules/data_sync/lib/__tests__/sync-engine*.test.ts` |
| `packages/core` does not import `@open-mercato/telemetry` | `packages/core/src/__tests__/module-decoupling.test.ts` |

An end-to-end integration test is deliberately not added: the observable surface is a telemetry backend, not an HTTP response or a page, so a Playwright test would assert on nothing the framework owns. The manual verification recipe (`TELEMETRY_BACKEND=console`, run a failing import, read the console provider's output) goes in the docs page.

## Risks & Impact Review

#### Telemetry failure breaks a sync
- **Scenario**: the active provider throws or blocks inside a tee; the tee is on the path of a committed `integration_logs` write inside a running batch.
- **Severity**: High if unmitigated
- **Affected area**: `data_sync` batches, payment status polling, webhook processing
- **Mitigation**: every tee is `try/catch`-wrapped, logs at `warn`, and fires *after* the row is flushed. Tested with a throwing provider. `reportError` itself is synchronous and non-blocking; the OTLP provider batches and never awaits export inline.
- **Residual risk**: a provider that blocks synchronously for a long time would slow a batch. Bounded by the provider contract (sink-style, non-blocking) and unchanged from today's `logger.error` path.

#### PII egress through row messages
- **Scenario**: an adapter writes an error row whose message embeds a customer email or an upstream token; the tee ships the message to a third-party backend.
- **Severity**: High
- **Affected area**: privacy/GDPR posture
- **Mitigation**: `payload` is never sent; `redactPii` runs on message and stack at the facade and again at the provider boundary; the docs page states the "message is exported, payload is not" boundary so adapter authors know where detail belongs. A test asserts a marker in `payload` never appears in anything the provider receives.
- **Residual risk**: a novel identifier shape (a phone number, a national id) in an adapter-authored message is not caught by the email/token patterns. Same residual risk the existing `logger.error` path already carries; extending the pattern set is the documented response.

#### Cost and volume at the backend
- **Scenario**: a broken upstream fails every item of a large import; the tenant reports tens of thousands of errors in a day, driving ingest cost at a paid backend.
- **Severity**: Low
- **Affected area**: the operator's telemetry bill; under sustained flood, the SDK's export queue
- **Mitigation**: reported volume is bounded by what already happens — one report per `integration_logs` row the code writes anyway, so the ceiling is the row count, not a new multiplier. Beyond that the controls are the ones that own this concern: collector-side filtering or sampling, and the backend's quota/spike protection. Both are deployment-level and need no release. The SDK's batch processors shed load rather than growing unboundedly, and the 128-events-per-span cap bounds span growth.
- **Residual risk**: an operator who configures none of those pays for the flood on the first bad day, and the SDK may shed some records. Accepted deliberately: the alternative — dropping errors in the framework — makes the flood invisible instead of expensive, and invisible is the failure mode this spec exists to fix. The docs page names the levers.

#### Grouping degrades if a `code` is wrong
- **Scenario**: a contributor passes an interpolated string as `code` (`` `import failed for ${id}` ``), so every occurrence is its own group at the backend and `om.errors` gains unbounded label cardinality.
- **Severity**: Medium
- **Affected area**: backend grouping; metric cardinality at the collector
- **Mitigation**: the rule is stated where it is read (`packages/telemetry/AGENTS.md`, the docs page) and is one of the two review-checklist boxes; the `code` values in use are enumerated in this spec's table, so review has a reference list. `module` remains a bounded label even if `code` is abused.
- **Residual risk**: a bad `code` reaches production between merge and the next review pass. Bounded and reversible — it is a one-line fix with no data migration, unlike a suppressed error, which is gone.

#### Tenant isolation
- **Scenario**: reported attributes leak one tenant's identifiers into another's view.
- **Severity**: Low
- **Affected area**: telemetry backend
- **Mitigation**: telemetry is a single deployment-wide sink by design (the telemetry spec's model); attributes carry opaque `tenantId`/`organizationId`/`integrationId` only, never names or content, and metric labels carry no ids at all. No cross-tenant query surface is introduced.
- **Residual risk**: none beyond the existing telemetry posture.

## Out of scope — named owners

Q5's remaining catch-and-record sites, from part 2's catalogue, each a follow-up issue rather than a design here (one deployable capability per spec):

| Site | Owner module | Note |
|---|---|---|
| Event bus handler / global-tap / cross-process publish errors (`packages/events/src/bus.ts:292-296`, `:446-447`, `:483-484`) | `events` | Currently logged; needs `code` + reporting semantics |
| `failed-delivery-notification` (WH-8) | `webhooks` | Recorded as a notification only |
| Channel inbound failures (CC-7) | `communication_channels` | Recorded per message |
| Heartbeat / cancellation timer ticks (`sync-engine.ts:194`, `:220`), `closeQuietly` (`batch-stream.ts:38-45`) | `data_sync` | Deliberately `warn` today; decide per site whether a repeated tick failure deserves a report |
| An advisory `yarn telemetry:check-swallow` static check | tooling | Only if the review checklist proves insufficient |

## Final Compliance Report — 2026-09-08

### AGENTS.md files reviewed
- `AGENTS.md` (root), `packages/telemetry/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/core/AGENTS.md`, `packages/core/src/modules/data_sync/AGENTS.md`, `packages/core/src/modules/integrations/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/events/AGENTS.md`, `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`

### Compliance matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| root | No direct ORM relationships between modules | Compliant | No entity or relation added |
| root | Filter by `organization_id` | Compliant | No new query; the tee reads the row it just wrote |
| root | Never hard-code user-facing strings | Compliant | No user-facing string; telemetry text is internal |
| root | Modules stay isomorphic and independent | Compliant | `core` reaches telemetry only through the shared runtime bridge |
| root | Event payloads: additive optional fields only | Compliant | Four optional counts on `data_sync.run.completed` |
| root | `.env.example` edits mirror into the create-app template | Compliant | Explicit plan step (`yarn template:sync:fix`) |
| root | AGENTS.md instruction budget | Compliant | Byte-neutral router row; canonical text in the package guide; gate must pass |
| `telemetry` | Never emit PII, credentials, record content, request bodies | Compliant | `payload` withheld; double redaction |
| `telemetry` | Keep metric labels low-cardinality | Compliant | `om.errors{module, code}`; ids on span attributes only |
| `telemetry` | Telemetry must extend the shared logger, not add a logger | Compliant | Suppression summary uses `createLogger` |
| `telemetry` | Keep host integration default-unloaded | Compliant | Tees go through `getTelemetryRuntime()`; no static import |
| `telemetry` | OTEL packages importable only by the OTLP provider | Compliant | Facade-only changes |
| `shared` | Narrow typed interfaces; no `any` | Compliant | `code?: string`; serialized error shape is explicit |
| BACKWARD_COMPATIBILITY | Interfaces: optional additions only | Compliant | `TelemetryProvider.reportError?` optional and recorded |
| `.ai/qa` | Integration coverage for affected API/UI paths | N/A | No API or UI path changes; rationale stated in Test Coverage |

### Internal consistency

| Check | Status | Notes |
|---|---|---|
| Codes table covers every reporting site in the solution | Pass | Nine codes, each mapped to a site |
| DoD lines each have a named test or command | Pass | See Test Coverage table and the gate |
| Risks cover every new write/emit path | Pass | Tees, provider hook, payload boundary, `code` misuse |
| Contracts match the file manifest | Pass | |
| Phasing is independently deployable | Pass | Phase 1 useful without Phase 2; neither blocks on part 6 |

### Non-compliant items
None.

### Verdict
Fully compliant — ready for review, then implementation.

## Changelog

### 2026-09-08 — review round 1

Findings from the code review on PR #5960, all applied:

- **The facade's own provider hook was unguarded** — the one place the spec's "a telemetry failure cannot fail application work" did not hold, because the three new chokepoints were wrapped but `reportError` itself was not. A third-party `reportError?()` that threw would have escaped into the API dispatcher's 5xx catch (losing the duration metric, the `application.request.failed` event and the original error) and the CRUD factory's 500 (losing `x-request-id`). Now wrapped, degrading to a `warn`, with a test asserting the built-in span/log/metric path still lands.
- **An adapter's `data.errorCode` reached the metric label unvalidated.** It is now shape-checked against `module.reason` and falls back otherwise: metric labels are unbounded in cardinality and, unlike attributes, never pass through redaction.
- **Two covered writers reported no cause** — the payment status poller and the Stripe webhook processor put it in `payload`, which the tee deliberately withholds. The cause moved into the message; the poller also gained its own `code`.
- **A run fault double-reported** under `operationalTelemetry`. The operational status row no longer carries the fault's `code` (and `writeOperationalLog` no longer takes one at all).
- **`queue.job_exhausted` was documented for both strategies but only emitted by `local`**, and `local` emitted it *in addition to* `queue.job_failed`, double-counting the final attempt. Both strategies now report a job failure exactly once, coded `queue.job_exhausted` on the attempt that dead-letters it. `jobName` is dropped from the attribute list — `QueuedJob` has no name.
- **One spelling for the fingerprint attribute**, `error.code`, on the span, the log record and the metric label; and it is no longer duplicated into the attributes handed to a provider hook.
- `.ai/review-checklist.md`'s tail renumbered (the duplicate `## 22` predated this PR).

### 2026-09-08 — implemented
Phases 1 and 2 shipped together on `jtomaszewski/error-reporting-policy-impl`; the full gate (`generate`, `build:packages`, `typecheck`, `lint`, `i18n:check-sync`, `i18n:check-usage`, `test`, `build:app`, `agents:check-budget`) is green, with 25 new unit tests across `telemetry`, `core:integrations`, `core:data_sync` and `queue`.

Deviations from the design above, deliberate:
- **Run faults use one code**, `data_sync.run_failed`, until part 6's `classifySyncError` exists to split it. A single constant in `sync-engine.ts` is the change surface when it lands.
- **Three queue codes beyond the design** — `queue.worker_error`, `queue.abandon_report_failed`, `queue.abandon_ack_failed` — because those `logger.error` sites have the same "recorded, never reported" shape as the two the design named.
- **`IntegrationLogError` lives in `log-service.ts`**, matching the module's existing convention, not a new `lib/errors.ts`.
- **The re-entrancy guard is a module-level flag, not async-context state.** `reportError` is synchronous end to end, so a nested call can only arrive inside the same synchronous frame; `AsyncLocalStorage` would buy nothing and cost an allocation on the error path.
- **`data_sync/AGENTS.md` gained the adapter-facing `data.errorCode` contract** (one bullet), so adapter authors meet it where they already read.
- An adapter with `operationalTelemetry: true` writes two error rows for one run fault, and the tee's contract is one report per error row. Only the direct write carries `data_sync.run_failed`; the operational status row carries no `code` and therefore reports under the `integrations.log_error` catch-all, so the fault raises exactly one issue under its own fingerprint. The second, catch-all-coded report is the honest cost of keeping the chokepoint unconditional — an error row that is not reported would be a hole in the rule this spec exists to state.

### 2026-09-08
- Skeleton with Open Questions (gate).
- Resolved Q1–Q5 as recommended and completed the spec: the rule, three chokepoint tees, the aggregated per-run report, fingerprint policy, the optional provider hook, Definition of Done, test coverage, risk register and compliance report.
- **Reversed Q4 after review** (*"why bother with a rate limit — Sentry/SigNoz/New Relic do throttling and fingerprinting anyway"*): the per-fingerprint rate limit, its `TELEMETRY_ERROR_RATE_LIMIT` env var, the suppression counter and `facade/error-policy.ts` are all removed. Every error is reported. `code` stays — and gains a sharper justification: the tee synthesizes one error class at one line, so without an explicit discriminator the backends' own stack/class-based grouping collapses every integration error into a single issue. Volume control is documented as a collector/backend concern. What survived: the aggregate per-run report (a distinct fact, never a volume mitigation) and a re-entrancy guard (a correctness guard, no config).
- Added during completion, from verification against `develop`: the queue job-failure tee (`async.ts:417`, `local.ts:495`) and the dropped `Promise.allSettled` in `refreshCoverageSnapshots` as reporting sites; the `adapter.operationalTelemetry` gate (one adopting adapter in-repo) as the reason run-level reporting cannot live in `writeOperationalLog`; the 8-byte root `AGENTS.md` budget as the constraint on where the rule is documented; `gateway_stripe`'s webhook processor as a second existing `code` writer.
