# Background work, part 5 — queue transport hardening

**Date**: 2026-08-21
**Status**: Draft v2.0 — slimmed to what phase 1 (part 6) consumes: deterministic job ids, per-enqueue retry options, a per-delivery `AbortSignal`, bounded `close()` with a runner SIGTERM relay, repeatable-worker declaration, an unrecoverable-error class, and a conformance suite on both strategies. The leased-tier-only members of v1.x (`yield`, `capabilities()`, `getJobState`, boot refusal) are withdrawn from this spec and preserved with the leased-tier design at commit `205fbd53f`. Depends on nothing in the series; blocks part 6.
**Series**: [part 1](./2026-08-21-background-work-01-data-sync-problems.md) — `data_sync` problems (D-n) · [part 2](./2026-08-21-background-work-02-sibling-modules-problems.md) — sibling modules (Q/P/W/S/… ids) · [part 3](./2026-08-21-background-work-03-common-problems-and-requirements.md) — classes C-1…C-14, requirements R-A…R-M, the delivery-semantics premise · [part 4](./2026-08-21-background-work-04-solution.md) — options, decision, invariants, staging · [part 5](./2026-08-21-background-work-05-queue-transport-contract.md) — queue transport hardening · [part 6](./2026-08-21-background-work-06-data-sync-hardening.md) — phase 1: `data_sync` hardening.
**Scope of this spec**: additive capabilities on `packages/queue` (`EnqueueOptions`, `JobContext`, `Queue` members, an unrecoverable-error class, `WorkerMeta.repeatable`), the `mercato queue worker` runner's shutdown relay, and a conformance suite run against both strategies. No `progress` change, no schema, no new behaviour for existing callers. The unrelated production bugs earlier drafts had attached to this phase (PG-1/SC-1/ST-1 payload-shape mismatches and the rest of part 3 §0.1) are **not** in scope — each has its own ticket.

## 📝 TLDR

Phase 1 (part 6) needs four things from the transport it cannot get today: a deterministic job id with dedup (so the start relay and the reconciler's re-drives are idempotent), a per-delivery `AbortSignal` that fires on shutdown and lock loss (so the engine can stop at a batch boundary instead of being SIGKILLed), a bounded `close()` the runner calls after relaying SIGTERM, and a declared home for repeatable ticks (`WorkerMeta.repeatable`, which hosts the reconciler). `attempts`/`backoff` per enqueue, `removeJob`, `upsertRepeatable` and `QueueUnrecoverableError` are what make retry, cancel and the tick cheap on BullMQ and honest on the local strategy. All additions are optional members or optional options; at-least-once delivery stays the only hard requirement of the contract, and a conformance suite parameterised by strategy is what makes "the local strategy behaves like BullMQ" a tested claim instead of a hope (R-J1–J4).

## 📝 Problem Statement

Part 2 §Q: the processor is one-argument so BullMQ never creates a signal (Q-1); `lockRenewalFailed` has no listener (Q-26); `close()` is unbounded and a second SIGTERM is ignored (Q-15, Q-17); no per-job id or dedup key is expressible (Q-2); per-job attempts, backoff and fail-fast are not either (Q-3, Q-11, Q-12); repeatable schedules have no declared home on a worker (`WorkerMeta` has no boot hook, `packages/queue/src/types.ts:291-314`); and the two strategies drift unchecked because nothing exercises them against one contract (part 3 C-14 — every async test mocks `bullmq`; the local strategy's own divergences are Q-14, Q-16). Part 3 C-8 (a lost lock is not a stopped handler) and C-1 (interruption treated as failure — Q-15/Q-16's undrained shutdown) are the classes.

## 📝 Contract additions (all additive)

- `EnqueueOptions` gains `queueJobId?`, `attempts?`, `backoff?: { type: 'exponential' | 'fixed'; delay: number; maxDelay?: number }` beside the existing `delayMs`. Async maps to BullMQ `jobId`/`attempts`/`backoff`/`delay`; `backoff.maxDelay` has **no builtin BullMQ mapping** (6.0.9's builtin strategies take only `delay` and `jitter`, `backoffs.js:20-42`), so the async strategy registers one custom `settings.backoffStrategy` on every Worker it creates and maps `{ type: 'exponential', delay, maxDelay }` to `backoff: { type: 'om-exponential-capped', delay, maxDelay }` — the strategy computes `min(delay · 2^(attemptsMade − 1), job.opts.backoff.maxDelay)`; the extra field round-trips through the stored job opts, which conformance test 2 asserts. The local strategy is **JSON-file based** (`packages/queue/src/strategies/local.ts`, `StoredJob`), not SQLite: it already honours `delayMs` through `availableAt` and counts `attemptCount`; it gains `queueJobId` (dedup against stored jobs that are not yet finished), `attempts` and `backoff` fields on the same record and reuses `availableAt` for retry backoff. No schema, no column, no migration.
- `JobContext` gains `signal?: AbortSignal` — **optional on the exported interface** (in-repo tests build `JobContext` literals with only `{ jobId, attemptNumber, queueName }`, e.g. `messages/workers/__tests__/send-email.worker.handler.test.ts:72`, and a required member would break every such literal and any third-party test double) but **always populated by both in-repo strategies**. Async: BullMQ 6.0.9 creates a per-job `AbortSignal` only when the processor is a *literal* three-parameter function (`(job, token, signal) =>`, no defaults/rest) — today's processor is one-argument, so no signal exists (C-8). BullMQ does **not** abort that signal by itself on lock-renewal failure: it emits `lockRenewalFailed` on the worker and keeps the processor running. The strategy therefore registers the `lockRenewalFailed` listener and aborts the job's signal from it, and additionally aborts on `close()` timeout. Local: an `AbortController` per delivery, aborted on `close()` and SIGTERM. `JobContext` also gains `token?: string` (async: the BullMQ token; local: undefined).
- `Queue.close({ timeoutMs })`: async waits up to `timeoutMs`, then `close(true)`; the runner relays SIGTERM to every in-flight `signal` **first**, then calls `close` with `QUEUE_CLOSE_TIMEOUT_MS` (default 25 s; docs: Kubernetes `terminationGracePeriodSeconds ≥ 35`, Railway `RAILWAY_DEPLOYMENT_DRAINING_SECONDS ≥ 35`).
- `Queue.upsertRepeatable(id, { everyMs })` (async: `upsertJobScheduler`; local: bucketed ids + boot timer, see the per-strategy table below); `Queue.removeJob(queueJobId)`; `QueueUnrecoverableError` (async → BullMQ `UnrecoverableError`; local stops retrying).
- **Transport contract**: at-least-once delivery is the only hard requirement (R-J1). `packages/queue/src/__tests__/conformance/` holds one suite parameterised by strategy — delivery; duplicate/late/early/lost delivery; kill mid-handler; two consumers; `signal` on close; unrecoverable error; repeatable — run for **both** local and async in CI (R-J2).
- Typed payloads end-to-end: `createModuleQueue<T>()` is already generic; this spec adds a helper so enqueue sites and workers share one `T` (R-J3; the PG-1 class).

## 📝 Contracts (category 2/3, STABLE — optional members only; every addition below carries `?`, so an existing implementer or test literal keeps compiling)

```ts
export type EnqueueOptions = {
  delayMs?: number                                   // existing
  queueJobId?: string                                // deterministic id; dedup against live jobs on both strategies
  attempts?: number
  backoff?: { type: 'exponential' | 'fixed'; delay: number; maxDelay?: number }   // maxDelay: async → custom 'om-exponential-capped' strategy (see above); local → min() in the batch loop
}

export interface JobContext<T = unknown> {
  jobId: string; attemptNumber: number; queueName: string   // existing (packages/queue/src/types.ts:29-36); attemptNumber's per-strategy semantics are Q-4
  signal?: AbortSignal                               // optional on the interface (test literals, third-party doubles); both strategies set it; aborted on shutdown (both), lock-renewal failure (async), close timeout (async)
  token?: string                                     // async: BullMQ token; local: undefined
}

export interface Queue<T = unknown> {
  // …existing members unchanged…
  close(opts?: { timeoutMs?: number }): Promise<void>
  removeJob?(queueJobId: string): Promise<boolean>
  upsertRepeatable?(id: string, opts: { everyMs: number; data?: T }): Promise<void>
}

export class QueueUnrecoverableError extends Error {}   // async → BullMQ UnrecoverableError; local: no further attempts
```

**Minimum BullMQ version: 6.0.0.** Two capabilities this spec relies on do not exist across the whole `^5.0.0 || ^6.0.0` range `packages/queue` and `packages/scheduler` currently declare as an optional peer: `upsertJobScheduler` (behind `upsertRepeatable`, which hosts part 6's reconciler tick) and the per-job `AbortSignal` for a literal three-argument processor. A host satisfying the published range with an older 5.x would install phase 1 and get no reconciler and no cooperative shutdown — worse than today, silently. Therefore the peer range in `packages/queue/package.json` and `packages/scheduler/package.json` is narrowed to `"bullmq": "^6.0.0"` (compatibility table below; UPGRADE_NOTES entry; `apps/mercato` already resolves 6.0.9), and the async strategy fails fast at construction with an error naming the installed version and the floor when the resolved major is older.

Per-strategy behaviour:

| Capability | async (BullMQ ≥ 6.0.0; verified against 6.0.9) | local (JSON file, in-process) |
|---|---|---|
| `queueJobId` dedup | BullMQ `jobId`; an add with an id that exists in any non-removed state is a no-op (including retained `failed` — which is why part 6 §3a never reuses an id across re-drives). BullMQ 6.0.9 throws `Custom Id cannot contain :` for any id that contains a colon and does not split into exactly three parts (`job.js:907-910`) — every id in this series uses `-` | `queueJobId` stored on the `StoredJob` record; an add whose id matches a stored job that has not finished is a no-op |
| `attempts`/`backoff` | `attempts`/`backoff` on add; `maxDelay` via the custom `om-exponential-capped` strategy registered on the Worker; frozen at enqueue | stored on the record; the batch loop already sets `availableAt` from a backoff and counts `attemptCount` (`local.ts:479-506`); `maxDelay` is a `min()` there |
| `signal` | created by BullMQ for the 3-arity processor; aborted by the strategy on `lockRenewalFailed` (listener registered per worker) and on `close()` timeout; aborted by the runner on SIGTERM | `AbortController` per delivery; aborted on `close()` and SIGTERM |
| `close({ timeoutMs })` | wait ≤ `timeoutMs` for in-flight jobs, then `close(true)` | wait ≤ `timeoutMs`, then abandon the in-flight batch |
| `upsertRepeatable` | `upsertJobScheduler(id, { every })` — idempotent across replicas, survives individual run failures | bucketed deterministic ids `<id>-<bucket+1>` enqueued at the start of each run in `try/finally` plus an unref'd boot timer that re-adds the next bucket (self-heal) |
| `removeJob` | `job.remove()`; a locked active job is not removable — returns `false` | deletes the pending row; `false` when active |

**Runner (`mercato queue worker --all`)**: on SIGTERM/SIGINT relay to every in-flight `signal` **first**, then `close({ timeoutMs: QUEUE_CLOSE_TIMEOUT_MS })` (default 25 s). Docs state the platform grace the default assumes: Kubernetes `terminationGracePeriodSeconds ≥ 35`, Railway `RAILWAY_DEPLOYMENT_DRAINING_SECONDS ≥ 35`.

**Repeatable declaration (`WorkerMeta.repeatable?`)** — the named hook part 6's reconciler needs (no "boot" member exists on `WorkerMeta`, `packages/queue/src/types.ts:291-314`, so "every worker calls upsertRepeatable at boot" would have had nowhere to run). The worker descriptor gains one optional field, `repeatable?: { id: string; everyMs: number }` (category 2, ADDITIVE — compat table). Two consumers honour it: (1) the **runner** calls `queue.upsertRepeatable(repeatable.id, { everyMs })` immediately after binding any worker that declares it — in `--all` and single-queue modes alike — so every process that binds the worker re-asserts the schedule idempotently; (2) the **lazy auto-spawn supervisor** (`packages/cli/src/lib/queue-worker-supervisor.ts`, the dev default via `AUTO_SPAWN_WORKERS=true` + `OM_AUTO_SPAWN_WORKERS_LAZY=true`) treats a queue whose worker declares `repeatable` as **eager**: `shouldStartSharedWorker` (today wired only to enabled scheduler rows, `mercato.ts:2312-2315`) and the per-queue probe both return true for it, spawning the worker child at supervisor start instead of waiting for a READY job — a repeatable's first job cannot exist before some process upserts it, so lazy-only spawning would deadlock. A worker without the field behaves exactly as today.

**Typed payloads** (R-J3): `createModuleQueue<T>()` is already generic; a `defineQueueJob<T>(queue)` helper returns `{ enqueue, worker }` sharing one `T` so enqueue sites and workers cannot drift. Adopting it at the PG-1/SC-1/ST-1 call sites is part of *those* tickets, not this spec.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|---|---|
| SIGTERM with a signal-observing handler | runner aborts `signal` → the handler stops at its next durable boundary (part 6: after the batch commit, throwing `SyncInterruptedError`) → `close()` returns before the timeout; the transport redelivers |
| SIGTERM with a signal-ignoring handler | `close()` returns at `timeoutMs`; the job is redelivered by the transport's own stall/abandon path and costs one attempt — the price of ignoring the signal, documented |
| Lock renewal fails, handler alive (async) | `lockRenewalFailed` → strategy aborts `signal`; BullMQ may redeliver the job to another worker while this one finishes its current step; correctness is the consumer's fence (part 6 §3a and the `commitBatchProgress` CAS), not the transport's |
| `upsertRepeatable` lost (Redis flush) | next worker boot re-creates it (the runner upserts at bind time); until then the repeatable does not fire — consumers must state the consequence (part 6: a reconciler gap, repaired at the next tick after boot) |
| Same `queueJobId` added while a retained `failed` job holds it (async) | no-op add; consumers must use fresh ids per re-drive (part 6 §3a) — the conformance suite asserts the no-op so the behaviour is visible |

## 📝 Backward compatibility review

| Surface (`BACKWARD_COMPATIBILITY.md`) | Change | Class |
|---|---|---|
| 2 exported types (`EnqueueOptions`, `JobContext`, `Queue`, `WorkerMeta`) | optional members only: `queueJobId?`/`attempts?`/`backoff?`; `signal?`/`token?`; `close(opts?)`, `removeJob?`, `upsertRepeatable?`; `WorkerMeta.repeatable?` (runner upserts at bind time; lazy supervisor treats the queue as eager); existing test literals of `JobContext` and third-party `Queue`/worker implementations keep compiling | ADDITIVE |
| 3 signatures | `close()` gains an optional options argument; processor arity inside the async strategy changes (internal) | ADDITIVE / internal |
| 13 CLI | `mercato queue worker` gains `QUEUE_CLOSE_TIMEOUT_MS`; exit sequence relays SIGTERM before close | ADDITIVE; UPGRADE_NOTES entry (deployment grace) |
| dependencies (optional peer) | `bullmq` peer range narrowed from `^5.0.0 \|\| ^6.0.0` to `^6.0.0` in `packages/queue` and `packages/scheduler` | **narrowing** — Ask-First item for maintainers; UPGRADE_NOTES entry; hosts on 5.x must upgrade before adopting this package version |
| 11 notification / 5 event ids | none | — |
| 8 DB schema | none — the local strategy is a JSON file; its `StoredJob` record gains optional `queueJobId`/`attempts`/`backoff` fields and reuses the existing `availableAt` | — (optional fields on a file record; older code ignores them) |

Rollback: revert the package; no caller depends on the new members until part 6 lands. The local strategy's extra record fields are ignored by the previous version (it reads only the fields it knows).

## 📝 Risks & Impact Review

| Risk | Sev | Mitigation | Residual |
|---|---|---|---|
| 3-arity processor changes BullMQ's `signal` creation for **every** async worker | Low | the signal is only aborted by the strategy's own listeners; handlers that ignore `ctx.signal` behave exactly as today | — |
| SIGTERM relay + bounded close changes worker exit timing | Low | default 25 s is below the common 30 s grace; documented; env override | platforms with 0 s grace (Railway default) still SIGKILL — part 6's reconciler repairs it |
| `lockRenewalFailed` abort surprises a handler that would have finished | Low | the alternative is two live drivers (C-8); consumers that need to finish a step do so inside a fence | — |
| Conformance suite needs Redis in CI | Low | the CI already provisions Redis for integration lanes; the suite is tagged to run only there | — |

## 📋 Integration coverage

`packages/queue/src/__tests__/conformance/` — one suite, parameterised by strategy, run for **both** local and async (Redis service in CI):

1. delivery; duplicate add with the same `queueJobId` is a no-op (incl. against a retained failed job on async);
2. `delayMs` honoured; `attempts`/`backoff` honoured incl. `maxDelay` (async: the custom strategy reads the cap from the stored job opts); `QueueUnrecoverableError` stops retries;
3. kill mid-handler (process exit) → redelivered; two consumers on one queue → each delivery processed once;
4. `signal` aborts within 100 ms of `close({ timeoutMs: 0 })` — the async strategy aborts on the close *timeout* (contract above; the default 25 s would make a bare-`close()` bound meaningless), so the test pins the timeout to zero, while the local strategy aborts on `close()` itself; on async, a simulated `lockRenewalFailed` aborts it;
5. SIGTERM with a signal-observing handler exits < `timeoutMs`; a signal-ignoring handler exits at `timeoutMs` and the job is redelivered;
6. `upsertRepeatable` fires on schedule, survives a failed run, and is re-created after a flush + boot (local: after a bucket gap); a worker declaring `WorkerMeta.repeatable` has it upserted at bind time by the runner, and the lazy supervisor spawns that worker eagerly (no READY job required);
7. both strategies hand every delivery a `JobContext` with `signal` set (the member is optional on the type, never absent at runtime here); the async strategy fails fast at construction on BullMQ < 6.

## 📋 Implementation Plan

1. `EnqueueOptions.queueJobId/attempts/backoff`; async maps to BullMQ and registers the `om-exponential-capped` strategy for `maxDelay`; local dedups on `queueJobId` and stores `attempts`/`backoff` on the record (delay via the existing `availableAt`). Tests: dedup collapses; delay honoured; `maxDelay` caps the computed backoff on both strategies; existing callers unchanged.
2. `JobContext.signal?` + `token?` (`attemptNumber` already exists) — optional on the type, set by both strategies; async literal 3-arity processor; the strategy registers `lockRenewalFailed` and aborts the job's signal from it (BullMQ does not do this itself) and on close timeout; local aborts on close. Test: handler observes abort within 100 ms of `close({ timeoutMs: 0 })` (conformance test 4); async: within 100 ms of a simulated `lockRenewalFailed`.
3. `close({ timeoutMs })`, `removeJob`, `upsertRepeatable` (BullMQ `upsertJobScheduler`; local bucketed ids + boot timer), `QueueUnrecoverableError`; `WorkerMeta.repeatable?` honoured by the runner (upsert at bind time) and the lazy supervisor (eager spawn); runner relays SIGTERM → signals → `close(QUEUE_CLOSE_TIMEOUT_MS)`; async fail-fast on BullMQ < 6. Test: SIGTERM with a signal-observing handler exits < timeout; ignoring handler exits at timeout and the job is redelivered; a `repeatable`-declaring worker gets its schedule upserted without any job on the queue.
4. Conformance suite (above); per-strategy behaviour table documented in `packages/queue/AGENTS.md`.
5. `defineQueueJob<T>` typed helper + docs; no call-site migration in this spec.
6. `packages/queue/AGENTS.md` (shutdown contract, "never reuse a job id across re-drives"), deployment-grace docs (K8s, Railway), `BACKWARD_COMPATIBILITY.md` and UPGRADE_NOTES entries.

## Open items for review

- Narrowing the `bullmq` peer range to `^6.0.0` (Ask-First: production-dependency change) vs keeping the range and relying on the construction-time fail-fast alone. The spec proposes narrowing because a silent no-reconciler install is the failure the series exists to remove.
- `QUEUE_CLOSE_TIMEOUT_MS` default 25 s vs 20 s: 25 s leaves 10 s of margin under a 35 s grace and 5 s under Kubernetes' 30 s default; the latter is tight when the handler's last durable boundary is a 5-second page.
- Whether Q-4's per-strategy semantics of the existing `attemptNumber` (async: `attemptsMade + 1`; local: its own counter) are fixed here as part of the conformance suite, or deferred until a consumer needs them.

## Changelog

- **2026-08-25 — Draft v2.0**: slimmed to the phase-1 consumer set per the maintainer scope discussion on PR #5450. Withdrawn: `ctx.yield` (existed only for the leased tier's slice hand-back), `capabilities()`/`NO_CAPABILITIES`/`queueCapabilities` and the boot-refusal protocol (existed only for the leased tier's per-kind refusal — the narrowed peer range plus a construction-time fail-fast now carry the version floor), `getJobState` (the reconciler's §3a `job_id` CAS plus `queueJobId` dedup made it unnecessary). All withdrawn designs, including the verified BullMQ 6.0.9 `yield` mechanics (`updateData` un-fenced, `moveToFailed` token-fenced), are preserved at commit `205fbd53f` for the leased tier. Kept unchanged: everything phase 1 consumes, with its review-verified BullMQ citations (custom-id colon rule, `lockRenewalFailed` non-abort, builtin backoff caps, dedup vs retained failed jobs).
- 2026-08-24 — Draft v1.2 after the third, fifth, sixth, seventh, eighth and tenth reviews (PR #5450): conformance close-timeout bound pinned to `close({ timeoutMs: 0 })`; `NO_CAPABILITIES` naming; `yield`-after-lock-loss attempt accounting corrected against BullMQ 6.0.9 (`moveToFailed` token-fenced); `WorkerMeta.repeatable?` introduced with runner + lazy-supervisor semantics; optional-member contract made literally true (`capabilities?`, `signal?`, `yield?`); boot-refusal condition disambiguated; local strategy described as the JSON file it is; `maxDelay` given its custom-strategy mapping; colon rule stated exactly; CLI compat row renumbered.
- 2026-08-22 — Draft v1.1 after the second review (PR #5450): BullMQ floor stated (6.0.0) with the peer range narrowed in both packages and listed as a compat change; feature-detection and fail-fast added; `attemptNumber` shown as the existing member it is.
- 2026-08-22 — Draft v1: split out of part 4 v3 §5.8 + Phase 0 after review (PR #5450). Corrected the BullMQ `signal` mechanics; removed the unrelated PG-1/SC-1/ST-1 fixes from scope; added the full contract listing, per-strategy table, compatibility review, rollback, and the conformance suite as integration coverage.
