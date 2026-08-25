# Background work, part 3 — common problems and the requirements they imply

**Status**: requirements statement, 2026-08-21. **This document deliberately stops before any design.**
**Series**: [part 1](./2026-08-21-background-work-01-data-sync-problems.md) — `data_sync` problems (D-n) · [part 2](./2026-08-21-background-work-02-sibling-modules-problems.md) — sibling modules (Q/P/W/S/… ids) · [part 3](./2026-08-21-background-work-03-common-problems-and-requirements.md) — classes C-1…C-14, requirements R-A…R-M, open decisions Δ-1…Δ-11 · [part 4](./2026-08-21-background-work-04-solution.md) — options, decision, shared invariants · [part 5](./2026-08-21-background-work-05-queue-transport-contract.md) — queue transport hardening · [part 6](./2026-08-21-background-work-06-data-sync-hardening.md) — phase 1: `data_sync` hardening.

---

## 0. TL;DR

**What this is.** The last of three problem documents. Parts 1 and 2 catalogued some 260 findings across `data_sync`, the queue, `progress`, `workflows`, the scheduler and the background workers of twenty-two other modules. This part groups them into **fourteen problem classes** (§2), derives **requirements with acceptance criteria** from those classes (§3), and lists the **decisions it deliberately leaves open** for a solution spec (§4) — including where the mechanism should live and what it should be called. Nothing here proposes a design.

**What it asks of the reader.** Three decisions, in order. (1) Are the fourteen classes the right framing — one problem with many instances, rather than a per-module fix list? (2) Are the requirements in §3, with their MUST/SHOULD weighting and acceptance criteria, the bar a solution must clear? This is the decision that gates the solution spec. (3) Agreement to file the bugs in §0.1 now; they are ordinary defects with clear fixes and do not depend on anything else in the series.

**The argument.** Open Mercato has **at least ten independent ways of saying "some work is happening in the background"** — a BullMQ job, a local-strategy job, a `progress_jobs` row, a `sync_runs` row, an `entity_index_jobs` lock row, a workflow instance, a workflow activity job, a scheduler definition, and a handful of per-module claim columns (push deliveries, message recipients, attachment reservations, payment/shipping webhook claims, warranty SLA signals). None of them is authoritative about liveness, none is repaired by a process that runs regardless of browser traffic, and only `data_sync`'s commit fence and the per-module claims fence their writes. The ~260 findings in parts 1–2 collapse into **fourteen problem classes** (§2) that appear in every area, and those classes imply **a single set of requirements** (§3) rather than a per-module fix list.

The core of it in three sentences:

1. The unit of work handed to the transport is either far longer than the transport's lock model (days-long runs, unbounded sweeps) or far shorter than the side effect it causes (a webhook POST, an email) — and nothing in between is recorded durably.
2. "Is anyone still doing this?" cannot be answered for any kind of work by any query, so every stuck state is repaired by a human editing a row — or not at all.
3. Correctness under duplicate delivery, lost locks, crashes between writes, cancellation and two replicas is delegated to each worker author by convention, and the audits show the convention is honoured in a minority of workers (about a quarter of the rows in part 2 §5.4 have a real claim or fence).

### 0.1 Findings that should not wait for this series

These are ordinary bugs with a clear fix and no architectural dependency. They are listed here so they get tickets now; they are not part of the requirements below.

| Finding | What | Why it cannot wait |
|---|---|---|
| PG-1 / SC-1 / ST-1 | Webhook routes enqueue `{ name, payload }`, workers read `job.payload.x` → every carrier webhook, and every payment/Stripe webhook in async mode, is silently dropped | Verified in code (introduced 2026-03-11, #859): carrier webhooks unconditionally, payment/Stripe whenever `QUEUE_STRATEGY=async` |
| W-18 | `resumeWorkflowAfterActivities` counts all historical async events → healthy instances marked `FAILED` | Correctness of every async activity |
| MS-1 | `emailSentAt` set before the send → lost emails read as delivered | Silent data loss |
| IN-1 | Health-probe schedule id keyed by tenant with per-org scope → only one org per tenant is probed | Silent loss of monitoring |
| SR-3 | An org-scoped fulltext reindex recreates the tenant-wide index and refills it with one org's rows | Verified; other orgs lose search |
| AK-4 | Akeneo delete-imported-products swallows every delete failure and wipes all mappings and the cursor anyway | Verified; duplicates on next import |
| QI-2 | `query_index` active-job guard has no staleness check and wrong org scope; a killed run wedges every later reindex of that entity | Index silently stays half-built |
| CB-1 | Catalog bulk delete retries 404 on already-deleted ids; the remainder is never deleted | Incomplete bulk operation reported as failed-at-id-1 |
| CA-1, IN-2, PG-2, SC-2 | Workers that have no enqueue site | Tables grow forever / features inert |
| S-6 | `register()` resets cadence on every `seedDefaults` → long-interval schedules never fire in local mode | Silent loss of maintenance |
| Q-19 / WH-5 / PU-4 | Two consumers of the same local queue in the default dev topology | Dev double-delivers; tests can't see it |

---

## 1. Inventory — what "background work" is represented by today

| Mechanism | Record | Liveness signal | Who repairs a stuck one | Single-runner | Cancel | Used by |
|---|---|---|---|---|---|---|
| BullMQ job (`async` strategy) | Redis only; removed on completion, last 1000 failures kept | Redis lock, renewed by the worker, invisible to the handler | stall redelivery (1 stall by default), then nothing | none (random job id) | none | everything |
| Local job (`local` strategy) | `queue.json` | none (no lease) | none; dropped after 3 failures | none; documented single-consumer | none | dev, tests, standalone apps |
| `progress_jobs` row | Postgres | `heartbeat_at`, written as a side effect of progress writes | a sweep inside `GET /api/progress/active`, org-scoped to the poller | none | advisory flag | 8 modules + the create-app template, ~40 files |
| `sync_runs` row | Postgres | none (status never times out); liveness borrowed from the progress job and the BullMQ lock | `onJobAbandoned` for two reason strings | plain-SELECT overlap check | advisory, via progress | `data_sync` |
| `entity_index_jobs` row | Postgres | a 30 s heartbeat the `search` lock reads and nothing extends; a heartbeat `query_index` writes and nothing reads | auto-finalise on read (`search`) / nobody (`query_index`) | tenant-only check vs org-scoped acquire (`search`); `finished_at IS NULL` with a hard-coded NULL org (`query_index`) | remove queued jobs by scope | `search`, `query_index` |
| Workflow instance | Postgres | none | nobody | row lock inside the loop only | status write, not a fence | `workflows` |
| Workflow activity / timer job | Redis | BullMQ lock (30 s default) | nobody | none | none (jobs survive cancel) | `workflows` |
| Scheduler definition | Postgres (`last_run_at`, `next_run_at`); executions dropped | none | nobody | local: claim-only advisory lock; async: none | disable flag, not reaching in-flight work | every module with periodic work |
| Per-module claim columns | Postgres | `updated_at`/TTL (push, attachments) or the claim itself (messages, payments, shipping) | reapers for push and attachment quotas only | atomic CAS claim | none | push, messages, attachments/S3, payment/shipping/stripe webhooks, warranty signals |
| Detached promise | nothing | nothing | nobody | none | none | workflow start/trigger, inline email in local mode |

The table is the problem: liveness and repair are properties of *one or two* rows of it, and every other row either borrows them across a module boundary (`sync_runs` ← `progress_jobs` ← BullMQ) or does without.

---

## 2. Common problem classes

Each class states the problem once, lists where the audits found it (by finding id), and names the place in the repo where it is *already* handled correctly, if one exists. Severity is the worst consequence observed.

### C-1 · The unit of work does not match the transport's liveness model

One queue job is one multi-day run (D-1), one unbounded sweep over a whole table or tenant (CC-6, AI-1, AI-2, WC-1, CA-2, CA-4, PG-2, SC-2), one multi-million-row reindex with an in-memory cursor (QI-1), a 10k-command loop (CB-3), an hours-long polling loop (AK-1), or a whole-tenant enumeration inside an HTTP request (SR-2), or one whole workflow drive including hour-long sleeps (W-4, W-28). The transport runs a job of any length, but its stall counter (1–10), retry attempts (3, ~3 s of backoff) and graceful `close()` are per job and never reset on progress, and it has no checkpoint of its own — so with one job per run, a deploy is a stall, `maxStalledCount` is a deploy budget, a stall is a guaranteed concurrent execution (Q-6, D-8), and every SIGTERM with a long job ends in SIGKILL because `close()` cannot drain (Q-15, D-2, D-23). The transport does offer a way for a handler to hand a job back at a safe boundary and continue later without spending any budget, but nothing exposes it (Q-3 — `DelayedError`/`moveToDelayed`/`moveToWait` unexposed) and no handler receives the shutdown signal that would trigger it (Q-1).
**Worst consequence**: a deploy or a 31 s GC pause duplicates or kills work. **Done right nowhere**; the closest is `data_sync`'s per-batch cursor commit, which is durable but bounds nothing.

### C-2 · No authoritative liveness record; no non-terminal state times out

`sync_runs.status` never ticks (D-4); `progress_jobs.heartbeat_at` is written only while progress is being written (P-6) and is org-scoped on read (P-4); workflow instances have no lease, heartbeat or timeout in any waiting state (W-6, W-35); scheduler has no execution record at all (S-1) and `next_run_at` is stale in async mode (S-24); webhook deliveries stay `sending` and inbound ingestions `processing` forever (WH-2, WH-6); message recipients are marked sent before sending (MS-1); the two reindex lock rows have a TTL nobody extends or a heartbeat nobody reads (SR-4, QI-2, QI-6). Four unrelated clocks disagree for one run (D-4, §8 of part 1).
**Worst consequence**: "is anyone driving X right now?" has no answer for any kind of work; zombie rows block future work (D-13, P-11, P-29, S-14). **Done right**: push deliveries (lease with TTL) and attachment reservations (`expires_at` + `claimExpired`).

### C-3 · Repair is absent, browser-driven, or narrow

The only general sweep runs inside `GET /api/progress/active` (D-5, P-3, P-5, P-34) and cannot reach the run row (D-28, P-36). `onJobAbandoned` covers two reason strings and a 1000-entry window (D-9, Q-8). Workflows, scheduler, webhooks, messages, checkout have no repairer (W-6, W-7, S-15, WH-2, MS-1, EV-3); a killed `query_index` run wedges every later reindex until an operator passes `force` (QI-2); an abandoned Akeneo orchestrator 409s forever (AK-1). In-process drivers are invisible to every repairer (D-10, W-1). The documented `progress:stale-check` schedule was never registered (P-3).
**Worst consequence**: recovery is "edit the row" (D-27). **Done right**: push reaper, attachment quota recovery — both per-module, both correct in shape.

### C-4 · No single-runner guarantee and no idempotency key

Two starts of the same logical work are allowed everywhere: `data_sync` overlap is a plain SELECT with no unique index and no queue job id (D-11); `progress` has no key and is used as a mutex via a capped, org-scoped list (P-10, P-11); the queue exposes no `jobId`/dedup (Q-2); the scheduler double-fires across replicas in local mode and has no overlap protection in async mode, and its `_idempotencyKey` is read by no consumer (S-5, S-8, S-9, S-10); workflow advance/task/signal/timer paths are unlocked read-then-write (W-10, W-11); poll-tick re-enqueues live channels every tick and is not single-flight (CC-1, CC-2, CC-3); a schedule id collision silently drops orgs (IN-1); `search`'s lock expires in 30 s so a second reindex starts under the first and overwrites its total (SR-4); `sync_excel` and Akeneo delete have no guard at all (SX-1, AK-5); N replicas debounce auto-reindex independently (QI-5). Where side effects are external, the result is duplicates: webhook POSTs with fresh ids (WH-1, WH-2), customer emails (CK-1), notifications (NT-1), reactions (CC-8), pushes (PU-1). Note the provenance: every duplicated-external-side-effect finding in this class comes from the webhook/email/notification/push consumers — none from `data_sync`, whose writes are idempotent upserts (see the delivery-semantics premise, §3).
**Worst consequence**: duplicate external side effects and shared-cursor clobber. **Done right**: ingest idempotency on `(channel_id, external_message_id)`, inbound webhook receipt dedup by unique violation, push fan-out `ON CONFLICT DO NOTHING`, attachment `claimExpired`.

### C-5 · Multi-phase writes with no transaction, no outbox, no compensation

Create-record → create-domain-row → enqueue with no transaction and no repair (D-13, P-13, S-14); execute-then-bookkeep (S-12, S-13); lastRunAt-then-start (S-14); event row flushed separately from the state it describes (W-15); activity enqueued before the enclosing transaction commits (W-12); five autocommitted phases in `completeUserTask` (W-14); log-then-resume in two transactions (W-16); claim → flush → emit with the emit lost (PU-3, SC-3, PG-3); inline delivery then enqueue with no outbox (EV-4); retry job enqueued before the auto-disable write (WH-4); handler results written only at the end (WH-6); a parallel-loop cap throws and rolls back branch progress while external side effects stay (W-17); BullMQ registration failures are swallowed so DB and Redis diverge (S-20); `search` enqueues every batch *before* creating the progress job (SR-1); upload status and mapping commits straddle the run start (SX-2, SX-3); the Akeneo delete's mapping wipe is unconditional after a loop of swallowed failures (AK-4). A crash at any seam leaves a state no one reconciles.
**Worst consequence**: permanent `pending` zombies (D-13), lost events (PG-3), re-executed handlers (WH-6, W-16). **Done right**: the warranty SLA signal outbox (reserve in a transaction, publish, mark, drain next run); `customers` bulk routes compensating a failed enqueue.

### C-6 · Error handling inverts the retry contract, and retries re-run finished work

Two opposite failure modes coexist. *Swallow-and-complete*: the handler catches, logs and returns green, so the transport's retry never fires and the failure is recorded nowhere durable (D-17, P-19, W-19, W-22, S-15, MS-3, CK-3, WC-2, CA-4, AI-1, AI-2, CC-6, WH-8). *Mark-then-rethrow*: the handler marks the record terminal and rethrows, so the retries are no-ops — unless the mark itself failed, in which case the retry resumes (D-16, D-19). When a retry *does* run, it re-executes work that already succeeded because the retry unit is larger than the idempotent unit: the whole event fan-out (EV-1), the whole probe batch (IN-3, SC-2), the activity plus resume (W-16, W-20), the transition's earlier activities (W-23), the webhook POST (WH-3), the adapter send (CC-4), four parallel claimants (AT-1), the whole reindex from row 1 (QI-1), the import from page 1 (CH-1) — or fails outright on its own earlier work (CB-1). Per-row swallowing completes bulk operations as success with nothing done (CD-1, SR-6, CH-3, AK-4); a step-level async activity never pauses the instance at all, so its output is silently lost (W-5); a Redis error mid-fan-out re-runs the whole notification batch (MS-2). Transient and permanent errors are indistinguishable to the transport (Q-3, Q-12, CC-7, AT-2), and the queue's retry budget is ~3 s total, baked in at enqueue (Q-11).
**Worst consequence**: outcome of one transient error depends on outage duration (D-16). **Done right**: poll-channel's transient/permanent classification with dead-letter and cursor hold-back.

### C-7 · Cancellation is advisory, unfenced and does not cascade

Cancel sets a flag the worker may poll at a boundary it chooses (D-21, P-20); most workers never poll it (P-20 — `search`); `cancelled` is emitted before work stops (D-22, P-21, P-22); cancel on a swept job silently no-ops or rewrites `failed` (P-23); workflow cancel leaves tasks open and activities and timers queued, and later task completion runs on the cancelled instance (W-24, W-25); stuck workflow states cannot be cancelled at all (W-26); disabling a schedule does not reach queued or in-flight work (S-19); parent/child cancel cascade does not exist (P-24, QI-4, AK-3); bulk operations are simply not cancellable (CB-3, CD-4) and search's cancel removes every scoped batch regardless of run (SR-7, SR-9). No `AbortSignal` reaches any handler or custom function (Q-1, W-27).
**Worst consequence**: the UI says cancelled while the adapter keeps writing and holding its lock (D-21). **Done right**: nowhere; #5403 is the beginning of it for one module.

### C-8 · A lost lock is not a stopped handler

The processor is one-argument, so BullMQ 6.0.9 never creates the per-job `AbortSignal` it would supply to a literal three-argument processor; and even with one, BullMQ does not abort that signal on lock-renewal failure by itself — it only emits `lockRenewalFailed`, which has no listener (Q-1, Q-26); a stalled job is redelivered while the previous handler still runs (Q-6, D-8); sync activity timeouts leave phantom executions and retry concurrently (W-21). The only thing that makes two live drivers safe is a domain-side ownership fence at write time — which exists in `data_sync` (`commitBatchProgress`), push, attachments and warranty, and nowhere else.
**Worst consequence**: double page application, double POST, double command. **Done right**: `commitBatchProgress` CAS, push fenced write-backs, attachment lease tokens.

### C-9 · Process-local state is treated as cluster-global

Single-flight maps (CC-9), backoff multipliers (CA-3), throttle caches and stale snapshots (P-26), abandon-sweep in-flight sets (D-24, Q-10), `concurrency: 1` used as a mutex (CC-2, PU-2, CK-3), `syncAll` on every cold start (S-4), per-process claim locks in local mode (S-5, Q-31), detached promises that no shutdown hook tracks (W-1, W-28). The default strategy is single-consumer and the default dev topology violates even that (W-29, Q-19). Per-process `concurrency: 1` is the only "single runner" for every bulk worker (CB-4); N Pub/Sub notifications start N drain chains flushing one channel's state concurrently (CC-5).
**Worst consequence**: two replicas silently double everything that is "protected" by memory. **Done right**: `progress` CAS transitions, the push reaper's per-row guard, the scheduler's advisory claim (for the claim itself).

### C-10 · Time comes from the writer's clock

Every timestamp is `new Date()` on whichever host writes it and sweeps compare an app-clock cutoff against another host's column (P-25); timer math runs on the enqueuing node (W-31); interval schedules drift because `nextRunAt` is recomputed from `now` (S-7). No predicate uses the database clock.
**Worst consequence**: a skewed host sweeps live jobs or never sweeps. **Done right**: nowhere consistently.

### C-11 · No execution history, no metrics, no retention, no operator view

Scheduler dropped its execution table and shows a global last-N window (S-1, S-3); feature-gated schedules are skipped silently forever (S-18); `failed` is non-terminal in practice and the UI cannot explain the flip (P-2); containers and Redis queues are created per event and never closed (CK-2); the sweep's predicates have no index (P-9); BullMQ removes completed jobs immediately and caps failures at 1000 (Q-28); `progress_jobs` has no purge (P-30) and `workflow_events` no pruning (W-33); `integration_logs` grows with every probe because the pruner never runs (IN-2); no metrics anywhere (Q-27); `paused`/`job_id` columns declared and never written (D-26); the dashboard does not refresh and the top bar hides cancelled jobs (D-26, P-33); the engine never emits the lifecycle events it declares (W-34); nine reachable row-vs-reality mismatches with no signal (D-27).
**Worst consequence**: operators cannot tell stuck from healthy (S-24, W-35).

### C-12 · Strategy parity and optional-package absence are silent

The local strategy drops attempts, lock, stall, abandon hooks and concurrency, has no dead-letter and is single-consumer (Q-14, Q-20, Q-31–Q-35); the scheduler's catch-up, history, manual trigger and overlap semantics differ by strategy (S-2, S-5, S-7, S-28); checkout email retries in prod and not in dev (CK-1); an enqueue during a Redis outage blocks the HTTP request for minutes before failing (Q-21); without the optional `scheduler` package every module's maintenance silently does not run (S-22). Integration tests run on the strategy that cannot exhibit the production failure modes.
**Worst consequence**: bugs that exist only in production, tests that cannot see them.

### C-13 · The contracts are too thin to be checked

`enqueue(data)` accepts anything, so a `{ name, payload }` wrapper ships to a worker reading `payload.x` (PG-1, SC-1, ST-1); an unknown job type is a success (Q-13); `_idempotencyKey` is a convention no type enforces (S-9); the custom-function and activity contracts carry no em, signal, job id or idempotency token (W-36, W-38); `JobContext` cannot tell a throw-retry from a stall-redelivery (Q-4); `attemptNumber`/`lockDuration` are merged or dropped per strategy (Q-7, Q-32); two concurrency knobs and two divergent handler implementations exist for one worker (W-30); a source-flow webhook is routed to an adapter lookup by endpoint id (WH-7); a claim is keyed on one scope and released on another (ST-2); the adapter contract has no finalize phase so adapters smuggle one into the drain read (D-3). The `progress` interface documents rules ("MUST heartbeat", "MUST check cancellation") that nothing enforces and most consumers break (P-6, P-20). Guard scope and work scope diverge silently — tenant-keyed index vs org-filtered rows (SR-3), tenant-only lock check vs org-scoped acquire (SR-5), hard-coded NULL org in the guard vs the real org in the work (QI-2).
**Worst consequence**: three families of webhooks dropped since March with green tests.

### C-14 · Tests mock the boundary that fails

All async-strategy tests mock `bullmq`; no test in any audited area runs two replicas, a kill mid-job, a stall redelivery, a lost lock, a crash between two flushes, a duplicate delivery, or a sweep from its real call site (part 2 §1–§5 "Tests" paragraphs; part 1 has no test-gap section — its scenarios S1–S11 were derived from code, and no data_sync test reproduces any of them). Tests that exist often codify the hazard (`sync-scheduled.test.ts:132-150` asserts `lastRunAt` is set *before* enqueue).
**Worst consequence**: every class above is invisible to CI.

---

## 3. Requirements

Derived from the classes above. **MUST** = without it at least one High finding, or an entire class, remains reachable; **SHOULD** = needed for the "done once, enterprise scale" bar the maintainers set; **MAY** = desirable, not load-bearing. Each requirement names the classes it discharges and an acceptance criterion that a test or a query can check. None of them prescribes *where* the mechanism lives or *what it is called* — those are §4.

### The delivery-semantics premise (per consumer)

Every requirement below is bounded by one question the earlier drafts did not ask per consumer: **is this consumer's unit of work idempotent under redelivery?** Where it is, at-least-once delivery plus a fence at the commit is a complete correctness story, and the heavyweight requirements (R-C slicing, a claim-time lease) become optimisations rather than obligations. Where it is not, they bind in full.

| Consumer | Unit | Idempotent under redelivery? | Consequence |
|---|---|---|---|
| `data_sync` import | one batch: upstream reads + upserts keyed by external id + fenced cursor commit | **yes** — writes are upserts, `storeExternalIdMapping` self-heals duplicates (`id-mapping.ts:48-115`), counters/cursor sit behind the `commitBatchProgress` CAS (`sync-run-service.ts:306-336`), so a duplicated batch costs wasted reads, never corruption | at-least-once suffices; R-F3 is discharged by re-running the batch; R-C1 (per-slice hand-back) is **optional** — a re-drive redoes at most one batch — while R-C2 (bounded shutdown) and R-C4 (the `AbortSignal`) still apply and phase 1 ships them. Phase 1 (parts 5–6) builds on this |
| `data_sync` export | one batch of external writes | **contract, not fact** — no in-repo adapter implements `streamExport` today; the adapter contract must require exporters to forward an idempotency key (R-D4) before one ships | R-D4 binds at the contract level now, enforced when the first exporter lands |
| webhooks, customer emails, notifications, pushes, channel reactions | one external side effect | **no** — the C-4 evidence for duplicate side effects (WH-1/WH-2, CK-1, NT-1, PU-1, CC-8) is exclusively from these consumers | R-D4 + R-F3 bind in full; these are the consumers a leased/keyed mechanism exists for, and none of them adopts in phase 1 — part 4 §Staging gates the mechanism on their adoption |

This table is the sizing instrument for part 4: a mechanism must be justified by the consumers that adopt it, not by the worst finding anywhere in the catalogue.

### A. One record, one clock

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-A1 | Every unit of background work that can outlive a request **MUST** have exactly one durable record, in a transactional store that can be written in the same transaction as the domain row it belongs to, that answers: what kind, for which tenant/org, which domain row it belongs to, its status, who owns it now, when that ownership expires, and how far it got. | C-2, C-11 | For any kind of work there is one table and one query that lists "live work whose owner has not been heard from for > T". |
| R-A2 | Liveness **MUST** be expressed as a lease (owner + expiry) on that record, extended by a heartbeat that is **independent of progress writes** and runs for the whole duration of the work, including non-progress phases. | C-2 (P-6, D-6) | A handler that makes no progress for 10× the lease TTL while alive is not marked stale; a killed handler's record is detectable within 2× TTL. |
| R-A3 | Every lease, timeout and ordering predicate **MUST** use the database clock, never the writer's. | C-10 | No `new Date()` participates in any liveness comparison; a host with a skewed clock can neither expire nor extend a lease. |
| R-A4 | Every non-terminal status **MUST** either carry a lease or be an explicit "waiting for X" where X is itself durable (a timer with a due time, a signal, a user task) and **MUST NOT** be mistaken for orphaned work. | C-2 (W-6, W-35, S-24) | For each status the answer to "what wakes this up, and where is that recorded?" is a column, not a convention. |
| R-A5 | Domain data (cursors, contexts, results) **MUST** stay on domain rows; the record holds lifecycle, ownership and counters only. | C-11 (W-32, W-33) | The record carries no kind-specific data and its size does not grow with the amount of work done. |

### B. Repair is a server-side, tenant-agnostic, replica-safe process

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-B1 | A repairer **MUST** run in the worker tier on a schedule, over all tenants, independent of any HTTP request, browser tab or user scope. | C-3 (D-5, P-3, P-4) | With no client connected, an orphaned record is detected and acted on within one tick. |
| R-B2 | The repairer **MUST** handle at least: pending-never-claimed, running-lease-expired, waiting-past-due, and domain-row ↔ record divergence; and it **MUST** take ownership with a CAS before acting so a slow-but-alive driver cannot keep a record the repairer has taken. | C-3, C-8 | After repair, the previous driver's next write is refused. |
| R-B3 | Repair **MUST** be bounded: re-drive up to a budget, then fail with a durable reason; healthy long-running work **MUST NOT** consume that budget. | C-1 (D-1 stall budget), C-6 | A run that legitimately spans 100 slices and 3 deploys is never failed by the repairer. |
| R-B4 | N repairer replicas **MUST** be safe and **SHOULD** share the work rather than each scanning everything. | C-9 | Two ticks on the same orphan set produce exactly one action per record. |
| R-B5 | In-process drivers (CLI, inline local-mode handlers) **MUST** either go through the same record and lease or be refused; there **MUST NOT** be a path that drives work without a lease. | C-3 (D-10, W-1) | Killing a CLI driver leaves a record the repairer recognises. |

### C. The unit of work is bounded and resumable

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-C1 | A handler **MUST** be able to stop at a durable boundary and continue later, such that a duplicate or stale continuation performs no work; the transport's lock, stall and retry machinery then apply to a bounded slice. *Applicability (§3 premise): for a consumer whose unit is idempotent under redelivery, "stop at a durable boundary and continue" is satisfied by redelivery-from-the-committed-cursor; per-slice hand-back is required only where redelivery is not free.* | C-1 | A 7,000-batch run completes across deploys without consuming stall budget and without any in-handler retry loop. |
| R-C2 | Shutdown **MUST** be bounded: a worker receiving SIGTERM finishes or yields within a configurable deadline and releases its leases explicitly; redelivery after a clean shutdown **MUST NOT** wait for lock expiry. | C-1 (Q-15, D-2) | SIGTERM with a live slice → record released and re-driven within one tick, no stall counted. |
| R-C3 | Sweeps over sets (channels, claims, transactions, sessions) **MUST** be bounded per slice and resume from a durable cursor, not restart from row 0. | C-1 (CA-4, WC-1, AI-2) | A killed sweep resumes where it stopped. |
| R-C4 | The handler **MUST** receive an `AbortSignal` that fires on cancellation, lease loss and shutdown, and **SHOULD** be able to ask for more time explicitly. | C-7, C-8 (Q-1) | A handler awaiting I/O observes cancellation within one heartbeat interval. |

### D. Single-runner and idempotency are enforced, not advised

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-D1 | "At most one live unit of work per key" **MUST** be enforced by the store, not by a check-then-insert in application code, with the key chosen by the owner (stream, schedule, channel, instance). | C-4 (D-11, P-10, S-8, CC-1) | Two concurrent starts yield one record and one 409; no window exists between check and insert. |
| R-D2 | Every enqueue **MUST** be able to carry a deterministic id / dedup key, and the transport **MUST** honour it where it can; where it cannot, the claim **MUST** refuse duplicate, stale and early deliveries. | C-4, C-13 (Q-2, S-9) | A duplicate delivery performs no work and leaves no trace beyond a counter. |
| R-D3 | Claims **MUST** be atomic compare-and-swap with an owner token, and every subsequent domain write **MUST** be fenced on that token. | C-8 | Two drivers of one record: exactly one commits each unit; the other's write affects zero rows. |
| R-D4 | The handler **MUST** receive an idempotency key it can forward to external side effects (webhook ids, email message ids, provider calls) and to commands. | C-4, C-6 (WH-1, CK-1, W-38) | A retried delivery reaches the receiver with the same id. |

### E. Writes that belong together commit together

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-E1 | Creating the record and the domain row it belongs to **MUST** be one transaction. | C-5 (D-13, S-14) | No state exists in which one is present without the other. |
| R-E2 | Enqueue failure after commit **MUST** leave a state the repairer re-drives (pending-never-claimed); a pending zombie that blocks future work **MUST NOT** be reachable. | C-5 | Redis down at enqueue → the row is picked up when Redis returns, without manual action. |
| R-E3 | A status change and the event describing it **MUST** not be separable by a crash: either one transaction, or emit-after-commit with the emission itself repairable. | C-5 (W-15, PU-3, SC-3) | Killing between write and emit loses nothing observable after repair. |
| R-E4 | Work whose success is recorded by a marker **MUST** set the marker *after* the side effect succeeds, in a state distinct from "in progress". | C-5, C-2 (MS-1, WH-2) | A kill mid-send leaves an `in-progress` row that the repairer resolves, never a false `sent`. |

### F. Errors are classified, recorded, and retried at the right granularity

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-F1 | A handler **MUST NOT** swallow a failure of durable work and complete green; failures **MUST** reach the record (reason, count) and the transport (retry or terminal). | C-6 | No audited "catch → log → return" remains in a worker that owns a record. |
| R-F2 | Transient and permanent failures **MUST** be distinguishable to the transport (fail-fast for permanent), with an owner-supplied classification and a safe default of "retry". | C-6 (Q-12, AT-2, CC-7) | A permanent error is terminal after one attempt; a transient one retries with backoff until a budget resets on committed progress. |
| R-F3 | The retry unit **MUST** equal the idempotent unit: per-subscriber for fan-outs, per-slice for long work, per-row for sweeps; retries **MUST NOT** re-run sub-steps that already succeeded. *Applicability (§3 premise): where the whole unit is idempotent under redelivery, re-running it **is** compliance — the prohibition targets consumers whose sub-steps have external effects.* | C-6 (EV-1, W-23, IN-3) | Subscriber A's success survives subscriber B's failure and retry. |
| R-F4 | The outcome of a transient error **MUST NOT** depend on how long the outage lasted. | C-6 (D-16) | The same fault injected for 1 s, 5 s and 5 min yields the same end state after repair. |
| R-F5 | Retry policy (attempts, backoff, budget) **MUST** be settable per kind and changeable without re-enqueueing existing work. | C-6 (Q-11) | Changing a kind's policy affects the next retry of already-queued work. |

### G. Cancellation is a fenced transition that cascades

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-G1 | Cancel **MUST** be a state transition on the record that the handler observes within a bounded time (via R-C4), after which its fenced writes fail. | C-7 | Cancel at t; no domain write after t + heartbeat interval succeeds. |
| R-G2 | The `cancelled` terminal state and its event **MUST** be reached only when the work has actually stopped; until then the record is "cancel requested". | C-7 (P-21, D-22) | The UI never shows cancelled while a writer holds a lock. |
| R-G3 | Cancel **MUST** cascade to children (parallel branches, activities, continuation deliveries, queued jobs) and **MUST** be possible from every non-terminal state. | C-7 (W-25, W-26, P-24) | Cancelling a parent leaves no live child and no queued delivery that will do work. |

### H. Replica-safe by construction

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-H1 | No coordination state (single-flight, backoff, throttles, in-flight sets, sweep cursors) **MAY** live in process memory; all of it **MUST** be in the database or the transport. | C-9 | Running two replicas of every worker changes no observable outcome. |
| R-H2 | The mechanism **MUST** be safe for multiple web replicas, multiple worker replicas, and mixed versions during a rollout. | C-9, C-1 | A rolling deploy with work in flight loses nothing and duplicates nothing. |
| R-H3 | Per-tenant failures and slowness **MUST** be isolated from other tenants in sweeps and ticks. | C-9 (S-27) | One tenant's hung handler delays no other tenant's schedule. |

### I. Scale envelope

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-I1 | Heartbeats **SHOULD** be cheap writes: 10k live records heartbeating every 15 s **MUST NOT** degrade the store or the repairer's queries. | C-2 | Sustained 700 heartbeats/s for an hour shows no growth in table or index size beyond the rows written. |
| R-I2 | Records **MUST** have a retention policy and **SHOULD** expose metrics: live/waiting by kind, lease age p99, orphans per tick, re-drives, fallbacks in use. | C-11 | Terminal records older than the policy are gone; each metric is queryable. |
| R-I3 | Fan-out (parent with N children, cancel cascade, "parent completes when children are terminal") **SHOULD** be representable without a second mechanism. | C-7, C-2 | A partitioned reindex and a parallel workflow branch set are each one parent with N children, cancellable as one. |

### J. Transport is a replaceable, conformance-tested dependency

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-J1 | The mechanism **MUST** require only at-least-once delivery from the transport; dedup ids, delay, retry, abort and bounded close are optimisations with defined fallbacks. | C-12, C-13 | The same owner code passes against BullMQ and against the local strategy. |
| R-J2 | Every strategy **MUST** pass one conformance suite that exercises duplicate, late, early and lost deliveries, kill mid-handler, and two consumers; documented differences **MUST** be explicit capabilities, not surprises. | C-12, C-14 | A new strategy is a file plus a green conformance run. |
| R-J3 | The payload contract between enqueue sites and handlers **MUST** be typed end-to-end so a shape mismatch fails at compile time or at enqueue, never silently in the worker. | C-13 (PG-1, Q-13) | Re-introducing the PG-1 wrapper fails `yarn typecheck` or the enqueue call. |
| R-J4 | Absence of an optional package that owns periodic work **MUST** be loud — visible at startup and at the feature that depends on it — not silent inertness. | C-12 (S-22) | Booting without the package produces a logged warning and every dependent feature reports its unavailability. |

### K. Operators can see and act

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-K1 | Every kind of work **MUST** have an execution history with retention (scheduler firings included) that survives transport eviction. | C-11 (S-1, Q-28) | "Did the 03:00 sync fire on Tuesday, and what happened?" is one query. |
| R-K2 | Operators **MUST** be able to list live/stuck work across kinds, re-drive, cancel and inspect the last error, with RBAC, without editing rows. | C-3, C-11 | Every row of part 1 §7 (zombie matrix) is resolvable from the operator surface. |
| R-K3 | User-facing state (top bar, dashboards) **MUST** reflect the authoritative record, refresh without reload, and render every status including cancelled and waiting. | C-11 (D-26, P-33) | No status value renders as an empty card; a status change is visible without a reload. |

### L. One mechanism, many owners

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-L1 | The same mechanism **MUST** be usable by `data_sync` runs, bulk operations that use `progress` today, the `workflows` driver (advance slices, activities, timers, signals), scheduler executions, and the per-module claim patterns, so that each stops carrying its own partial copy. | all | The inventory in §1 collapses to one mechanism plus domain pointers. |
| R-L2 | Owners **MUST** declare their kind of work (how to drive it, what to do when it is orphaned or cancelled, who may act on it) so the repairer and operator tooling reach them without importing them. | C-3 | Adding a kind touches no shared file. |
| R-L3 | Adoption **MUST** be incremental and additive under `BACKWARD_COMPATIBILITY.md`: existing `progress.job.*` events, `ProgressService`, `Queue`/`JobContext`, `sync_runs`, scheduler and workflow contracts keep working while owners migrate. | all (adoption constraint) | Existing consumers compile and pass unchanged after the mechanism ships. |

### M. Verified the way it fails

| ID | Requirement | Discharges | Acceptance |
|---|---|---|---|
| R-M1 | The mechanism **MUST** ship with integration tests on real Postgres and real Redis covering: SIGKILL mid-slice, SIGTERM at deadline, lost lock with a live handler, duplicate/late/early delivery, two worker replicas, crash between record and domain write, cancel during I/O, and repairer vs live driver. | C-14 | Each scenario is a named test that fails on today's code. |
| R-M2 | Every owner adopting it **MUST** add the scenario tests that apply to its kind; tests **MUST NOT** pass a hand-built payload shape to a worker. | C-14, C-13 | Each adopting module's tests enqueue through the real route/command and assert the worker's effect. |

---

## 4. Decisions deliberately left to the solution spec

These are real choices with trade-offs; the requirements constrain them but do not make them. Each needs a recommendation with rationale in the next document.

| # | Decision | Constraints from §3 |
|---|---|---|
| Δ-1 | **Where the record lives**: grow `progress` (already has status, heartbeat, cancel flag, parent id, tenant scope, CAS transitions, events, SSE, UI, ACL, ~40 consumers, a sweep in the wrong place) vs a new module vs a shared library used by each owner. | R-A1 (one record), R-L3 (additive), C-13 (contracts must be enforceable), and the cost of two records that disagree (part 1 §8). |
| Δ-2 | **Naming** (the problem statement already has four things called "jobs"). | R-L1 |
| Δ-3 | **Continuation transport**: new delivery per slice with a deterministic id vs the transport's delayed-move primitive vs both. | R-C1, R-J1 |
| Δ-4 | **Lease table vs lease columns on domain rows** for owners that already have a row (`sync_runs`, `workflow_instances`, per-module claims). | R-A1, R-A5, R-E1 |
| Δ-5 | **Record store pluggability**: the constraints (R-E1 atomicity with domain rows, R-A3 one clock) point at the application database; whether to abstract it anyway is a choice. | R-E1, R-A3, R-J1 |
| Δ-6 | **Repairer host**: the `scheduler` package (optional today, S-22) vs a worker-owned tick vs both. | R-B1, R-J4 |
| Δ-7 | **Slice budget defaults** and who may override them. | R-C1, R-C2 |
| Δ-8 | **How `workflows` adopts it**: instance ≠ job; what is a slice; whether event sourcing stays. | R-L1, R-A5 |
| Δ-9 | **Whether to adopt an external durable-execution engine** (Temporal/Inngest/pg-boss-class) instead of building the mechanism; and if not, whether to keep the door open as a driver. | R-J1, R-L3, the repo's "Ask First" on production dependencies |
| Δ-11 | **Outbox / inbox**: whether job delivery, domain-event emission and subscriber fan-out share one transactional-outbox + idempotent-inbox mechanism, or each keeps its own (today: none for events, ad-hoc claim tables for webhooks/payments). | R-E1–E4, R-F3, R-D4 |
| Δ-10 | **Sequencing**: which narrow, mechanism-independent fixes (the §0.1 bugs and the residue listed in part 1 §9) land before the mechanism, and in what order. | — |

---

## 5. Traceability

**Finding-id legend.** Part 1: `D-n`. Part 2: `Q-n` (queue), `P-n` (progress), `W-n` (workflows), `S-n` (scheduler), and per-worker prefixes `SR` (search), `QI` (query_index), `CB` (catalog bulk), `CD` (customers bulk), `CH` (communication_channels import), `SX` (sync_excel), `AK` (sync_akeneo), `WH` (webhooks), `EV` (events), `NT` (notifications), `MS` (messages), `PU` (push), `CK` (checkout), `CC` (channels), `IN` (integrations), `AI` (ai_assistant), `AT` (attachments/storage), `PG` (payment_gateways), `SC` (shipping_carriers), `ST` (gateway-stripe), `WC` (warranty_claims), `CA` (customer_accounts). This part: `C-n` classes, `R-Xn` requirements, `Δ-n` open decisions.

### 5.1 Class → findings

The table is the superset; the prose of §2 cites the representative findings only.

| Class | Part 1 | Part 2 |
|---|---|---|
| C-1 | D-1, D-2, D-8, D-23 | Q-1, Q-3, Q-6, Q-15, Q-16, W-4, W-28, SR-2, QI-1, CB-3, AK-1, AK-2, CC-6, AI-1, AI-2, PG-2, SC-2, WC-1, CA-2, CA-4 |
| C-2 | D-4, D-6, D-7, D-13, D-28 | P-1, P-4, P-6, P-8, P-11, P-29, W-6, W-35, S-1, S-14, S-24, SR-4, QI-2, QI-6, CH-4, WH-2, WH-6, MS-1 |
| C-3 | D-5, D-9, D-10, D-27, D-28 | Q-8, Q-9, P-3, P-4, P-5, P-34, P-36, W-1, W-6, W-7, W-8, S-15, QI-2, AK-1, WH-2, EV-3, MS-1 |
| C-4 | D-11, D-12, D-15 | Q-2, P-10, P-11, P-12, W-3, W-10, W-11, S-5, S-8, S-9, S-10, S-11, SR-4, SR-5, SR-9, QI-5, CH-2, SX-1, AK-5, WH-1, WH-2, NT-1, PU-1, CK-1, CC-1, CC-2, CC-3, CC-8, CC-9, IN-1 |
| C-5 | D-13, D-14 | P-13, P-14, W-12, W-14, W-15, W-16, W-17, S-12, S-13, S-14, S-17, S-20, SR-1, QI-3, CB-2, CH-2, SX-2, SX-3, AK-4, AK-6, WH-4, WH-6, EV-4, PU-3, PG-3, SC-3 |
| C-6 | D-16, D-17, D-18, D-19, D-20 | Q-3, Q-4, Q-11, Q-12, Q-13, P-15, P-16, P-18, P-19, W-5, W-9, W-16, W-19, W-20, W-22, W-23, S-15, S-16, SR-6, SR-8, QI-1, CB-1, CD-1, CD-2, CD-3, CH-1, CH-3, AK-3, AK-4, WH-3, WH-8, EV-1, MS-2, MS-3, CK-3, CC-4, CC-6, CC-7, IN-3, AI-1, AI-2, AT-1, AT-2, SC-2, WC-2, CA-4 |
| C-7 | D-21, D-22 | Q-1, P-17, P-20, P-21, P-22, P-23, P-24, W-24, W-25, W-26, W-27, S-19, S-21, SR-7, SR-9, QI-4, CB-3, CD-4, AK-3 |
| C-8 | D-8 | Q-1, Q-6, Q-26, W-21 |
| C-9 | D-24, D-25 | Q-10, Q-19, Q-31, P-26, P-27, W-1, W-28, W-29, S-4, S-5, S-27, QI-5, CB-4, EV-2, PU-2, CK-3, CC-2, CC-5, CC-9, CA-3 |
| C-10 | — | P-25, W-31, S-7 |
| C-11 | D-26, D-27 | Q-27, Q-28, Q-30, P-2, P-9, P-30, P-31, P-32, P-33, W-2, W-32, W-33, W-34, W-35, S-1, S-2, S-3, S-18, S-24, S-25, CK-2, IN-2 |
| C-12 | — | Q-14, Q-18, Q-20, Q-21, Q-25, Q-31, Q-32, Q-33, Q-34, Q-35, W-29, S-2, S-5, S-7, S-22, S-28, CK-1 |
| C-13 | D-3 | Q-4, Q-5, Q-7, Q-13, Q-32, P-6, P-20, P-35, W-30, W-36, W-37, W-38, S-9, S-29, SR-3, SR-5, QI-2, WH-7, PG-1, SC-1, ST-1, ST-2 |
| C-14 | — (no data_sync test reproduces S1–S11) | every "Tests" paragraph of part 2 |

### 5.2 Requirement → classes

Derived from the *Discharges* column of §3.

A → C-2, C-10, C-11 · B → C-1, C-3, C-6, C-8, C-9 · C → C-1, C-7, C-8 · D → C-4, C-6, C-8, C-13 · E → C-2, C-5 · F → C-6 · G → C-7 · H → C-1, C-9 · I → C-2, C-7, C-11 · J → C-12, C-13, C-14 · K → C-3, C-11 · L → all · M → C-13, C-14

## Changelog

- 2026-08-25 — Added the **delivery-semantics premise** (§3): per-consumer idempotence-under-redelivery table; R-C1/R-F3 applicability notes; C-4 provenance note (the duplicate-side-effect evidence is exclusively non-`data_sync`). No classes, findings or ids changed. Follows the maintainer scope discussion on PR #5450.
- 2026-08-21 — Initial version. Supersedes the solution-first documents removed the same day (`2026-08-21-data-sync-architecture-review.md` §10–§12 and `2026-08-21-jobs-module-durable-background-work.md`, earlier drafts not retained); their design content is intentionally not carried forward here and will be re-derived against §3 in a separate solution spec.
- 2026-08-21 — §0 rewritten for readability (the three decisions asked of the reader stated up front; id legend moved from the header to §5); no classes, requirements, decisions or ids changed.
