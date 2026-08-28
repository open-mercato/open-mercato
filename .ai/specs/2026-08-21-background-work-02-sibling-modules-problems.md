# Background work, part 2 — the same problems in the sibling modules

**Status**: problem statement, 2026-08-21. **No solution is proposed here on purpose.**
**Series**: [part 1](./2026-08-21-background-work-01-data-sync-problems.md) — `data_sync` problems (D-n) · [part 2](./2026-08-21-background-work-02-sibling-modules-problems.md) — sibling modules (Q/P/W/S/… ids) · [part 3](./2026-08-21-background-work-03-common-problems-and-requirements.md) — classes C-1…C-14, requirements R-A…R-M, open decisions Δ-1…Δ-11 · [part 4](./2026-08-21-background-work-04-solution.md) — options, decision, shared invariants · [part 5](./2026-08-21-background-work-05-queue-transport-contract.md) — queue transport contract · [part 6](./2026-08-21-background-work-06-leased-jobs-in-progress.md) — leased tier in `progress` · [part 7](./2026-08-21-background-work-07-data-sync-adoption.md) — `data_sync` adoption · [part 8](./2026-08-21-background-work-08-operator-surface.md) — operator surface.

---

## 0. TL;DR

**What this is.** Part 1 looked at one module and found that its incidents come from two decisions — a unit of work far longer than the queue is built for, and no authoritative answer to "is anyone still driving this?". This part asks whether `data_sync` is special. It applies the same ten questions (unit of work, liveness, single-runner, multi-phase writes, error handling, cancellation, deploy/scale, observability, coupling, tests) to everything else in the repository that does work outside an HTTP request: the queue package that carries the jobs, the `progress` module that shows them in the UI, the `workflows` engine, the `scheduler` package, and the background workers of twenty-two other modules.

**The answer.** It is not special. Every sibling has the same shape — no authoritative clock, an unbounded unit of work, nothing that stops two copies of the same work from running at once, writes that can be left half-done with nothing to repair them, cancellation by convention — **and none of them has a general repairer**: the only ones that exist are per-module reapers for push deliveries and attachment reservations, and `data_sync`'s narrow `onJobAbandoned`. Where the work is a durable effect in the outside world (a webhook, an email, a push), the consequence is duplicates; where it is a long loop, the consequence is a stuck or doubled run; and several maintenance sweeps are never scheduled at all.

**What it asks.** Two things. First, that the sibling findings are read as instances of the *same* problem statement as part 1 — part 3 does the grouping; the ask here is only to accept they belong together. Second, that a handful of findings found on the way are treated as ordinary bugs and fixed now, independent of any of this. Three were verified by hand: payment, Stripe and carrier webhooks are silently dropped because the route wraps the payload in a shape the worker does not read (PG-1, SC-1, ST-1 — since 2026-03-11, #859); an organisation-scoped search reindex wipes the whole tenant's index (SR-3); Akeneo's delete wipes every mapping even when the deletes failed (AK-4). Part 3 §0.1 lists the full set to ticket.

**How to read it.** The table below gives one line per area; the eight recurring patterns follow; §1–§5 hold the findings per area, each closing with what is *sound* there and what its tests do not cover; §6 lists what the audits could not settle from the repository alone. Findings carry stable ids (`Q-n`, `P-n`, `W-n`, `S-n`, and per-worker prefixes named in each table) so that part 3 can cite them.

| Area | What one unit of work is bound to | Who says it is alive | Single-runner | Who repairs a stuck one | Worst finding |
|---|---|---|---|---|---|
| `queue` (transport) | one BullMQ/local job; lock 30 s default, 1 stall | BullMQ lock (Redis) — invisible to the handler | none (no job id, no dedup) | nobody (`removeOnFail: 1000` is the only trace) | a lost lock never stops the handler; `close()` is unbounded (Q-1, Q-6, Q-15) |
| `progress` | a row; nothing binds it to a job, request or lease | `heartbeat_at`, written only as a side effect of progress writes | none | a sweep that runs only inside `GET /api/progress/active`, org-scoped | jobs `running` forever whenever no admin of that org has a tab open (P-3, P-4, P-29) |
| `workflows` | one `executeWorkflow()` drive: an HTTP request, a `setImmediate`, or an un-awaited promise in an event subscriber | nothing — no heartbeat, lease or sweep | row lock only inside the loop; every pre-loop path is unlocked | nobody | a poison-resume bug fails healthy instances; a deploy strands instances `RUNNING` forever (W-18, W-1) |
| `scheduler` | a definition row; **no execution record exists** (the table was dropped) | `last_run_at`; in async mode `next_run_at` is never updated | local: claim-only advisory lock; async: none | nobody | local mode double-fires across replicas; `lastRunAt` is advanced before anything durable exists (S-5, S-14) |
| every other worker | one queue job, handler length unbounded (a 10k-command loop, a multi-million-row reindex, an hours-long polling loop) | the BullMQ lock; `search`/`query_index` keep their own lock rows, one with a 30 s TTL nobody extends and one with a heartbeat nobody reads | a handful of atomic claims (push, messages, attachments, payment claims); everywhere else none | reapers exist only for push and attachment quotas | three webhook families silently drop every event because of a payload-shape mismatch (PG-1, SC-1, ST-1); an org-scoped reindex wipes the tenant's index (SR-3); a failed Akeneo delete wipes all mappings anyway (AK-4) |

Recurring patterns, counted across the audits (details in §5.4):

1. **Create-then-enqueue with no repair** — at least nine sites (`data_sync`, `catalog`, `communication_channels`, `query_index`, `search` — which enqueues first and creates the progress job last —, `sync_akeneo` ×2, the scheduler's own bookkeeping); only `customers` bulk routes compensate.
2. **Retry re-runs work that already succeeded, or fails on it** — events fan-out, webhooks, workflows activities, health probes, status pollers, inbound handlers, checkout emails; `catalog` bulk delete 404s on its own earlier deletes; `query_index` restarts a multi-million-row reindex from row 1.
3. **Swallow-and-complete** — the handler catches, logs and returns, so the queue's retry never fires and the job is green: messages, checkout expiry, warranty sweep, AI cleanups, domain workers, gmail renew, scheduler bookkeeping, search batch workers, customers bulk, Akeneo delete.
4. **Unbounded work on a 30 s lock with no independent heartbeat** — customer-account cleanups, gmail renew, AI prune, warranty sweep, domain verification, payment/shipping pollers, `query_index` reindex, Akeneo's hours-long polling loop, `catalog`'s 10k-command loop: the second stall redelivers the job while the first is still running.
5. **Claim column doubles as the done marker** — `messages.emailSentAt` is set before the send; a kill in between is a silently lost email (MS-1).
6. **Process-local state treated as global** — single-flight maps, backoff multipliers, throttle caches, abandon-sweep sets, concurrency limits.
7. **Never scheduled / never enqueued** — `integrations log-pruner`, both `status-poller`s, both `customer_accounts` cleanups, `notifications create*`.
8. **Local strategy consumed by two processes in the default dev topology** (`webhooks`, `push`), so dev double-delivers and integration tests cannot see single delivery.

### 0.1 Scope and method

- **Scope**: `packages/queue` (+ the worker bootstrap in `packages/cli`), `packages/core/src/modules/progress` (+ `packages/ui/src/backend/progress`), `packages/core/src/modules/workflows`, `packages/scheduler`, and the background workers of `search`, `query_index`, `catalog`, `customers`, `communication_channels`, `sync_excel`, `sync_akeneo`, `webhooks`, `events`, `notifications`, `messages`, `push_notifications`, `checkout`, `integrations`, `ai_assistant`, `attachments`, `storage_s3`, `payment_gateways`, `shipping_carriers`, `gateway_stripe`, `warranty_claims`, `customer_accounts`. `develop` at HEAD `33a7d00c42`. BullMQ installed: 6.0.9.
- **Method**: each area was audited read-only against the ten dimensions part 1 used for `data_sync` — unit of work · liveness/authority · single-runner/dedup · multi-phase writes · error handling · cancellation · deploy/scale · observability/retention · coupling · tests. Findings carry stable ids (`Q-n`, `P-n`, `W-n`, `S-n`, and per-worker prefixes) so part 3 can cite them. Every line cites the file and line read; nothing below is inferred from documentation alone. Five findings (PG-1/SC-1/ST-1, SR-3, AK-4) were independently re-verified by the author.

---

## 1. `packages/queue` — the transport

**Contract today.** `Queue<T>`: `enqueue(data, { delayMs? })`, `process(handler, { limit? })`, `clear`, `removeQueuedJobsByScope?`, `close`, `getJobCounts` (`types.ts:197-252`). `JobContext = { jobId, attemptNumber, queueName }` (`types.ts:29-36`). Per-queue knobs only: `concurrency`, `attempts`, `lockDuration`, `maxStalledCount`, `onJobAbandoned` (`factory.ts:83-104`). BullMQ defaults apply when unset: lock 30 s, renew 15 s, stall check 30 s, `maxStalledCount 1`. Retry policy is hard-coded at enqueue: `attempts 3`, exponential from 1 s (`async.ts:365-371`), i.e. a total retry window of ~3 s.

| ID | Sev | Problem | Evidence |
|---|---|---|---|
| Q-1 | **H** | The handler cannot learn about lock loss or cancellation: the processor is 1-arity (`async (job) =>`), so BullMQ never creates an `AbortSignal`; `JobContext` has no `signal`. A lost lock → a second replica starts the job while the first keeps running to completion. | `async.ts:383-398`; BullMQ `worker.js:67-68,556-567` |
| Q-2 | **H** | No per-job id, dedup or idempotency key: every enqueue is `randomUUID()`; `EnqueueOptions` is `delayMs` only. Dedup is pushed onto every consumer's domain table. | `async.ts:359-371`, `types.ts:152-157` |
| Q-3 | M | Per-job retry policy, priority and fail-fast are not expressible; a permanent validation error is retried exactly like a network blip. | `async.ts:24-34,192,369-370` |
| Q-4 | M | `attemptNumber` means different things per strategy and never increments on a crash: async counts throws only (stall redelivery does not bump), local writes `attemptCount` only in `catch`. A handler that crashes the process re-runs as attempt 1 forever. | `async.ts:387`, `local.ts:503-508` |
| Q-5 | L | `ProcessOptions.limit` is ignored by async; `workflows/cli.ts:413` relies on it. | `async.ts:376` |
| Q-6 | **H** | A stall is a guaranteed concurrent execution, and with the default `maxStalledCount 1` the second stall dead-letters the job silently unless `onJobAbandoned` is wired (only `data_sync` wires it). | `async.ts:439-443`; BullMQ `moveStalledJobsToWait-9.lua:97` |
| Q-7 | M | `lockDuration`/`maxStalledCount` of all handlers sharing a queue are merged with `Math.max`, so a short-job handler inherits a long-job handler's 10-stall budget; there is no env override. | `cli/mercato.ts:1702-1703,1759-1760` |
| Q-8 | M | Abandon detection is bounded by `removeOnFail: 1000` and string-matches BullMQ's internal reason strings; an incident with >1000 failures in 5 min evicts the evidence. | `async.ts:87-90,99-102,264-268,368` |
| Q-9 | L | One `onJobAbandoned` per queue; extra hooks are dropped with a warning. | `cli/mercato.ts:88-102` |
| Q-10 | L | The abandon sweep is per worker process and unsynchronised; N replicas booting together report N times. | `async.ts:450-459` |
| Q-11 | M | Retry policy is baked into Redis at enqueue time; a 10 s dependency outage exhausts all attempts of every job enqueued during it, with no later automatic retry. | `async.ts:369-370` |
| Q-12 | M | No `UnrecoverableError` passthrough; fast-fail requires importing `bullmq` directly. | grep, none |
| Q-13 | L | `createRoutedHandler` treats an unknown job type as success → the payload is deleted. | `worker/runner.ts:232-235` |
| Q-14 | **H** | The local strategy drops a job after 3 failures with no dead-letter store (standalone apps). | `local.ts:93-99,500-503` |
| Q-15 | **H** | `close()` is unbounded for async (`worker.close()` without `force` → `whenCurrentJobsFinished`) and the runner closes queues sequentially with no overall deadline; every SIGTERM with a long job ends in SIGKILL, a ~60 s redelivery gap, and one stall consumed. | `async.ts:503`, `worker/runner.ts:58-66`; BullMQ `worker.js:750-752,824-837` |
| Q-16 | M | The local strategy abandons the running batch after 5 s and the process exits; partial side effects stay, the job re-runs as attempt 1. | `local.ts:712-723`, `runner.ts:95` |
| Q-17 | L | A second SIGTERM during shutdown is ignored; no force path is exposed. | `runner.ts:52` |
| Q-18 | M | Dev supervisor + local strategy: a poison job that crashes the worker is restarted first and crashes again, forever, with `attemptCount` never incrementing. | `cli/mercato.ts:540-544`, `queue-worker-supervisor.ts:234-248` |
| Q-19 | **H** | In the default dev topology the local queue is consumed by **two** processes for `webhook-deliveries` and `push-deliveries`: an in-process consumer started inside Next.js, plus the discovered worker in `queue worker --all`. The strategy documents this as double execution. | `webhooks/lib/queue.ts:21-58`, `push_notifications/lib/queue.ts:34-66`, `local.ts:84-90` |
| Q-20 | M | Local `concurrency` is silently ignored while `createModuleQueue` advertises parity. | `local.ts:72,127`, `factory.ts:73-74` |
| Q-21 | M | An enqueue during a Redis outage blocks the HTTP request for minutes (ioredis `maxRetriesPerRequest 20`, backoff to 20 s) and then throws; a malformed Redis URL falls back to `localhost` with only a warning. | `async.ts:353-374`, `shared/lib/redis/connection.ts:108-111` |
| Q-22 | L | Connection fan-out: one `Queue` + one `Worker` per queue per process (~25 queues under `--all`); the scheduler opens and closes a producer per firing. | `cli/mercato.ts:1696-1720` |
| Q-23 | L | The single-instance guard only warns at boot; the local lock's 15 s `mtime` staleness can reclaim a live lock on a network filesystem. | `single-instance-strategy-guard.ts:9-24`, `local.ts:55-56` |
| Q-24 | L | `removeQueuedJobsByScope` swallows removal errors and reports partial counts. | `async.ts:484-490` |
| Q-25 | M | One corrupted local `queue.json` makes the shared worker exit, stopping every queue. | `cli/mercato.ts:1721`, `local.ts:648-653` |
| Q-26 | M | `error` events are only logged; `lockRenewalFailed` has no listener — the only signal of an impending duplicate run is a generic log line. | `async.ts:445-448` |
| Q-27 | M | No metrics; `getJobCounts` omits `delayed`/`prioritized`, so `mercato queue status` under-reports backlog. | `async.ts:535` |
| Q-28 | M | Completed jobs are removed immediately and failed ones capped at 1000 — there is no answer to "did it run?". | `async.ts:367-368` |
| Q-29 | L | `clear()` is `obliterate({ force: true })` (destroys active jobs) and returns `-1`. | `async.ts:468-475` |
| Q-30 | L | The stalled event logs the BullMQ id only; payload id ≠ BullMQ id. | `async.ts:439-443` |
| Q-31 | **H** | Local: no per-job lease; in-flight ids are per instance only (see Q-19). | `local.ts:82-90,686-696` |
| Q-32 | M | Local drops `lockDuration`, `maxStalledCount`, `onJobAbandoned` and `attempts`; `DATA_SYNC_QUEUE_ATTEMPTS` is ignored locally. | `factory.ts:101-103`, `local.ts:44` |
| Q-33 | M | Local: whole-file rewrite per operation, O(n) enqueue, 30 s lock-acquire timeout → enqueue throws under contention. | `local.ts:76,244-248,443-446` |
| Q-34 | M | Local: a batch claims *all* pending jobs before running any, so `removeQueuedJobsByScope` cannot cancel a started backlog. | `local.ts:479-486,688` |
| Q-35 | L | Local: handlers see internal `StoredJob` fields; retry updates for jobs removed meanwhile are dropped silently. | `local.ts:489,513-521` |

**What BullMQ 6.0.9 offers vs what the package exposes** — exposed: `delay`, per-queue `attempts`/`lockDuration`/`maxStalledCount`, `concurrency`, telemetry, partial `getJobCounts`, `obliterate`. **Not exposed and used nowhere:** custom `jobId`, `deduplication`, per-job `backoff`/`priority`, `UnrecoverableError`, `DelayedError`/`moveToDelayed`, `AbortSignal`, `extendLock`, `updateProgress`/`job.log`, `removeOnComplete`/`removeOnFail` overrides, `close(force)`, `pause`/`resume`/rate limiting, `JobScheduler`/`repeat`, `FlowProducer`, `QueueEvents`, `lockRenewalFailed`/`drained`/`closing` listeners.

**Sound.** Local at-least-once (the job is removed only after success), atomic temp+rename writes with owner-token lock and corrupted-file quarantine, watcher + fallback poll; the stalled event is surfaced with an explicit duplicate warning; the `onJobAbandoned` design (detached, try/catch, ack after success, bounded drain); single registration of signal handlers and telemetry flush; one request container per job with `em.clear()`; Σconcurrency clamped to the DB connection budget; trace propagation across enqueue → dispatch.

**Tests.** Every async test mocks `bullmq`; lock expiry, stall redelivery, `maxStalledCount` dead-lettering, `attemptsMade` semantics, `removeOnFail` eviction, SIGTERM with an in-flight job, SIGKILL redelivery, two local consumers, Redis-outage enqueue and the `Math.max` merge are all unverified.

---

## 2. `progress` — the record that is closest to being an authority

**Today.** One `progress_jobs` row ≈ one logical operation, with status, counters, `heartbeat_at`, `cancel_requested_at`, `parent_job_id`/`partition_*`, tenant+org scope (`data/entities.ts:12-95`). Every transition is a status-guarded CAS (`lib/progressServiceImpl.ts:38-45`). Liveness is inferred from `heartbeat_at`, which is persisted as a side effect of `updateProgress`/`incrementProgress` at most every 5 s, or explicitly via `touchJobHeartbeat` on a forked EM. The stale sweep (`markStaleJobsFailed`, 60 s running / 900 s pending) has exactly one caller: `GET /api/progress/active`. Eight modules plus the create-app template consume the service (~40 files, `grep progressService`); none subscribes to `progress.job.*` server-side.

| ID | Sev | Problem | Evidence |
|---|---|---|---|
| P-1 | **H** | Job lifetime is unbounded and unowned: no lease, runner id, queue job id or attempt column; `startJob` accepts any caller from `pending|failed`. Two producers double-count `processed_count`; the first `completeJob` wins silently. | `entities.ts:12-95`, `progressServiceImpl.ts:120,144-185,423-426` |
| P-2 | M | `failed` is non-terminal in practice (`START/COMPLETE/CANCEL_FROM_STATUSES` include it); the UI keeps `failed` cards forever and then they jump back to active with no explanation. | `:42-45`, `useAutoHideCompletedJobs.ts:55` |
| P-3 | **H** | The stale sweep has no server-side driver; the documented `progress:stale-check:system` schedule was never registered. A worker OOM-killed at 02:00 reads `running` until an admin opens a tab. | `api/active/route.ts:23`; docs `progress/overview.mdx:372-387`; grep 0 hits |
| P-4 | **H** | The sweep is scoped to the polling user's org: null-org (system) jobs are swept only by org-less pollers, org-B zombies are never swept by org-A users. | `api/active/route.ts:23`, `:662-665` |
| P-5 | M | The sweep runs on the request path of every 5 s poll of every open tab (2 finds + N `nativeUpdate` + N emits per poll). | `:678-746`, `useProgressPoll.ts:35` |
| P-6 | **H** | The heartbeat exists only while progress writes keep flowing; there is no background ticker. Only `data_sync` (around `next()`) calls `touchJobHeartbeat`; `catalog`, `customers`, `communication_channels`, `search`, `sync_akeneo` have no keepalive, so any unit of work > 60 s is swept. | `:194`; grep `touchJobHeartbeat` |
| P-7 | M | Revive-by-write makes `failed` flap; `DataTable` permanently drops the tracked job id on the first `failed` event, so the later real `completed` no longer refreshes the table. | `:215-235,322-333`; `DataTable.tsx:2866-2874` |
| P-8 | L | The pending sweep ignores the caller's timeout; a queue backlog > 15 min fails every queued job as "never started", and a subsequent real `failJob` from `failed` is refused, losing the real error. | `:713`, `:44` |
| P-9 | L | No index serves the sweep's `heartbeat_at`/`started_at`/`created_at` predicates. | `Migration20260220214819.ts:7-9` |
| P-10 | **H** | No single-runner or idempotency key: `communication_channels` documents its own TOCTOU; `search` does find-active-then-create, so two reindex POSTs create two active jobs and cancel reaches only the newest. | `queue-import-history.ts:127-148`, `reindex-progress.ts:59-73,201-210` |
| P-11 | M | `getActiveJobs` is used as a mutex but is capped at 50 and org-scoped; a zombie job blocks a channel forever (429). | `:625-635`, `queue-import-history.ts:136-143` |
| P-12 | M | A duplicate delivery double-counts; terminal state is first-writer-wins. | `:120,417-426,475-484` |
| P-13 | M | Create-then-enqueue with no compensation in `catalog` bulk-delete, `communication_channels` import, `data_sync` start, `query_index` reindex, `search` reindex; only `customers` deals bulk routes `failJob` on enqueue error. | `catalog/api/bulk-delete/route.ts:56-86`, `queue-import-history.ts:150-177`, `start-run.ts:39-79`, `reindex.ts:67-84`, `reindex-progress.ts:76-98`; `bulk-update-stage/route.ts:138-173` |
| P-14 | L | `createJob` flushes the caller's shared request EM, possibly mid-transaction. | `:274`, `di.ts:9` |
| P-15 | M | The service has no try/catch; `findOneOrFail` throws raw; worker `catch` blocks then call `failJob` on the same missing id, replacing the original error and retrying forever. | `:98,286,507`; `catalog-product-bulk-delete.ts:33-46` |
| P-16 | M | A CAS miss is a silent success; `startJob` on a `cancelled` job returns the cancelled entity and no surveyed worker checks it — the worker proceeds. | `:169,229-234,287-289,423,481` |
| P-17 | L | `cancelJob` errors are collapsed into a 400; the top bar calls `onCancel` unconditionally. | `[id]/route.ts:107-116`, `ProgressTopBar.tsx:116-125` |
| P-18 | M | `eventBus.emit` is awaited inside the write path; a throw after the CAS leaves the row updated and the caller rejected → `failJob` on a completed row + a queue retry of finished work. | `:178,244,438,496,558` |
| P-19 | L | Consumers swallow progress errors (`query_index` bare `catch {}`, `search` nulls the service). | `reindex.ts:65-120`, `fulltext-index.worker.ts:147-151` |
| P-20 | M | Cancellation is advisory and most workers never check it: `search` creates jobs `cancellable: true` and has a cancel route, but neither index worker polls `isCancellationRequested` — a cancelled reindex ends `completed`. | grep; `reindex-progress.ts:82`, `search/api/reindex/cancel/route.ts:73-80` |
| P-21 | L | `cancelJob` emits `JOB_CANCELLED` with `status: 'running'`; `DataTable` and the pipeline page drop their tracked id on it. | `:530-562`, `DataTable.tsx:2876-2884` |
| P-22 | M | `data_sync` cancel calls `markCancelled` immediately, so the bar says cancelled while rows still import. | `runs/[id]/cancel.ts:81-93` |
| P-23 | L | Cancel on an already-failed job returns 200 and rewrites `failed → cancelled`, erasing the failure semantics. | `:508-511,:45` |
| P-24 | L | `parent_job_id`/`partition_*` are write-only: no cascade, no aggregation, children invisible in the top bar. | `reindex.ts:80-81`; `:630,644` |
| P-25 | L | Every timestamp is the writer's JS clock; the sweep compares an app-clock cutoff with another host's `heartbeat_at`; no DB `now()` anywhere. | `:150,400,458,516,575,660` |
| P-26 | L | The throttle map is per service instance and never evicted on crash; `completeJob` overwrites `totalCount`/`meta` from a stale local snapshot. | `:81,98-100,407-413` |
| P-27 | M | Buffered deltas (≤ 250 ms / 5 s) are lost on crash or SIGKILL; a retry from zero double-counts, a resume under-counts. | `:196`, `:151-154` |
| P-28 | L | `startJob` returns a detached entity while consumers also load managed copies → identity conflicts on flush. | `:286`; `first-import.ts:105-125` |
| P-29 | **H** | Composite of P-3 + P-4: a job can stay `running`/`pending` forever; `search` then attaches new reindexes to the dead job. | `reindex-progress.ts:59-72` |
| P-30 | M | No retention or purge exists (the entity comment promises one). | `entities.ts:6-7`; grep none |
| P-31 | L | SSE audience filtering is asymmetric (null-org events reach all org connections, org events never reach superadmin connections); no replay; the 5 s poll still runs under SSE. | `events/api/stream/route.ts:107-126,163-167` |
| P-32 | L | A late `JOB_UPDATED` from a reviving process can arrive after `JOB_COMPLETED` and is upserted back as `running` until the next poll. | `useProgressSse.ts:105-143` |
| P-33 | L | The UI treats unknown status as `running`; `cancelled` is none of active/failed/completed and is excluded from `recentlyCompleted`, so cancelled jobs vanish silently. | `useProgressSse.ts:114`, `ProgressTopBar.tsx:127-129`, `:642` |
| P-34 | L | `GET /active` mutates state (fails jobs, emits tenant-wide events) under `progress.view` only. | `api/active/route.ts:7,23` |
| P-35 | L | Four consumers read `ProgressJob` directly, bypassing scoping/identity rules. | `reindex-progress.ts:37-46`, `first-import.ts:109-123`, `jobs/[id]/route.ts:26,78` |
| P-36 | **H** | No server-side consumer of `progress.job.*`; domain rows drift from progress rows and nothing converges them. | grep; part 1 D-28 |

**Sound.** Status-guarded CAS with explicit from-sets; per-row staleness re-check inside the sweep; revive narrowed to `Job stale:%`; `startedAt` preserved across revive; atomic SQL increments + DB-side percent; `disableIdentityMap` on lifecycle reads; `touchJobHeartbeat` on a forked EM, optional-chained in the contract; heartbeat persistence decoupled from broadcast throttling; tenant/org scoping on every filter; terminal events flush buffered counts; per-action ACL; UI poll pauses when hidden and refetches on reconnect/focus; `data_sync/lib/abandoned-run.ts` closes the queue-abandoned → progress gap for that one module.

**Tests.** 70+ unit cases on a mocked EM and 9 Playwright API specs. Nothing exercises the sweep from a non-HTTP driver, cross-org/null-org sweeping, a real-DB race (two workers, duplicate delivery), crash between `createJob` and `enqueue` (except `customers`), `startJob` on a cancelled job, a worker ignoring cancel, retention, parent/child, or `touchJobHeartbeat` mid-transaction on a real DB.

---

## 3. `workflows` — an engine with no driver

**Today.** One "drive" is `executeWorkflow()`: a loop capped at `maxIterations = 100`, run inside `em.transactional` holding `SELECT … FOR UPDATE` on the instance row (`lib/workflow-executor.ts:309,602-604`). It is started by an HTTP request (advance/retry/task/signal), by `setImmediate` in the start route, by an un-awaited promise inside the persistent `*` event subscriber, or by a BullMQ job (async activity, timer). No queue job ever represents "advance this instance"; there is no continuation, heartbeat, lease or sweep.

| ID | Sev | Problem | Evidence |
|---|---|---|---|
| W-1 | **H** | The drive is a detached promise with no durable record; a SIGTERM/OOM mid-loop rolls the transaction back and leaves the instance `RUNNING` at its first step forever. `queue.close()` does not wait for it. | `api/instances/route.ts:218-229`, `event-trigger-service.ts:751-758`, `subscribers/event-trigger.ts:15-19` |
| W-2 | M | Hitting `maxIterations` returns `RUNNING` plus an in-memory error nobody persists; the parallel loop throws instead (→ W-17). | `workflow-executor.ts:309,563-571`, `parallel-handler.ts:336` |
| W-3 | **H** | `executeWorkflow` has no status guard for `WAITING_FOR_ACTIVITIES`; `advance` re-runs sync activities and re-enqueues async ones, overwriting `_pendingAsyncActivities` while the old jobs still run. | `:281-297`, `advance/route.ts:124-143` |
| W-4 | **H** | Sync `WAIT`, retry backoff sleeps and outbound HTTP run inside the HTTP request and the open `FOR UPDATE` transaction — `WAIT PT1H` holds a connection and the row lock for an hour. | `activity-executor.ts:384-393,988-996`, `transition-handler.ts:438` |
| W-5 | **H** | Step-level async activities never pause the instance: the filter is `async && !success` but enqueued results are `{ success: true, async: true }` — the step completes immediately and the later resume throws "not waiting", which W-19 swallows; the output is lost. | `step-handler.ts:462`, `activity-executor.ts:445-454` |
| W-6 | **H** | No liveness record or sweep for any waiting state; `WAITING_FOR_ACTIVITIES`, `PAUSED`, `RUNNING`, `FORKED` are terminal in practice once their single external trigger is lost. | `data/entities.ts:226-309`; grep |
| W-7 | **H** | The activities worker declares no `lockDuration`/`maxStalledCount`/`onJobAbandoned` → BullMQ defaults (30 s, 1 stall); two kills during one `CALL_WEBHOOK` fail the job with no `ACTIVITY_FAILED` row → `WAITING_FOR_ACTIVITIES` forever. | `workers/workflow-activities.worker.ts:39-43`, `async.ts:88` |
| W-8 | M | Timer durability is the delayed queue job alone (`TIMER_AWAITING` is never read back); a Redis flush → `PAUSED` forever; `fireTimer` on a cancelled instance throws and is retried 3×. | `step-handler.ts:878-914`, `timer-handler.ts:106-111` |
| W-9 | **H** | A crash mid-loop loses the error: the `catch` sets `FAILED`, flushes, logs, then rethrows inside `em.transactional`, which rolls all of it back. | `workflow-executor.ts:572-598` |
| W-10 | **H** | Every pre-loop mutation path (advance, task, signal, timer, branch resume) reads the instance without a lock, mutates, and only then enters the locked loop; a double-click creates two `StepInstance`s, two `UserTask`s and runs activities twice. | `advance/route.ts:79-83`, `task-handler.ts:78-81,117,238`, `signal-handler.ts:76-86,304`, `timer-handler.ts:86-96,225`, `parallel-handler.ts:66-71` |
| W-11 | **H** | Task completion and claim are read-then-write with no lock or version; two completers both succeed and both execute the transition. Listed as unimplemented in the durable-user-task spec. | `task-handler.ts:78-81,273-309`; `.ai/specs/2026-07-15-durable-workflow-user-task-continuation.md:365-366` |
| W-12 | M | The activity job is enqueued *inside* the executor transaction, before commit; a fast worker resumes against the still-`RUNNING` committed row, throws, is swallowed (W-19), and the instance then commits `WAITING_FOR_ACTIVITIES` with nothing to re-drive it. | `activity-executor.ts:254`, `workflow-executor.ts:752-755` |
| W-13 | L | Definition lookup inside the engine has no tenant/org/`deletedAt` filter. | `find-definition.ts:150` |
| W-14 | **H** | `completeUserTask` is five-plus autocommitted phases (task `COMPLETED` → context merge → exit step → transition → drive); a crash after the first leaves a `PAUSED` instance with no open task. Same split for signals and timers. | `task-handler.ts:114-254`, `signal-handler.ts:223-322`, `timer-handler.ts:146-242` |
| W-15 | M | Every event row is its own flush, so outside the loop each is a commit point a crash can split from its state change; the AGENTS.md rule "never mutate state without its event" is unenforceable. | `workflow-executor.ts:1036`, `transition-handler.ts:1000`, `step-handler.ts:955`, `task-handler.ts:355` |
| W-16 | M | The worker logs `ACTIVITY_COMPLETED` and resumes in two transactions; a crash between them re-executes the activity on redelivery and writes a second `COMPLETED` row (feeds W-18). | `worker.ts:184-212` |
| W-17 | M | The parallel-loop cap throws, rolling back all branch progress while external side effects stay. | `parallel-handler.ts:336` |
| W-18 | **Critical** | Poison resume: `resumeWorkflowAfterActivities` counts *all historical* async `ACTIVITY_COMPLETED`/`ACTIVITY_FAILED` rows of the instance and fails it if any failure exists. (a) attempt 1 fails, attempt 2 succeeds → `FAILED`; (b) a second async transition resumes early with missing output; (c) retry after an async failure fails again immediately. The branch variant has the same logic. | `workflow-executor.ts:763-811`, `worker.ts:225-244`, `parallel-handler.ts:206-221` |
| W-19 | **H** | Resume errors are swallowed and the job completes — DB errors, lock timeouts, missing definitions and W-12 all end green. Duplicated in the CLI handler. | `worker.ts:286-293`, `activity-worker-handler.ts:200-207` |
| W-20 | M | The worker decides "final attempt" from `payload.retryPolicy.maxAttempts || 1` but enqueue never passes `attempts`; attempt 1 fails → workflow `FAILED` while BullMQ still runs attempts 2–3 with side effects; interval/backoff settings are ignored. | `worker.ts:247-248`, `activity-executor.ts:250-254` |
| W-21 | M | A sync timeout leaves phantom executions (`SEND_EMAIL`/`EMIT_EVENT`/`UPDATE_ENTITY`/`EXECUTE_FUNCTION` ignore the signal) and then the retry loop starts attempt 2 concurrently. | `activity-executor.ts:341-395,1479-1506` |
| W-22 | M | `SEND_EMAIL` swallows failures and reports `sent: true`. | `activity-executor.ts:547-563` |
| W-23 | **H** | Retry re-executes already-succeeded sync activities (pending state is never cleared; activities are sequential fail-fast); `COMPENSATED` cannot be retried; compensation scans every `ACTIVITY_COMPLETED` row so a second failure compensates twice. | `retry/route.ts:94,107-116`, `compensation-handler.ts:79-82` |
| W-24 | **H** | Cancel is not a fence: open tasks stay `PENDING` and `completeUserTask` never checks `instance.status` — it merges context, runs activities and creates the next step on a `CANCELLED` instance, then the drive throws → HTTP 500 with the writes committed. | `cancel/route.ts:93-103`, `workflow-executor.ts:673-714`, `task-handler.ts:117-254` |
| W-25 | M | Queued activity and timer jobs survive cancel (no job id bookkeeping, no removal); async activities execute after cancel. | grep `removeJob` none |
| W-26 | M | `WAITING_FOR_ACTIVITIES`, `FORKED`, `COMPENSATING` cannot be cancelled via the API — exactly the states W-7/W-18 strand instances in. | `cancel/route.ts:93` |
| W-27 | L | No `AbortSignal` reaches custom code. | `activity-executor.ts:922-955` |
| W-28 | **H** | Entire workflows (sub-workflows recursively, inside the parent transaction) run in the web process after the response with no shutdown tracking. | W-1 + W-4; `step-handler.ts:681` |
| W-29 | M | The default queue strategy is `local`, which is single-consumer; two default-configured worker replicas double-execute activities and timers. | `factory.ts:61-63`, `local.ts:86-89` |
| W-30 | L | Two concurrency knobs (enqueue-side default 5, worker-side default 1) and two divergent handler implementations (the CLI one lacks `CALL_API`, branch ids, abort, branch-aware timers). | `activity-executor.ts:204`, `worker.ts:36-42`, `activity-worker-handler.ts` |
| W-31 | L | Timer math runs on the enqueuing node's clock; `calculateDueDate` is regex-only (`P1DT2H` → 1 day). | `step-handler.ts:854-857,965-990` |
| W-32 | M | ~6–10 flushes and 3–5 `workflow_events` rows per hop; every context write rewrites the full JSONB. | `transition-handler.ts:551-631`, `execution-token.ts:120-124` |
| W-33 | M | Context and event payloads are duplicated several times over (initial context, trigger payload, final context, full `CALL_API` responses, form data, two output aliases); no pruning of `workflow_events`. | `workflow-executor.ts:224-230`, `event-trigger-service.ts:718-727`, `step-handler.ts:414`, `activity-executor.ts:1149-1157` |
| W-34 | M | No progress integration; the lifecycle events declared in `events.ts` are never emitted by the engine. | `events.ts:22-32`; grep |
| W-35 | M | "`RUNNING` forever" is a legitimate, indistinguishable state: no auto transition → `RUNNING`; a signal/timer/task with no valid transition sets `RUNNING`; the next signal then fails `WORKFLOW_NOT_PAUSED`. | `workflow-executor.ts:402-437`, `signal-handler.ts:168-174,276-300` |
| W-36 | M | The custom-function contract is `fn(args, ActivityContext)` with no em, container, signal, job id, progress or logger; zero registrations exist repo-wide. | `activity-executor.ts:128-138,934-944` |
| W-37 | L | The worker passes a cast `ctx`/Proxy as the Awilix container. | `worker.ts:71`, `subscribers/event-trigger.ts:80-86` |
| W-38 | M | Idempotency is delegated to activity authors without a key: `jobId`/`attemptNumber` are not in `activityContext`, `UPDATE_ENTITY` commands carry no token. | `worker.ts:112-119`, `activity-executor.ts:762-765` |

**Sound.** The executor loop and the root async-resume run under `em.transactional` + `PESSIMISTIC_WRITE`; branch resume locks the branch row and is idempotent on status; per-job container + `em.clear()`; the worker timeout aborts in-flight fetches; `CALL_API` keys are created on an isolated EM (#4202) and run under the initiator's roles; `UPDATE_ENTITY` allowlist + RBAC; SSRF guard; trigger concurrency cap and per-tenant cache; trusted tenant scope only from bus options; the worker rethrows after logging; `continueOnActivityFailure` is honoured.

**Tests.** No tests for either activities worker. Resume tests mock the counts and never exercise failed-then-succeeded or multi-phase sequences; step-level async, real-DB concurrency for advance/task/signal/claim, cancel fencing, crash/rollback, retry-after-async-failure and compensation-after-retry are untested; integration covers CRUD, start, cancel and retry-rejection only.

---

## 4. `scheduler` — definitions without executions

**Today.** The only durable state is the definition row with `last_run_at`/`next_run_at` (`data/entities.ts:53-57`); the `scheduled_job_runs` table was created and then dropped ("BullMQ as the single source of truth for execution history", `Migration20260126143000.ts:5-12`). In async mode each schedule is a BullMQ Job Scheduler producing `scheduler-execution` jobs; the worker enqueues the target queue or runs a command. In local mode a 30 s `setInterval` polls the table. No `AGENTS.md` exists for the package.

| ID | Sev | Problem | Evidence |
|---|---|---|---|
| S-1 | **H** | No execution record; "did the 03:00 sync fire on Tuesday?" is unanswerable after BullMQ eviction or in local mode. | `entities.ts:53-57`, migration above |
| S-2 | M | Local mode has no history and refuses manual trigger (400). | `trigger/route.ts:63-71`, `executions/route.ts:62-68` |
| S-3 | M | "Execution history" is a global last-N window of the whole queue filtered by schedule, so a low-frequency schedule shows nothing. | `executions/route.ts:83-100` |
| S-4 | M | `syncAll` runs on cold start of **every** process that builds a DI container (each web replica, CLI one-shot, worker); replicas race `remove`/`upsertJobScheduler`; paging is `limit/offset` without `orderBy`. | `di.ts:52-60`, `bullmqSchedulerService.ts:281-355` |
| S-5 | **H** | Local mode double-fires across replicas by design: the advisory lock guards only the claim and is released before the handler runs; `nextRunAt` advances only after execution. Both `scheduler start` and `queue worker --all --with-scheduler` tick. | `localLockStrategy.ts:59-65,75`, `localSchedulerService.ts:207-217`, `cli/mercato.ts:2337-2344` |
| S-6 | **H** | Re-registration resets cadence: every `register()` upsert recomputes `nextRunAt = now + interval`; all module setups call it from `seedDefaults`, so a daily prune re-seeded daily never fires (local). In async mode `register()` mutates in-memory `nextRunAt` without flushing. | `schedulerService.ts:49-53,86,118-124`, `bullmqSchedulerService.ts:148-158` |
| S-7 | M | Catch-up semantics differ per strategy and are undocumented; local collapses missed iterations into one (cap 100 per poll) and interval schedules drift since `nextRunAt` is recomputed from `now`. | `localSchedulerService.ts:120-127`, `nextRunCalculator.ts:52-54` |
| S-8 | **H** | No overlap protection in async mode: `concurrency: 5`, no in-flight marker; a manual trigger or a stalled redelivery runs the same schedule twice — commands execute twice. | `execute-schedule.worker.ts:19` |
| S-9 | M | `_idempotencyKey` is emitted in every target payload and read by no consumer; the dedup story the scheduler relies on does not exist. | `queueTargetPayload.ts:25`; grep |
| S-10 | L | The local idempotency key is `Date.now()`. | `localSchedulerService.ts:274` |
| S-11 | L | The active-schedule cap is count-then-insert without a lock. | `activeScheduleLimits.ts:32-38` |
| S-12 | **H** | Local: target executed, then a separate fork flushes `lastRunAt/nextRunAt`; a flush failure or crash re-fires the schedule on the next poll with no record. | `localSchedulerService.ts:192-217,231-247,361-377` |
| S-13 | M | Async: target enqueued, then `lastRunAt` flushed; a flush failure fails the job, which has no retry, so `lastRunAt` is stale while the work ran. | `worker:183-196` |
| S-14 | **H** | `data_sync`: `lastRunAt` is flushed **before** anything durable exists, then three writes across two stores follow with no transaction; a crash leaves "ran" with no run, or a `pending` run forever that blocks every future firing — the schedule silently stops. | `sync-scheduled.ts:108-109`, `start-run.ts:39-87`, `sync-run-service.ts:437-454` |
| S-15 | **H** | A failed firing is recorded nowhere durable: local = log + event (no subscriber exists) + advance `nextRunAt`; async = BullMQ `failedReason` until eviction. No `last_error`/`last_status` column. | `localSchedulerService.ts:232-246`, `events.ts:5-8` |
| S-16 | M | Scheduled BullMQ jobs are created without `attempts`/`backoff` although the JSDoc promises retries; only manual triggers get `attempts: 3`. | `bullmqSchedulerService.ts:57-60,195-204` |
| S-17 | L | The `started` event is emitted outside the `try`; an event-bus error leaves the schedule due forever. | `localSchedulerService.ts:156-166` |
| S-18 | M | Feature-gated schedules are skipped silently forever; a tenant losing `data_sync.run` sees an "enabled" schedule with a frozen `last_run_at`; RBAC errors are swallowed as `false`. | `worker:148-165`, `localSchedulerService.ts:168-187,352-355` |
| S-19 | M | Disable/delete does not reach in-flight or already-enqueued work; `SchedulerService.unregister` hard-deletes while the admin command soft-deletes. | `worker:127-136`, `schedulerService.ts:140`, `commands/jobs.ts:455-460` |
| S-20 | M | BullMQ sync is best-effort — every failure is swallowed with a log — so DB and Redis diverge silently until a cold-start `syncAll` (itself fire-and-forget). | `schedulerService.ts:125-128,146-148,238-240`, `scheduledJobSubscriber.ts:119-128` |
| S-21 | L | Enable/disable races the worker's fresh read; there is no fence. | `worker:87-90` |
| S-22 | M | Without the optional package, `data_sync` schedule saves 422, pre-existing `sync_schedules` rows are inert with no signal, and every other module's system maintenance (TLS retry, push reclaim, payment prune, SLA sweeps, channel polling) is silently absent. | `sync-schedule-service.ts:36-41`, `integrations/setup.ts:43-45` |
| S-23 | M | The local poll tick is not awaited on SIGTERM and the CLI calls `process.exit` right after `stop()`; a kill between target execution and the flush re-fires (S-12). | `localSchedulerService.ts:96-106`, `cli.ts:208-213` |
| S-24 | M | `next_run_at` is never updated in async mode yet the CLI "Due now" count, the list API and the lazy-supervisor probe all read it — a stuck schedule is indistinguishable from a healthy one. | `worker:195,238`, `scheduler-supervisor.ts:69-76` |
| S-25 | L | Retention is a per-queue BullMQ knob; manual triggers use `removeOnComplete: true`, so a successful manual run leaves no trace. | `bullmqSchedulerService.ts:196-203`, `async.ts:367` |
| S-26 | L | A Redis producer is created and closed per firing and per executions-API request. | `worker:172-191`, `executions/route.ts:72` |
| S-27 | M | Local mode is a single sequential tick across all tenants; one slow command delays every other tenant; no per-schedule timeout. | `localSchedulerService.ts:137-139,283-324` |
| S-28 | L | System-scope feature checks differ between strategies. | `localSchedulerService.ts:336-338`, `worker:148-153` |
| S-29 | L | Every iteration of a Job Scheduler carries the same static `QueuedJob.id` and the registration-time `createdAt`. | `bullmqSchedulerService.ts:175-184` |
| S-30 | Info | In production async mode no component is responsible for `scheduler start`/`syncAll` except the incidental cold-start. | `cli/mercato.ts:2336-2360`, `auto-spawn-scheduler.ts:10-16` |

**Sound.** A single-sourced queue-target payload contract; the worker re-validates scope against the DB and reads a fresh row per firing; command targets are allowlisted, RBAC-checked and run as a non-superadmin schedule-bound context; the local claim transaction is kept short; the subscriber skips BullMQ churn for timestamp-only updates; stable Job Scheduler keys with legacy cleanup; sub-minute intervals clamped; cron parsed with time zones; deterministic UUIDs make seeded registrations upsert; admin CRUD is undoable with soft delete; the `data_sync` worker refuses to start when a run is live or the integration disabled.

**Tests.** No two-process polling test; no crash-between-execution-and-bookkeeping test (`sync-scheduled.test.ts:132-150` codifies the hazard); no `attempts` assertion; no overlapping-firing, cadence-preserved-on-reregister, catch-up, DST, consumer-dedupe, SIGTERM-mid-poll or `syncAll`-race test; integration specs are API/RBAC only and none observes a firing.

---

## 5. Every other background worker

### 5.1 Bulk operations and indexing — `search`, `query_index`, `catalog`, `customers`, `communication_channels` import, `sync_excel`, `sync_akeneo`

| ID | Sev | Problem | Evidence |
|---|---|---|---|
| SR-1 | **H** | `search` reindex creates the progress job only **after** every batch has been enqueued; workers that run first find no active progress, clear the reindex lock and drop their counts, so the job never reaches `totalCount` and stays `running` (or is swept) although the index is complete. | `api/reindex/route.ts:199-323`, `fulltext-index.worker.ts:38-50`, `vector-index.worker.ts:128-140` |
| SR-2 | **H** | Enumeration and `recreateIndex` run synchronously inside the HTTP request with offset paging; a timeout or restart mid-way leaves the index dropped, a partial set enqueued, no record of which pages were done, and the lock orphaned. | `search-indexer.ts:645-737`, `api/reindex/route.ts:426-461` |
| SR-3 | **H** ✔ | **Verified by reading.** An org-scoped reindex calls `fulltext.recreateIndex(params.tenantId)` — tenant-keyed — and then pages only org-filtered rows, so every other organisation of the tenant loses search until someone reindexes from their scope (which wipes this one again). | `api/reindex/route.ts:199-204`, `search-indexer.ts:645-647,663-668` |
| SR-4 | M | The reindex lock is a 30 s heartbeat (the comment says 60 s) touched only when a batch for that tenant finishes; a backlog > 30 s expires it, a second `POST` passes the 409 check, recreates the index under the running job, and `ensureReindexProgressJob` overwrites `totalCount` so the job completes early. | `reindex-lock.ts:20,50,89-97,198-208`, `reindex-progress.ts:59-72,122-137` |
| SR-5 | M | The lock check is tenant-only while acquire/clear are org-scoped; a cancel from another org is a no-op and any caller finalises a stale lock. | `reindex-lock.ts:65-71,146-172` |
| SR-6 | M | Per-record failures are swallowed and counted as processed; an unreachable embedding provider "skips" every batch and the run completes 100 % with an empty vector index. | `fulltext-index.worker.ts:223-251`, `vector-index.worker.ts:243-294` |
| SR-7 | L | In-flight batches never observe cancel; the no-progress path re-creates the lock after cancel. | `reindex-lock.ts:213-215`, `fulltext-index.worker.ts:70-72` |
| SR-8 | L | A throw after the progress advance → retry advances progress again. | `fulltext-index.worker.ts:244-270,341-367` |
| SR-9 | M | Batch jobs carry no run id or job id, so cancel can only remove "all batch jobs in scope" — including another run's. | `search-indexer.ts:696-701`, `cancel/route.ts:57-62` |
| QI-1 | **H** | One persistent event = one unbounded `query_index` reindex with an in-memory keyset cursor; a failure rethrows through the events worker and the retry restarts from the first row — three times, then the job is dropped. | `subscribers/reindex.ts:9,150-165,219`, `reindexer.ts:320,424-426,467-469` |
| QI-2 | **H** | The active-job guard has no staleness predicate and hard-codes `organization_id IS NULL` while the prepared scope is the real org; `finalizeJob` runs only in `finally`, which SIGKILL skips. A killed run wedges every later non-`force` reindex of that entity (returns 0/0 and the subscriber *completes* its progress job), and org-scoped runs never see each other. | `reindexer.ts:188-215,598-602`, `subscribers/reindex.ts:166-169` |
| QI-3 | M | The progress job is created lazily from a fire-and-forget callback; interleaved callbacks create duplicates, and an early exception creates a job only to fail it. | `subscribers/reindex.ts:66-85,162-164,188-191` |
| QI-4 | M | Partition fan-out has no parent/child linkage; a retried partition resets coverage counters under its siblings; no aggregate exists. | `api/reindex.ts:103-129`, `reindexer.ts:389-413` |
| QI-5 | M | The query engine emits persistent reindex events from hot read paths with a per-process debounce → N replicas, N duplicate reindexes, `prepareJob` upsert resetting the sibling's counters. | `engine.ts:2195-2227`, `jobs.ts:70-77` |
| QI-6 | L | `entity_index_jobs.heartbeat_at` is written per batch and read by nothing. | `jobs.ts:124-136` |
| CB-1 | **H** | `catalog` bulk delete: the worker `failJob`s and rethrows, the loop has no per-id catch and restarts at index 0, and `catalog.products.delete` 404s on an already-deleted id — so a transient error at id 5000 of 8000 makes every retry fail on id 1; 3000 products are never deleted. | `workers/catalog-product-bulk-delete.ts:33-46`, `lib/bulkDelete.ts:91-108`, `commands/products.ts:1687-1693` |
| CB-2 | M | Create job then enqueue with no repair (contrast `customers`). | `api/bulk-delete/route.ts:56-86` |
| CB-3 | M | `cancellable: false`, up to 10k sequential command executions and 10k progress writes in one job; a synchronous stall > 30 s stalls the job into a concurrent duplicate run. | `route.ts:14,64`, `lib/bulkDelete.ts:100-107` |
| CB-4 | L | `concurrency: 1` is per process. | `workers/catalog-product-bulk-delete.ts:17` |
| CD-1 | M | `customers` bulk deals: per-row failures are swallowed and `completeJob` runs regardless — 0 of N updated is "completed". | `lib/bulkDeals.ts:156-183,203` |
| CD-2 | L | Whole-job failure restarts from zero; a deterministic preflight failure is retried 3×. | `workers/deals-bulk-update-owner.ts:30-45`, `lib/bulkDeals.ts:81-104,218` |
| CD-3 | L | The bulk mutation guard is best-effort and swallowed; per-row commands run with `auth: null`. | `route.ts:68-87`, `lib/bulkDeals.ts:108-124` |
| CD-4 | L | `cancellable: false`. | `route.ts:114` |
| CH-1 | M | `communication_channels` import-history keeps the adapter cursor in memory; `failJob` + rethrow restarts at page 1 (dedup keeps rows unique, provider quota is burned again) and the progress job flips failed → running → failed across attempts. | `workers/channel-import-history.ts:77,157,210-213,227,235-248` |
| CH-2 | L | The concurrency guard is a non-atomic scan of the capped active-jobs window, then create, then enqueue with no repair. | `commands/queue-import-history.ts:127-177` |
| CH-3 | L | `processedCount` counts permanent per-message failures as imported. | `:205-216,232` |
| CH-4 | L | The per-page progress write is the only heartbeat; one IMAP page > 60 s trips the stale sweep. | `:172-179,219-223` |
| SX-1 | M | `sync_excel` import: overlap check and `startDataSyncRun` are not atomic; a double-click imports the same upload twice. | `api/import/route.ts:116-119,154-179` |
| SX-2 | L | The upload's `syncRunId`/status is written after the run is already started; a failure there returns 500 and leaves a running run with a `previewed` upload. | `:181-199` |
| SX-3 | L | Mapping + credentials commit before the run exists; if the start throws, the integration is enabled with no run. | `:137-152` |
| AK-1 | **H** | `sync_akeneo` first-import is a polling loop (`sleep 1500`) inside one queue job for hours; a worker restart stalls the job, the redelivery restarts the three-step sequence and either re-adopts an overlapping child run or **starts a new one** while the orphaned child keeps running; after `maxStalledCount 1` the parent is abandoned with no hook and `POST /first-import` 409s forever. | `lib/first-import.ts:159-253`, `workers/first-import.ts:32-46`, `api/first-import/route.ts:83-107` |
| AK-2 | L | `updateProgress` every 1.5 s for hours on the shared EM. | `lib/first-import.ts:193-219` |
| AK-3 | L | Child failure is propagated as a thrown string; parent and child progress jobs are unrelated. | `:225-231` |
| AK-4 | **H** ✔ | **Verified by reading.** Delete-imported-products swallows every per-product error (`catch {}`) and then unconditionally `nativeDelete`s **all** Akeneo mappings for five entity types plus the cursor and completes the job; products whose delete failed lose their Akeneo identity and are re-created as duplicates on the next import, while the summary says "completed". | `lib/delete-imported-products.ts:163-206` |
| AK-5 | M | No duplicate-run guard for delete (unlike first-import); ids are recomputed in the worker; two concurrent jobs 404 on each other and both wipe mappings. | `api/delete-products/route.ts:61-93`, `lib/delete-imported-products.ts:145` |
| AK-6 | M | Create job then enqueue with no repair (both routes). | `api/first-import/route.ts:109-131`, `api/delete-products/route.ts:70-93` |

| Worker | Unit of work | Resumable | Heartbeat | Cancel | Rethrow | Dedup / single-runner | SIGKILL residue |
|---|---|---|---|---|---|---|---|
| search fulltext / vector `batch-index` | 200-id batch | batch idempotent; run not resumable | lock heartbeat per batch (30 s) | none in worker | fulltext yes; vector swallows | tenant-only 30 s lock, no job id | progress stuck, lock expires, no abandon hook |
| search reindex API (enumerator) | whole tenant in the HTTP request | no (index dropped first) | none | n/a | n/a | 409 on lock | index wiped, partial enqueue, lock orphaned |
| query_index reindex subscriber | whole entity / partition | no (in-memory cursor) | written, unused | no | yes → events retry ×3 | `finished_at IS NULL` guard, no TTL, wrong org | permanent wedge until `force`; purged rows not rebuilt |
| catalog bulk delete | ≤ 10k ids sequential | no; retry 404s | per row | no | failJob + rethrow | per-process 1 | partial soft-delete, caches not invalidated |
| customers bulk owner/stage | N ids sequential | restart from 0 (idempotent) | per row | no | failJob + rethrow; per-row swallow | per-process 1 | partial update, caches not invalidated |
| channel import-history | pages until done / cap | no (cursor in memory) | per page | per page | failJob + rethrow | non-atomic scan | partial (dedup-safe), quota burned on retry |
| akeneo first-import | 3 child runs, polled for hours | no; re-adopts or restarts children | `updateProgress` / 1.5 s | no | failJob + rethrow | progress-job 409 | orphan child runs, stuck parent |
| akeneo delete-imported | all mapped products | no; per-item swallow | per row | no | only infra errors | none | mappings wiped / products remain |

**Sound (5.1).** `query_index`'s atomic upsert for `entity_index_jobs` scope rows (#2739), `finalizeJob` in `finally` for non-kill failures, keyset pagination, fail-fast on whole-batch write failure, purge exclusion of failed ids, authoritative coverage recount at the end; channel import's per-page cancel check, bounded pages, transient/permanent classification and request-scoped EM fork; `customers` bulk routes' enqueue-failure repair and stage preflight; search cancel routes fail closed when scoped removal is unavailable; vector preflight avoids N identical provider failures; every worker builds command contexts with explicit tenant/org scope.

**Tests (5.1).** SR-1/3/4/5 untested (`workers.test.ts:358,554` assert the orphaned-lock branch as *desired* behaviour); `reindex-subscriber.test.ts` has one test (EM fork) — nothing for the wedge, the NULL-org guard, duplicate progress jobs or retry-from-zero; catalog `bulkDelete.test.ts` covers cache invalidation only; customers `bulkDeals.test.ts` asserts `completeJob` with failures as behaviour; channels tests cover branches but not cursor loss, count inflation or long pages; akeneo has reset-position tests only; `sync_excel/api/import/route.ts` has no tests; nothing asserts behaviour under stall/redelivery for any of these queues.

### 5.2 Webhooks, events, notifications, messages, push, checkout

| ID | Sev | Problem | Evidence |
|---|---|---|---|
| WH-1 | **H** | The outbound-dispatch subscriber creates a new delivery row with a fresh `messageId` on every run and the events worker re-runs *every* persistent subscriber when any one fails → up to 3 delivery rows and 3 POSTs per webhook with different `webhook-id` headers, so receivers cannot dedup. | `webhooks/lib/delivery.ts:46-60`, `events/src/bus.ts:369-394` |
| WH-2 | **H** | The delivery job has no claim: it proceeds regardless of status, flushes `sending` before the HTTP call, and a SIGKILL mid-POST leaves `sending` forever (no reaper) while the stalled redelivery POSTs again; the manual retry route enqueues without checking `sending`; `consecutiveFailures += 1` is an unfenced lost update. | `delivery.ts:78-144,205-206,248-249,367-368`, `retry/route.ts:63,68` |
| WH-3 | M | Two stacked retry layers (app-level re-enqueue per attempt + BullMQ `attempts: 3`); `attemptNumber` is incremented only after the response, so a crash never counts toward `maxAttempts`. | `delivery.ts:179,243,335-344` |
| WH-4 | L | The retry job is enqueued before the auto-disable write is flushed. | `delivery.ts:333-377` |
| WH-5 | M | Local dual consumer (see Q-19) for outbound and inbound queues. | `webhooks/lib/queue.ts:28-66,82-116` |
| WH-6 | M | Inbound dispatch flushes `processing` first and `handlerResults` only at the end: a kill after handler 1 of 3 re-runs handler 1; a throwing handler is caught and the job returns normally, so the queue never retries and the "resume unsuccessful handlers" path is unreachable. | `inbound-dispatch.ts:60-63,76-91,105-136` |
| WH-7 | M | Source-flow inbound endpoints emit `webhooks.inbound.received` persistently with `providerKey = endpointId`; `inbound-process` resolves an *adapter* by that key and throws, so every source-flow webhook produces a failing events job retried 3× and dead-lettered. | `api/inbound/[endpointId]/route.ts:189-197`, `subscribers/inbound-process.ts:21-24` |
| WH-8 | L | `failed-delivery-notification` swallows errors; an operator alert is silently lost. | `subscribers/failed-delivery-notification.ts:81-83` |
| EV-1 | **H** | Fan-out retry is all-or-nothing: per-subscriber results are recorded but the retry unit is the whole job, so every retry re-runs subscribers that already succeeded; idempotency is delegated by convention and not honoured (WH-1, MS-2, CK-2). | `events/src/modules/events/workers/events.worker.ts:95-97,154` |
| EV-2 | M | `DEFAULT_CONCURRENCY = 1` with single-delivery on: all webhook fan-outs, notifications, workflow triggers and indexing share one serial slot; no `lockDuration`, so a > 30 s subscriber stalls and re-runs the whole fan-out. | `events.worker.ts:12-17`, `single-delivery.ts:34-36` |
| EV-3 | L | Dead-lettered event jobs have no replay path. | `async.ts:368`, `local.ts:498-500` |
| EV-4 | L | No outbox: a kill between inline delivery and `q.enqueue` loses the event. | `bus.ts:467-491` |
| NT-1 | M | `create*` notification jobs insert rows with no dedup key; an emit failure after the flush → duplicate notifications on retry. | `create-notification.worker.ts:63-67,81-88,103-110` |
| NT-2 | L | Only `cleanup-expired` has an enqueue site (the CLI, hard-coded to async); `create*` have no in-repo producer. | `notifications/cli.ts:8-12` |
| NT-3 | L | `cleanup-expired` is a cross-tenant write with no scope assertion. | `:115-123` |
| MS-1 | **H** | The claim sets `emailSentAt` **before** the send; a kill mid-send leaves a row that reads delivered, no email was sent, and nothing sweeps it (no `sending` state, no reaper). A provider timeout is released but the handler swallows the error, so the queue never retries either. | `messages/workers/send-email.worker.ts:107-119,149-163,263-269,313-331` |
| MS-2 | M | The notification subscriber creates a new BullMQ `Queue` per event (connection leak, never closed) and enqueues per recipient; a Redis error at recipient k → EV-1 retry → `createBatch` runs again. | `message-notification.ts:104,116-126` |
| MS-3 | L | Send failures are logged and released but the job completes; transient SMTP errors are terminal. | `:232-250,313-331` |
| PU-1 | M | The push lease's `updated_at` is never refreshed mid-send; the timeout is clamped to `window − 60 s` but bounds the worker's wait, not the SDK call, so a late success + `send_timeout` re-enqueue = duplicate push (bounded by 3 attempts). | `push-delivery.ts:27-40,259-275`, `push-reaper.ts:11-16` |
| PU-2 | L | The reclaim tick is not single-flight across processes (safe per row, duplicated reads). | `reclaim-stuck.worker.ts:20-24`, `push-reaper.ts:23,80-115` |
| PU-3 | L | Terminal write then emit is not atomic; a kill between loses `delivery.sent/failed`. | `push-delivery.ts:104-126` |
| PU-4 | L | Local dual consumer (see Q-19). | `push_notifications/lib/queue.ts:35-67` |
| CK-1 | **H** | The checkout email worker has no sent marker, claim or dedup: any throw after `sendEmail` resolves → BullMQ retry → the customer receives "payment successful" 2–3×. In local mode the subscriber runs the handler inline with swallowed errors, so dev never retries while prod retries blindly. | `checkout/workers/send-email.worker.ts:175,202,231`, `lib/emailQueue.ts:22-35`, `subscribers/transaction-completed-notify.ts:62-64` |
| CK-2 | M | Persistent subscribers build `createRequestContainer()` per event (ignoring `ctx.resolve`) and `createQueue` per email (connection leak). | `transaction-completed-notify.ts:31`, `emailQueue.ts:17`, `transaction-failed-notify.ts:56`, `session-started-email.ts:22` |
| CK-3 | M | The expiry sweep swallows per-row errors and is always green; a row whose `updateStatus` keeps failing is re-selected every 10 min forever; overlapping ticks on two processes both execute the command; cap 100 rows / 10 min / org with no cursor. | `transaction-expiry.worker.ts:34,56-78` |
| CK-4 | L | Full PII decryption of up to 100 transactions to flip a status. | `:43-54` |

### 5.3 Channels, integrations, AI, attachments/storage, payments, shipping, warranty, customer accounts

| ID | Sev | Problem | Evidence |
|---|---|---|---|
| CC-1 | **H** | `poll-tick` re-enqueues the same channel every tick while a poll is still queued or running: due-ness is by `lastPolledAt`, which advances only on a *successful* poll and is not stamped on enqueue; a slow provider makes the backlog grow by the pool size per minute, each duplicate re-fetching the same page and last-writer-winning `channelState`. | `poll-tick.ts:166-180`, `poll-channel.ts:182-196,272,299-302` |
| CC-2 | **H** | `poll-tick` is not single-flight across processes (`concurrency: 1` is per process); the scheduler's `_idempotencyKey` cannot be consumed (Q-2); the recovery pool's `lastPolledAt` bump is flushed only after all enqueues. | `poll-tick.ts:30,186-199` |
| CC-3 | M | No per-channel mutual exclusion across four producers (tick, self-drain, `poll-now`, transient retry) at `concurrency: 10`; ingest is idempotent so data is safe, but quota burns N× and the cursor can regress when an older page flushes after a newer one. | `poll-channel.ts:54,296-320,373-377`, `poll-now/route.ts:156-165` |
| CC-4 | M | Outbound delivery: the link stays `pending` between `adapter.sendMessage` and the success flush (documented); redelivery re-invokes the adapter; the worker's own re-enqueue stacks on BullMQ's 3 attempts (up to 3×3 executions); no `sending`/lease state. | `deliver-outbound-message.ts:400-409`, `outbound-delivery.ts:99-132` |
| CC-5 | M | Gmail history sync: a failed cursor flush still ACKs → whole-page replay; N Pub/Sub notifications start N parallel drain chains for one channel at `concurrency: 5`, flushing `channelState` concurrently. | `gmail-history-sync.ts:164-209`, `webhooks/gmail/route.ts:122-138` |
| CC-6 | M | Gmail renew-watch: unbounded loop with sequential network calls on a 30 s lock and no heartbeat → stalled → redelivered while still running; per-row errors swallowed; a mid-loop death records nothing and the next run is tomorrow. | `gmail-renew-watch.ts:65-118`, `setup.ts:145` |
| CC-7 | L | Inbound processor rethrows permanent errors (missing adapter) → 3 retries then dead-letter with no channel-level dead-letter row. | `inbound-processor.ts:62-76` |
| CC-8 | L | Reaction send/remove are not idempotent under retry; double reactions on provider timeout. | `reaction-processor.ts:73,199-224,256-260` |
| CC-9 | L | Credential-refresh single-flight is a module-level `Map`; two processes refreshing a rotating Gmail token invalidate each other and flap the channel to `requires_reauth`. | `credential-refresh.ts:60`, `poll-channel.ts:351-366` |
| IN-1 | **H** | The health-probe schedule id is derived from `tenantId` while the scope is per organization; `register()` upserts by id, so the last org seeded wins and the others are never probed. | `integrations/setup.ts:48-62` |
| IN-2 | M | `log-pruner` has no enqueue site anywhere; `integration_logs` grows unbounded (one row per probe per org per 15 min). | `workers/log-pruner.ts`; `health-service.ts:140-146` |
| IN-3 | L | Health probe: N+1 `isEnabled` queries; an escaped `credentialsService.resolve`/`upsert` error fails the whole batch and retries every probe 3×. | `health-probe.ts:49-59`, `health-service.ts:102,130` |
| AI-1 | M | Pending-action cleanup: system-wide sweep, unforked global `em`, raw cross-tenant tenant discovery, up to 50 × 100 rows per tenant sequentially with one event emit per row on a 30 s lock; concurrency tolerated only by a per-row read-then-write state check; all errors swallowed, always ACKs. | `ai-pending-action-cleanup.ts:70,110-118,182-256` |
| AI-2 | M | Token-usage prune: unbounded `for (;;)` delete loop, non-transactional, never rethrows; a stall starts a second concurrent loop; unforked `em`. | `ai-token-usage-prune.ts:55-71,92-128,155-181` |
| AT-1 | M | Attachment/S3 quota recovery: on error the worker both re-schedules and rethrows, so BullMQ's 3 retries run alongside the re-scheduled copy — up to 4 parallel claimants (each doing a full `getReservation` + S3 list/delete before the CAS no-ops). | `attachments/workers/quota-recovery.ts:62-66`, `storage_s3/workers/quota-recovery.ts:76-80` |
| AT-2 | M | Permanent failures (missing partition, S3 unconfigured) re-enter the queue every TTL forever; no attempt counter or terminal state. | `attachments:52`, `storage_s3:42`, `quota-service.ts:320` |
| AT-3 | L | `storage_s3` reads the pre-claim `record.status` snapshot after claiming. | `storage_s3/workers/quota-recovery.ts:27-53` |
| PG-1 | **H** ✔ | **Verified.** The payment webhook route enqueues `{ name: 'payment-gateway-webhook', payload }`; `enqueue` stores that object verbatim as `job.payload` (`async.ts:359-360`, `local.ts:431`), so the worker's `job.payload.providerKey`/`.scope` are `undefined` and `processPaymentGatewayWebhookJob` returns silently. Hit whenever `QUEUE_STRATEGY=async` (the route falls back to inline processing otherwise). The provider gets 202; the transaction never syncs; no log row; no retry. Introduced 2026-03-11 (#859); unit tests pass the unwrapped shape. | `payment_gateways/api/webhook/[provider]/route.ts:120-125`, `lib/webhook-processor.ts:59-60` |
| PG-2 | **H** | `status-poller` is never enqueued; if it were, an unscoped payload polls *all tenants'* pending transactions sequentially in one job with no heartbeat. | grep; `status-poller.ts:5-39`, `gateway-service.ts:836-843` |
| PG-3 | M | The webhook claim row is deleted on failure before rethrow, but a kill between claim and processing leaves the claim in place, so the redelivery is treated as a duplicate — the event is permanently lost and the dead poller (PG-2) cannot reconcile it. | `webhook-utils.ts:32-52`, `lib/webhook-processor.ts:75-82,117-120` |
| PG-4 | L | Session-initialization prune: self-continuation plus the daily schedule may overlap on two processes (harmless contention). | `session-initialization-prune.ts:47-62` |
| SC-1 | **H** ✔ | **Verified.** Same wrapping as PG-1, and here unconditional: every carrier webhook is acknowledged with 202 and dropped in both strategies (`getShippingAdapter(undefined)` → `undefined` → `return`). The worker test and integration specs pass the unwrapped shape / assert only the route response. | `shipping_carriers/api/webhook/[provider]/route.ts:117-125`, `workers/webhook-processor.ts:37-54` |
| SC-2 | M | `status-poller` is never enqueued; if it were, one failing `refreshTracking` aborts the rest and the whole batch is retried 3×. | `status-poller.ts:25-32` |
| SC-3 | M | Claim → flush → emit: a kill between flush and emit saves the status but never emits `shipment.status_changed`, and the redelivery is treated as a duplicate; unforked `em` under `concurrency: 5`. | `workers/webhook-processor.ts:31-36,57-93` |
| ST-1 | **H** ✔ | **Verified.** Stripe is enqueued by the same payment route, so under async `job.payload.event` is `undefined`, `readSessionIdFromEvent` throws, scope is null, and the job is retried 3× then dead-lettered — every Stripe webhook fails in production async mode. | `gateway-stripe/.../di.ts:18-21`, `webhook-processor.ts:54,89-109` |
| ST-2 | M | The claim is keyed on the transaction's scope and released on the payload's scope; unforked `em` at `concurrency: 5`. | `webhook-processor.ts:41,62,92` |
| WC-1 | M | The SLA sweep is unbounded in wall-clock (keyset paging, no page cap) on a 30 s lock with no heartbeat; a stalled redelivery or the next 900 s firing starts a second sweep; signal dedup and `escalate`'s row lock are solid, but the escalation notification is created *before* the level check, so two sweeps both notify. | `sla-escalation-sweep.ts:77-90,321-336,382-449`, `setup.ts:135` |
| WC-2 | L | `drainPendingSlaSignals` reads at most 500 unpublished signals per run with no loop; per-claim errors are swallowed and the job never rethrows. | `:250,436-438` |
| CA-1 | **H** | `cleanupExpiredSessions`/`cleanupExpiredTokens` are never scheduled or enqueued; session, verification, reset and invitation tables grow forever. | grep; `customer_accounts/setup.ts:47-87` |
| CA-2 | **H** | If they were run: single cross-tenant `nativeDelete`s with no limit on an unforked `em`, holding row locks for the statement's duration on a 30 s lock → stall → a second identical DELETE concurrently. | `cleanupExpiredSessions.ts:16-23`, `cleanupExpiredTokens.ts:20-46` |
| CA-3 | M | The TLS-retry worker's adaptive backoff lives in module-level variables; with two processes one backs off while the other keeps hammering the rate-limited CA. | `domainTlsRetryWorker.ts:7,26-31` |
| CA-4 | M | Domain workers are system-wide sweeps with no batch cap and sequential DNS/TLS I/O per row, no heartbeat, errors swallowed; every redelivery restarts from row 0. | `domainMappingService.ts:241-263`, `domainVerificationWorker.ts:29-44`, `domainTlsRetryWorker.ts:55-63` |

### 5.4 Cross-worker view

| Worker | Unit of work | Resumable | Heartbeat | Cancel | Rethrow | Dedup / claim | SIGKILL residue |
|---|---|---|---|---|---|---|---|
| webhooks delivery | 1 row | n/a | no | no | yes | **none** | `sending` forever; duplicate POST |
| webhooks inbound | 1 ingestion / N handlers | partial | no | no | yes | status check | `processing` forever; handlers re-run |
| events | 1 event → N subscribers | no | no | no | yes | stamp only | all subscribers re-run |
| notifications create | 1 job / M recipients | n/a | no | no | implicit | none | duplicate rows |
| messages send-email | 1 recipient | n/a | no | no | **no** | claim = `emailSentAt` | **marked sent, never sent** |
| push send | 1 delivery | n/a | timeout-bounded | no | yes | atomic claim + fence | `sending` → reaper after 5 min |
| push reclaim | ≤ 500 rows | yes | no | no | partial | per-row guard | none |
| checkout send-email | 1 email | n/a | no | no | yes / swallowed (local) | **none** | duplicate customer email |
| checkout expiry | ≤ 100 rows | re-select | no | no | **no** | none | none |
| gmail-history-sync | 1 channel, 1 page | cursor per page | no | no | transient only | none (N jobs / channel) | page replay (idempotent) |
| gmail-renew-watch | all channels of an org | restarts | no | no | never | none | partial; next try +24 h |
| poll-channel | 1 channel, 1 page | cursor per page | no | no | never | none | page replay |
| poll-tick | ≤ 500 + 500 channels | restarts | no | no | never | none | duplicate poll jobs |
| outbound-delivery | 1 message | n/a | no | no | after 3 self-retries | link unique index (post-flush) | `pending` link → duplicate send |
| health-probe | all integrations of an org | restarts | no | no | yes | none | partial probes |
| log-pruner | **never runs** | — | — | — | — | — | — |
| ai pending-action cleanup | all tenants, ≤ 50 × 100 rows | restarts | no | no | never | per-row state | rows stay pending (safe) |
| ai token-usage prune | whole table | restarts | no | no | never | none | partial (safe) |
| attachments / s3 quota-recovery | 1 reservation | lease | no | no | yes + reschedule | atomic `claimExpired` | `recovering` until TTL |
| payment status-poller | **never runs** | — | — | — | — | — | — |
| payment / shipping / stripe webhook | 1 event | n/a | no | no | yes | unique claim | **every event dropped** (PG-1/SC-1/ST-1); orphan claim loses the event |
| warranty SLA sweep | all active claims, no cap | restarts | no | no | never | signal reserve + lease | unpublished signals drained next run |
| customer_accounts cleanups | **never run**; one cross-tenant DELETE | — | — | — | — | — | — |
| domain verification / TLS retry | all pending mappings | restarts | no | no | never | none (per-process backoff) | partial batch |

**Sound (workers).** Push delivery is the reference pattern in the repo: atomic claim with attempt bump, fenced write-backs, a reaper with guarded transitions, `ON CONFLICT DO NOTHING` fan-out, and enqueue failure → terminal `failed` rather than an orphaned `pending`. Messages has the right claim *shape* (wrong column). Ingest idempotency on `(channel_id, external_message_id)` makes every inbound replay data-safe. Poll-channel's transient/permanent split with dead-letter and cursor hold-back; drain caps on both Gmail and poll loops. Attachment `claimExpired` is a true conditional `UPDATE … RETURNING` with lease tokens on every later write. The warranty SLA signal outbox (conditional reserve in a transaction, lease with expiry, publish-then-mark, drain on next run) and `escalate`'s `PESSIMISTIC_WRITE`. AI cleanup's per-row state machine converges concurrent sweeps without double events. Inbound webhook receipt dedup via unique violation; outbound marks `failed` when enqueue throws; the events worker fails loudly when the bus is missing; every audited worker scopes queries by tenant.

**Tests (workers).** No worker tests at all for integrations, attachments quota-recovery, payment status-poller and webhook worker, shipping status-poller, the four `customer_accounts` workers, notifications and push workers. The webhook workers that do have tests are fed a hand-built unwrapped payload, which is why PG-1/SC-1/ST-1 pass. No test anywhere exercises two concurrent invocations for the same channel/row, cross-process behaviour, cursor regression, claim-then-die, duplicate send under retry, or overlapping sweeps.

---

## 6. Open questions the audits could not settle from the repo

1. Is `QUEUE_STRATEGY=async` the production default? If so PG-1/ST-1 have dropped payment webhooks since #859; SC-1 applies in every mode. No unwrap exists in `packages/queue/src/worker` or the strategies.
2. Were `log-pruner`, both `status-poller`s, both `customer_accounts` cleanups and `notifications create*` left unscheduled on purpose?
3. What are the production `terminationGracePeriod` and restart policies? They decide how often Q-15's unbounded `close()` ends in SIGKILL.
4. Does anything in `external/official-modules` register the documented `progress:stale-check:system` schedule, a `workflowFunction:*`, or consume `workflowExecutor`?
5. Does the Next.js runtime in use keep `setImmediate` work alive after the response (W-1)?
6. What is BullMQ's Job Scheduler behaviour after several missed iterations (S-7), and the default `attempts` for scheduler-produced jobs (S-16)?
7. Is the worker's `ctx.resolve` container per job or per process (affects P-26 and every unforked-`em` finding)?
8. Is multi-process worker deployment expected (CA-3, CC-9, Q-10 assume not)?

## Changelog

- 2026-08-21 — Initial version, assembled from six read-only audits (queue + bootstrap, progress, workflows, scheduler, and two worker sweeps) run against the same ten-dimension lens as part 1. PG-1/SC-1/ST-1 re-verified by hand.
- 2026-08-21 — §0 rewritten for readability (plain-language opening, the ask stated, scope and method moved to §0.1); no findings, ids or section numbers changed.
