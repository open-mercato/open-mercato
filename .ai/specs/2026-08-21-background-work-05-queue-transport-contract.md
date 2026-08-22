# Background work, part 5 — the queue transport contract

**Date**: 2026-08-21
**Status**: Draft v1 — implementation spec split out of part 4 v3 (§5.8, Phase 0). Awaiting review. Depends on nothing in the series; blocks part 6.
**Series**: [part 1](./2026-08-21-background-work-01-data-sync-problems.md) — `data_sync` problems (D-n) · [part 2](./2026-08-21-background-work-02-sibling-modules-problems.md) — sibling modules (Q/P/W/S/… ids) · [part 3](./2026-08-21-background-work-03-common-problems-and-requirements.md) — classes C-1…C-14, requirements R-A…R-M, open decisions Δ-1…Δ-11 · [part 4](./2026-08-21-background-work-04-solution.md) — options, decision, shared invariants · [part 5](./2026-08-21-background-work-05-queue-transport-contract.md) — queue transport contract · [part 6](./2026-08-21-background-work-06-leased-jobs-in-progress.md) — leased tier in `progress` · [part 7](./2026-08-21-background-work-07-data-sync-adoption.md) — `data_sync` adoption · [part 8](./2026-08-21-background-work-08-operator-surface.md) — operator surface.
**Scope of this spec**: additive capabilities on `packages/queue` (`EnqueueOptions`, `JobContext`, `Queue` members, a capabilities descriptor, an unrecoverable-error class), the `mercato worker` runner's shutdown relay, and a conformance suite run against both strategies. No `progress` change, no schema, no new behaviour for existing callers. The unrelated production bugs v3 had attached to this phase (PG-1/SC-1/ST-1 payload-shape mismatches and the rest of part 3 §0.1) are **not** in scope — each has its own ticket; the `data_sync` hardening that only needs these options (`queueJobId`, stall default) is part 7 step 0.

## 📝 TLDR

The leased tier (part 6) needs four things from the transport it cannot get today: a deterministic job id with dedup, a per-delivery `AbortSignal` that fires on shutdown and lock loss, a way to hand a delivery back with a rewritten payload without spending an attempt (`yield`), and a bounded `close()` that the runner calls after relaying SIGTERM. Everything else (`upsertRepeatable`, `getJobState`, `removeJob`, `QueueUnrecoverableError`, capabilities) is what makes the reconciler and cancel cheap on BullMQ and honest on the local strategy. All additions are optional members or optional options; at-least-once delivery stays the only hard requirement of the contract, and a conformance suite parameterised by strategy is what makes "the local strategy behaves like BullMQ" a tested claim instead of a hope (R-J1–J4).

## 📝 Problem Statement

Part 2 §Q: the processor is one-argument so BullMQ never creates a signal (Q-1); `lockRenewalFailed` has no listener (Q-26); `close()` is unbounded (Q-2); no custom job ids, attempts or backoff are exposed (Q-3, Q-12); there is no conformance suite so local and async drift (Q-15, Q-17). Part 3 C-8 (a lost lock is not a stopped handler) and C-3 (shutdown is not a signal) are the classes.

## 📝 Contract additions (all additive)

- `EnqueueOptions` gains `queueJobId?`, `attempts?`, `backoff?: { type: 'exponential' | 'fixed'; delay: number; maxDelay?: number }` beside the existing `delayMs`. Async maps to BullMQ `jobId`/`attempts`/`backoff`/`delay`; local dedups `queueJobId` against pending rows and honours `delayMs` via `notBefore`. (R-F5 is partial on BullMQ: `attempts`/`backoff` are frozen at enqueue; per-kind changes apply to new deliveries.)
- `JobContext` gains `signal: AbortSignal` (async: BullMQ 6.0.9 creates a per-job `AbortSignal` only when the processor is a *literal* three-parameter function (`(job, token, signal) =>`, no defaults/rest) — today's processor is one-argument, so no signal exists (C-8). BullMQ does **not** abort that signal by itself on lock-renewal failure: it emits `lockRenewalFailed` on the worker and keeps the processor running. The strategy therefore registers the `lockRenewalFailed` listener and aborts the job's signal from it, and additionally aborts on `close()` timeout; local: aborted on `close()`), `token: string | undefined`, and `yield(opts: { data: T; delayMs?: number }): Promise<never>`. Async: `job.updateData(data)` → `job.moveToDelayed(Date.now() + delayMs, token)` → throw `DelayedError` (the strategy's processor rethrows it untouched). Local: the batch loop catches a `LocalYield` sentinel, writes the job back with the new payload and `notBefore`, and leaves `attemptCount` unchanged.
- `Queue.close({ timeoutMs })`: async waits up to `timeoutMs`, then `close(true)`; the runner relays SIGTERM to every in-flight `signal` **first**, then calls `close` with `QUEUE_CLOSE_TIMEOUT_MS` (default 25 s; docs: Kubernetes `terminationGracePeriodSeconds ≥ 35`, Railway `RAILWAY_DEPLOYMENT_DRAINING_SECONDS ≥ 35`).
- `Queue.upsertRepeatable(id, { everyMs })` (async: `upsertJobScheduler`; local: bucketed ids + boot timer, see the per-strategy table below) and `Queue.getJobState?(id)`; `Queue.removeJob(queueJobId)`; `QueueUnrecoverableError` (async → BullMQ `UnrecoverableError`; local stops retrying); a `QueueCapabilities` descriptor `{ dedup, delay, retry, signal, yield, repeatable, jobState, removeJob, abandonReports }` per strategy, logged once at boot.
- **Transport contract**: at-least-once delivery is the only hard requirement; every other capability has a defined fallback through `claim` (invariant 5) or the reconciler. `packages/queue/src/__tests__/conformance/` holds one suite parameterised by strategy — delivery; duplicate/late/early/lost delivery; kill mid-handler; two consumers; `signal` on close; `yield` leaves the attempt counter unchanged and redelivers the rewritten payload; unrecoverable error — run for **both** local and async in CI (R-J2).
- Typed payloads end-to-end: `createModuleQueue<T>()` is already generic; this spec adds a helper so enqueue sites and workers share one `T` (R-J3; the PG-1 class).

## 📝 Contracts (category 2/3, STABLE — optional members only)

```ts
export type EnqueueOptions = {
  delayMs?: number                                   // existing
  queueJobId?: string                                // deterministic id; dedup against live jobs on both strategies
  attempts?: number
  backoff?: { type: 'exponential' | 'fixed'; delay: number; maxDelay?: number }
}

export interface JobContext<T = unknown> {
  jobId: string; attemptNumber: number; queueName: string   // existing (packages/queue/src/types.ts:29-36); attemptNumber's per-strategy semantics are Q-4
  signal: AbortSignal                                // aborted on shutdown (both), lock-renewal failure (async), close timeout (async)
  token?: string                                     // async: BullMQ token; local: undefined
  yield(opts: { data: T; delayMs?: number }): Promise<never>   // rewrites the stored payload, hands the delivery back, never returns
}

export interface Queue<T = unknown> {
  // …existing members unchanged…
  close(opts?: { timeoutMs?: number }): Promise<void>
  removeJob?(queueJobId: string): Promise<boolean>
  upsertRepeatable?(id: string, opts: { everyMs: number; data?: T }): Promise<void>
  getJobState?(queueJobId: string): Promise<'waiting' | 'delayed' | 'active' | 'completed' | 'failed' | 'unknown'>
  capabilities(): QueueCapabilities
}

export type QueueCapabilities = {
  dedup: boolean; delay: boolean; retry: boolean; signal: boolean; yield: boolean
  repeatable: boolean; jobState: boolean; removeJob: boolean; abandonReports: boolean
}

export class QueueUnrecoverableError extends Error {}   // async → BullMQ UnrecoverableError; local: no further attempts
```

**Minimum BullMQ version: 6.0.0.** Two capabilities this spec relies on do not exist across the whole `^5.0.0 || ^6.0.0` range `packages/queue` and `packages/scheduler` currently declare as an optional peer: `upsertJobScheduler` (behind `upsertRepeatable`, which part 6 hosts its *only* repairer on) and the per-job `AbortSignal` for a literal three-argument processor. A host satisfying the published range with an older 5.x would install the leased tier and get no orphan repair — worse than today. Therefore:

- the peer range in `packages/queue/package.json` and `packages/scheduler/package.json` is narrowed to `"bullmq": "^6.0.0"` in this spec (listed in the compatibility table below; UPGRADE_NOTES entry; `apps/mercato` already resolves 6.0.9);
- `capabilities()` is **feature-detected at strategy construction**, not a static table: `repeatable = typeof Queue.prototype.upsertJobScheduler === 'function'`, `signal` from the installed major, `jobState`/`removeJob` likewise. The table below is what the detection yields on ≥ 6.0.0;
- consumers that *require* a capability fail fast: part 6's worker boot refuses to register a leased kind when `capabilities().repeatable || signal` is false, with an error naming the installed version and the floor, instead of running without a repairer.

Per-strategy behaviour:

| Capability | async (BullMQ ≥ 6.0.0; verified against 6.0.9) | local (SQLite/in-process) |
|---|---|---|
| `queueJobId` dedup | BullMQ `jobId`; an add with an id that exists in any non-removed state is a no-op (including retained `failed` — which is why part 6 never reuses an id) | unique on `(queue, job_id)` over pending/active rows |
| `attempts`/`backoff` | `attempts`/`backoff` on add; frozen at enqueue | stored per job; honoured by the batch loop |
| `signal` | created by BullMQ for the 3-arity processor; aborted by the strategy on `lockRenewalFailed` (listener registered per worker) and on `close()` timeout; aborted by the runner on SIGTERM | `AbortController` per delivery; aborted on `close()` and SIGTERM |
| `yield` | `job.updateData(data)` → `job.moveToDelayed(Date.now() + delayMs, token)` → throw `DelayedError`, rethrown untouched by the processor; `attemptsMade` unchanged; the job id is unchanged | `LocalYield` sentinel caught by the batch loop; payload and `notBefore` rewritten; `attemptCount` unchanged |
| `close({ timeoutMs })` | wait ≤ `timeoutMs` for in-flight jobs, then `close(true)` | wait ≤ `timeoutMs`, then abandon the in-flight batch |
| `upsertRepeatable` | `upsertJobScheduler(id, { every })` — idempotent across replicas, survives individual run failures | bucketed deterministic ids `<id>-<bucket+1>` enqueued at the start of each run in `try/finally` plus an unref'd boot timer that re-adds the next bucket (self-heal) |
| `getJobState` | `Queue.getJobState` | row lookup |
| `removeJob` | `job.remove()`; a locked active job is not removable — returns `false` | deletes the pending row; `false` when active |

**Runner (`mercato worker --all`)**: on SIGTERM/SIGINT relay to every in-flight `signal` **first**, then `close({ timeoutMs: QUEUE_CLOSE_TIMEOUT_MS })` (default 25 s). Docs state the platform grace the default assumes: Kubernetes `terminationGracePeriodSeconds ≥ 35`, Railway `RAILWAY_DEPLOYMENT_DRAINING_SECONDS ≥ 35`.

**Typed payloads** (R-J3): `createModuleQueue<T>()` is already generic; a `defineQueueJob<T>(queue)` helper returns `{ enqueue, worker }` sharing one `T` so enqueue sites and workers cannot drift. Adopting it at the PG-1/SC-1/ST-1 call sites is part of *those* tickets, not this spec.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|---|---|
| SIGTERM with a yielding handler | runner aborts `signal` → handler yields at its next durable boundary → `close()` returns before the timeout; the delivery is redelivered with the rewritten payload and the same attempt counter |
| SIGTERM with a non-yielding handler | `close()` returns at `timeoutMs`; the job is redelivered by the transport's own stall/abandon path and costs one attempt — the price of not yielding, documented |
| Lock renewal fails, handler alive (async) | `lockRenewalFailed` → strategy aborts `signal`; BullMQ may redeliver the job to another worker while this one finishes its current step; correctness is the consumer's fence (part 6 invariant 3), not the transport's |
| `yield` after the lock is already lost (async) | `moveToDelayed(token)` throws; the delivery ends as a throw and costs one attempt; the payload was *not* rewritten, so the redelivery carries the old payload — consumers must tolerate that (part 6 invariant 5 refuses it by identity) |
| `upsertRepeatable` lost (Redis flush) | next worker boot re-creates it; until then the repeatable does not fire — consumers must state the consequence (part 6 §6) |
| Same `queueJobId` added while a retained `failed` job holds it (async) | no-op add; the consumer must use monotone ids (part 6 invariant 9) — the conformance suite asserts the no-op so the behaviour is visible |
| Strategy without `yield`/dedup/delay (future) | `capabilities()` says so at boot; consumers fall back (part 6 §9 row "Transport without …") |

## 📝 Backward compatibility review

| Surface (`BACKWARD_COMPATIBILITY.md`) | Change | Class |
|---|---|---|
| 2 exported types (`EnqueueOptions`, `JobContext`, `Queue`) | optional members added | ADDITIVE |
| 3 signatures | `close()` gains an optional options argument; processor arity inside the async strategy changes (internal) | ADDITIVE / internal |
| 12 CLI | `mercato worker` gains `QUEUE_CLOSE_TIMEOUT_MS`; exit sequence relays SIGTERM before close | ADDITIVE; UPGRADE_NOTES entry (deployment grace) |
| dependencies (optional peer) | `bullmq` peer range narrowed from `^5.0.0 \|\| ^6.0.0` to `^6.0.0` in `packages/queue` and `packages/scheduler` | **narrowing** — Ask-First item for maintainers; UPGRADE_NOTES entry; hosts on 5.x must upgrade before adopting this package version |
| 11 notification / 5 event ids | none | — |
| 8 DB schema | none (local strategy: one new nullable column `not_before` on its SQLite job table, created on open) | ADDITIVE, self-migrating |

Rollback: revert the package; no caller depends on the new members until part 6 or part 7 step 0 lands. The local strategy's extra column is ignored by the previous version.

## 📝 Risks & Impact Review

| Risk | Sev | Mitigation | Residual |
|---|---|---|---|
| 3-arity processor changes BullMQ's `signal` creation for **every** async worker | Low | the signal is only aborted by the strategy's own listeners; handlers that ignore `ctx.signal` behave exactly as today | — |
| SIGTERM relay + bounded close changes worker exit timing | Low | default 25 s is below the common 30 s grace; documented; env override | platforms with 0 s grace (Railway default) still SIGKILL — part 6's lease repairs it |
| `lockRenewalFailed` abort surprises a handler that would have finished | Low | the alternative is two live drivers (C-8); consumers that need to finish a step do so inside a fence | — |
| Conformance suite needs Redis in CI | Low | the CI already provisions Redis for integration lanes; the suite is tagged to run only there | — |

## 📋 Integration coverage

`packages/queue/src/__tests__/conformance/` — one suite, parameterised by strategy, run for **both** local and async (Redis service in CI):

1. delivery; duplicate add with the same `queueJobId` is a no-op (incl. against a retained failed job on async);
2. `delayMs` honoured; `attempts`/`backoff` honoured; `QueueUnrecoverableError` stops retries;
3. kill mid-handler (process exit) → redelivered; two consumers on one queue → each delivery processed once;
4. `signal` aborts within 100 ms of `close()`; on async, a simulated `lockRenewalFailed` aborts it;
5. `yield` leaves the attempt counter unchanged and redelivers the rewritten payload; `yield` after lock loss (async) throws and redelivers the old payload;
6. SIGTERM with a yielding handler exits < `timeoutMs`; non-yielding exits at `timeoutMs` and the job is redelivered;
7. `upsertRepeatable` fires on schedule, survives a failed run, and is re-created after a flush + boot (local: after a bucket gap);
8. `capabilities()` matches the table above for each strategy on ≥ 6.0.0; a unit test with a stubbed `Queue` lacking `upsertJobScheduler` yields `repeatable: false`.

## 📋 Implementation Plan

1. `EnqueueOptions.queueJobId/attempts/backoff`; async maps to BullMQ; local dedups and stores `notBefore`. Tests: dedup collapses; delay honoured; existing callers unchanged.
2. `JobContext.signal` + `token` (`attemptNumber` already exists); async literal 3-arity processor; the strategy registers `lockRenewalFailed` and aborts the job's signal from it (BullMQ does not do this itself) and on close timeout; local aborts on close. Test: handler observes abort within 100 ms of `close()`; async: within 100 ms of a simulated `lockRenewalFailed`.
3. `ctx.yield({ data })`: async `updateData` → `moveToDelayed(token)` → `DelayedError` rethrown by the processor; local `LocalYield` sentinel caught in the batch loop, payload rewritten, `attemptCount` unchanged. Tests on both strategies: attempt counter unchanged; redelivery carries the rewritten payload.
4. `close({ timeoutMs })`, `removeJob`, `upsertRepeatable` (BullMQ `upsertJobScheduler`; local bucketed ids + boot timer), `getJobState`, `QueueUnrecoverableError`, `QueueCapabilities` (logged once at boot); runner relays SIGTERM → signals → `close(QUEUE_CLOSE_TIMEOUT_MS)`. Test: SIGTERM with a yielding handler exits < timeout; non-yielding handler exits at timeout and the job is redelivered.
5. Conformance suite (above); capability table per strategy documented in `packages/queue/AGENTS.md`.
6. `defineQueueJob<T>` typed helper + docs; no call-site migration in this spec.
7. `packages/queue/AGENTS.md` (capabilities, shutdown contract, "never reuse a job id"), deployment-grace docs (K8s, Railway), `BACKWARD_COMPATIBILITY.md` and UPGRADE_NOTES entries.

## Open items for review

- Narrowing the `bullmq` peer range to `^6.0.0` (Ask-First: production-dependency change) vs keeping the range and relying on the feature-detected `capabilities()` + part 6's boot refusal alone. The spec proposes narrowing because a silent no-repairer install is the failure the series exists to remove.

- `QUEUE_CLOSE_TIMEOUT_MS` default 25 s vs 20 s: 25 s leaves 10 s of margin under a 35 s grace and 5 s under Kubernetes' 30 s default; the latter is tight when the handler's last durable boundary is a 5-second page.
- Whether Q-4's per-strategy semantics of the existing `attemptNumber` (async: `attemptsMade + 1`; local: its own counter) are fixed here as part of the conformance suite, or left to part 6's `failSlice`, which is its only new consumer (to compute `nextAttemptAt`).

## Changelog

- 2026-08-22 — Draft v1.1 after the second review (PR #5450): BullMQ floor stated (6.0.0) with the peer range narrowed in both packages and listed as a compat change; `capabilities()` is feature-detected, and consumers requiring a capability fail fast at boot; `attemptNumber` shown as the existing member it is, with the open item rephrased around Q-4.

- 2026-08-22 — Draft v1: split out of part 4 v3 §5.8 + Phase 0 after review (PR #5450). Corrected the BullMQ `signal` mechanics (BullMQ supplies the signal to a literal three-argument processor but does not abort it on lock-renewal failure; the strategy's `lockRenewalFailed` listener does — part 3 C-8 says the same). Removed the unrelated PG-1/SC-1/ST-1 fixes and the `data_sync` hardening step from this scope (separate tickets; part 7 step 0). Added the full contract listing, per-strategy table, compatibility review, rollback, and the conformance suite as integration coverage.
