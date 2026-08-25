# Background work, part 6 — phase 1: `data_sync` hardening on the existing fence

**Date**: 2026-08-21
**Status**: Draft v5.0 — the phase-1 implementation spec, replacing the former parts 6–8 (leased tier in `progress`, `data_sync` adoption, operator surface; full designs preserved at commit `205fbd53f` and kept by part 4 as the blueprint for the trigger-gated leased tier). Depends on part 5. Awaiting review.
**Series**: [part 1](./2026-08-21-background-work-01-data-sync-problems.md) — `data_sync` problems (D-n) · [part 2](./2026-08-21-background-work-02-sibling-modules-problems.md) — sibling modules (Q/P/W/S/… ids) · [part 3](./2026-08-21-background-work-03-common-problems-and-requirements.md) — classes C-1…C-14, requirements R-A…R-M, the delivery-semantics premise · [part 4](./2026-08-21-background-work-04-solution.md) — options, decision, invariants, staging · [part 5](./2026-08-21-background-work-05-queue-transport-contract.md) — queue transport hardening · [part 6](./2026-08-21-background-work-06-data-sync-hardening.md) — phase 1: `data_sync` hardening.
**Scope of this spec**: `data_sync` and the `progress` sweep only. Two additive `sync_runs` columns, one partial unique index, a server-side reconciler worker, an in-engine error taxonomy with bounded transient retry, cooperative shutdown, fenced terminal transitions, and the adapter at-least-once contract. **No `progress_jobs` schema change, no lease columns, no kind registry, no new module surface.** Closes fsh#101.

## 📝 TLDR

Part 3's requirements assumed every consumer needs the full leased-job mechanism. The delivery-semantics premise (part 3 §3 premise) showed `data_sync` does not: its unit of work is already idempotent under redelivery — imports are upserts keyed by external id, `storeExternalIdMapping` self-heals duplicates, and the `commitBatchProgress` ownership fence (`sync-run-service.ts:306-336`, `expectedBatchesCompleted` CAS) already guarantees exactly one driver advances a run. What `data_sync` is missing is not a lease — it is (1) a repairer that runs server-side instead of inside a browser-driven GET, (2) a start that cannot strand a `pending` row, (3) a single-runner guarantee the database enforces, (4) an error taxonomy so a transient outage does not end days of work, and (5) a shutdown that stops at a batch boundary instead of being SIGKILLed. This spec ships those five things against the existing fence. A false-positive stale detection is **safe by construction**: the worst a duplicate driver can do is waste one batch of upstream calls before the fence aborts it — the premise that makes a simple reconciler correct where part 3 C-2 would otherwise demand a fencing lease.

## 📝 Problem Statement

Part 1 findings closed here: D-4/D-5 (liveness owned by a browser-driven, org-scoped sweep that never reaches the run row), D-9/D-10 (abandon reports depend on a 1000-entry window; in-process drivers leave `running` forever), D-11 (double start on one cursor), D-13 (`pending` row stranded when the enqueue fails), D-14 (unfenced terminal transitions), D-16/D-17/D-19 (one transient error ends the run, or is swallowed green, or the mark-then-rethrow makes retries no-ops), D-23/D-2 (every deploy is a SIGKILL plus a stall-budget unit), D-26 partial (`sync_runs.job_id` never written), D-27 (zombie matrix rows with no repairer). Downgraded rather than closed: D-1 (an interruption still re-does at most one batch — measured via §5's telemetry, and revisited by part 4's trigger T-b). Explicitly out of scope with named owners: §8.

## 📝 Design

### §1 Transactional start and the relay (D-13)

`startDataSyncRun` (`lib/start-run.ts`) becomes: **one transaction** creating the progress job and the run row, commit, **then** enqueue with a deterministic id.

- The progress-job create and `syncRunService.createRun` run inside a single forked-EM transaction (`ProgressService.createJob` gains an optional `em` option — ADDITIVE on the STABLE interface — so both creates share it; its `progress.job.created` event is emitted after commit); the run row commits with `status = 'pending'` and `job_id = 'data-sync-run-<runId>'` (the deterministic first id; colon-free — BullMQ 6.0.9 rejects custom ids containing `:`, part 5).
- `queue.enqueue(payload, { queueJobId: run.jobId })` after commit. If the enqueue throws, the route still returns the run: the row is now the outbox, and the reconciler (§3) re-enqueues any `pending` run older than `pendingTtl`. The HTTP 500 + poisoned-`pending` failure mode of D-13 is gone.
- `queueJobId` dedup (part 5) makes the relay idempotent against the original enqueue racing it.

### §2 Single-runner enforced by the database (D-11)

- Partial unique index on `sync_runs`: `(integration_id, entity_type, direction, organization_id, tenant_id) WHERE status IN ('pending', 'running') AND deleted_at IS NULL` — the same key `findRunningOverlap` checks (`sync-run-service.ts:437`). The SELECT stays as the friendly pre-check producing today's 409; the index is the guarantee. `createRun` catches the unique violation and raises the same 409 (`data_sync.errors.runAlreadyActive`), so two racing POSTs, a scheduler tick racing a manual start, and `retry` racing `run` all collapse to one winner.
- **Migration pre-step (required)**: existing installs can hold exactly the duplicate live rows this index forbids — that is D-11 happening. Before creating the index, the migration marks all but the newest live row per key as `failed` with `last_error = 'superseded: duplicate live run closed by migration'` (their cursor is shared per stream, so no committed progress is lost). Stated in the migration file and UPGRADE_NOTES; the count is logged.
- `sync_runs.job_id` (exists since the entity was created, never written — D-26) is now written on every enqueue and re-enqueue and is the reconciler's re-drive fence (§3).

### §3 The server-side reconciler (D-4, D-5, D-9, D-10, D-27)

Two small repeatable workers (hosted on part 5's `WorkerMeta.repeatable`), each owned by the module whose data it repairs — no shared registry, no generic sweeper:

**`progress` — `workers/stale-sweep.ts`**, `repeatable: { id: 'progress-stale-sweep', everyMs: 60_000 }`. Calls the existing `markStaleJobsFailed` logic tenant-wide (a new `sweepStaleJobs()` service method iterating tenants; same per-row CAS, same `STALE_JOB_TIMEOUT_SECONDS`). The sweep in `GET /api/progress/active` remains for one release as belt-and-braces and is removed in a follow-up once the worker is the proven owner (UPGRADE_NOTES). Liveness repair no longer depends on a browser being open or on the polling user's org scope.

**`data_sync` — `workers/sync-reconcile.ts`**, `repeatable: { id: 'data-sync-reconcile', everyMs: 60_000 }`. Every cutoff in its predicates is computed in SQL against the **database clock** (`now() - interval`), never the worker's clock (R-A3); the timestamps compared (`heartbeat_at`, `updated_at`) are producer-written and may skew, which the generous TTLs and the safety of false positives absorb.

A `running` run is **stale** when the first matching condition holds:

- **(a) its linked progress job is terminal** while the run is not — the fast path: a killed worker's progress job stops heartbeating and the `progress` sweep fails it within ~`STALE_JOB_TIMEOUT_SECONDS` (60 s), so the very next reconciler tick sees the mismatch. This is what closes D-27's row-vs-reality window to a couple of minutes instead of leaving `sync_runs` and `progress_jobs` disagreeing for the length of a long TTL;
- **(b) its linked progress job's `heartbeat_at` is older than `stallTtl`** (default 30 min) — the backstop when the sweep has not fired;
- **(c) it has no progress job** (`createProgressJob: false`, D-10) and `sync_runs.updated_at` is older than `stallTtl` (`updated_at` ticks on every `commitBatchProgress`).

One tick, batched (≤ 100 runs), per rule:

| Run state | Condition | Action |
|---|---|---|
| `pending` | older than `pendingTtl` (default 5 min) | re-enqueue via the §3a fence (covers D-13's stranded row and an enqueue lost by the broker) |
| `running` | stale **and** `cancel_requested_at` set on the linked progress job | mark `cancelled` via the §4 terminal CAS instead of re-driving — a cancel that the dead worker never observed completes here (D-22's revived-zombie case); the progress job is marked `cancelled` too if the sweep beat it to `failed` |
| `running` | stale **and** `redrives_since_commit >= maxRedrives` (default 5) | mark `failed` via the §4 terminal CAS, `last_error = 'stalled after N re-drives'`; fail the linked progress job with the same message **unless it is already terminal**. The run is parked for the operator; the existing Retry route is the re-drive of last resort |
| `running` | stale | re-drive via the §3a fence. The re-driven delivery's `startJob` revives a swept progress job through the existing revive CAS (`failed → running`, the `staleSweptOnly` path `touchJobHeartbeat`/`updateProgress` already use); if the job is not revivable the engine proceeds on the run row's authority alone |

**§3a The re-drive fence and the identity/budget split.** Two columns, deliberately not one (the blueprint's `redrives` vs `redrives_since_commit` split, kept because collapsing them breaks the id scheme): **`redrive_count`** is a monotone identity — it only ever increases, and it is the source of the delivery id — while **`redrives_since_commit`** is the budget, reset to 0 inside `commitBatchProgress`'s fenced write. The fence: `UPDATE sync_runs SET job_id = $newId, redrive_count = redrive_count + 1, redrives_since_commit = redrives_since_commit + 1, updated_at = now() WHERE id = $id AND job_id = $oldId AND status IN ('pending','running') AND deleted_at IS NULL` — affected = 1 wins and enqueues `queueJobId = $newId`; affected = 0 means another reconciler replica (or the returning worker) got there first, drop. `$newId` is `data-sync-run-<runId>-r<redrive_count+1>`: monotone, so a fresh id every re-drive for the lifetime of the run — BullMQ dedup treats a retained `failed` job under an old id as live (part 5) and would silently swallow a reused one, which is exactly what a budget counter that resets on progress would produce. The budget resetting on committed progress means a long run that keeps moving never parks, while a run that redoes the same batch five times does — the Sidekiq Pro shape part 4 §Research B records.

**Why a false positive is safe** (the load-bearing premise): a re-drive while the original worker is alive creates a second driver; both run until the next `commitBatchProgress`, where the `expectedBatchesCompleted` CAS admits exactly one and aborts the other with `SyncRunOwnershipConflictError` — the path that already exists and is already tested. Cost: at most one duplicated batch of upstream reads and idempotent upserts (part 3 §3 premise). This is why the backstop `stallTtl` can be generous and the fast path can trust a 60-second sweep.

`onJobAbandoned`/`failAbandonedRun` (worker restart reports) stays: it is a faster, cheaper signal when it fires. The reconciler is the authority that no longer depends on it firing (D-9).

### §4 Error taxonomy and fenced terminal transitions (D-14, D-16, D-17, D-19)

- **Taxonomy**: a `classifySyncError(error)` helper in the engine — `transient` (network errors, timeouts, HTTP 408/429/5xx, `TransientSyncError` thrown by an adapter) vs `terminal` (everything else, plus `QueueUnrecoverableError` from part 5). Adapters MAY throw `TransientSyncError`/`QueueUnrecoverableError` to override classification (exported from the module; category ADDITIVE).
- **Transient path** (the fsh#101 fix): the engine retries **the batch fetch from the committed cursor** — the idempotent unit — with exponential backoff (base 5 s, factor 2, cap 5 min), up to `maxConsecutiveTransientFailures` (default 5, **reset on every committed batch**). Exhausted → the engine rethrows leaving the run `running`: the transport's `attempts`/`backoff` (`DATA_SYNC_QUEUE_ATTEMPTS = 3` already configured, `lib/queue.ts:23`) redeliver and resume from the cursor; transport exhausted → the reconciler observes the stale run and re-drives on its own budget. The outcome of a transient error no longer depends on how long the outage lasts (D-16): seconds are absorbed in-engine, minutes by the transport, hours by the reconciler, and only a persistent failure parks the run with the real error.
- **Terminal path**: the engine marks the run `failed` (fenced, below) and **returns without rethrowing** — the queue job completes and the transport's retries are not spent on a run that already refuses redelivery. This removes both halves of D-17/D-19's divergence (swallow-and-complete vs mark-then-rethrow-no-op): failure is recorded exactly once, in the run row, and the queue's view agrees.
- **Fenced terminal transitions** (D-14): `markStatus` for `completed`/`failed`/`cancelled` becomes a `nativeUpdate` CAS — `WHERE status IN ('pending','running')` — mirroring the claim CAS that already exists for `running` (`sync-run-service.ts:194-214`). Concurrent finalizers (worker vs cancel route vs reconciler) produce exactly one terminal write and one event; the loser reads the winner's row and reports it.

### §5 Cooperative shutdown (D-2, D-23 partial)

- The worker handler passes `ctx.signal` (part 5: populated on SIGTERM relay, lock-renewal failure, close timeout) into the engine. The engine ORs it with its existing cancellation controller **for the adapter's `signal`** (the adapter contract already carries one, `sync-engine.ts:628`) but tracks the two separately: cancellation finalizes `cancelled`; interruption throws `SyncInterruptedError` after the in-flight batch's commit, leaving the run `running`.
- `SyncInterruptedError` propagates to the transport as a failed attempt → redelivery resumes from the committed cursor. Before throwing, the engine emits **`data_sync.run.interrupted`** (payload `{ runId, batchesCompleted, reason: 'shutdown' | 'lock_lost' }`) and a structured log line — the durable per-interruption record that, together with the monotone `redrive_count`, is part 4 trigger T-b's instrument for measuring what deploys actually cost. The runner's relay-then-bounded-close (part 5) gives the batch up to `QUEUE_CLOSE_TIMEOUT_MS` (25 s) to commit; only a batch longer than the grace is killed, and that batch is redone — safely, by the premise.
- Honest accounting: an interruption still spends a transport attempt and, on a hard kill, a stall-budget unit (`DATA_SYNC_MAX_STALLED_COUNT = 10`). The reconciler is the backstop that turns "budget exhausted" from *run stranded forever* into *re-driven, then parked with an operator-visible error*. Removing the per-batch redo entirely is the leased tier's slicing (part 4 trigger T-b); `data_sync.run.interrupted` (per-interruption), `data_sync.run.redriven` and the monotone `redrive_count` are the telemetry that decides whether it is ever needed.

### §6 The adapter at-least-once contract (D-15 reframed; part 3 §3 premise made enforceable)

- `DataSyncAdapter` docblocks and `data_sync/AGENTS.md` gain the rule: **a batch MAY be delivered more than once; every item-level write MUST be idempotent** (imports: upsert keyed by external id; exporters — none exist in-repo — MUST forward an idempotency key derived from `(runId, cursor, localId)` to the external system). `storeExternalIdMapping`'s duplicate self-heal (`id-mapping.ts:48-115`) is documented as intended behaviour under this contract, not a defect.
- A conformance helper in the adapter test kit: deliver the same `ImportBatch` twice, assert identical end state (row counts, mappings, no duplicate entities). Both in-repo adapters (`sync_akeneo`, `sync_excel`) run it in CI.

### §7 Configuration

| Env var | Default | Meaning |
|---|---|---|
| `OM_DATA_SYNC_PENDING_TTL_MS` | 300000 | age before a `pending` run is re-enqueued |
| `OM_DATA_SYNC_STALL_TTL_MS` | 1800000 | heartbeat/progress age before a `running` run is re-driven |
| `OM_DATA_SYNC_MAX_REDRIVES` | 5 | `redrives_since_commit` cap: consecutive re-drives without a committed batch before the run parks as `failed` |
| `OM_DATA_SYNC_TRANSIENT_RETRIES` | 5 | consecutive in-engine transient retries before rethrowing to the transport |

## 📝 Edge Cases & Failure Scenarios

| # | Scenario (part 1 id) | Behaviour under this spec |
|---|---|---|
| 1 | Deploy kills mid-batch (S1, D-23) | SIGTERM → signal → engine throws `SyncInterruptedError` after the commit; ≤ 25 s grace; redelivery resumes at the cursor; at most one batch redone (idempotent) |
| 2 | Transient upstream error (S2, D-16) | in-engine backoff from the committed cursor; budget resets on progress; escalates transport → reconciler → parked `failed` with the real error |
| 3 | Two drivers after a false-positive re-drive (S3) | both run one batch; `commitBatchProgress` CAS admits one; the loser aborts on `SyncRunOwnershipConflictError` — existing tested path |
| 4 | Double POST / scheduler-vs-manual race (S5, D-11) | unique index: one winner, one 409 |
| 5 | Redis down at enqueue (S6, D-13) | run commits `pending`; reconciler re-enqueues within `pendingTtl`; no stranded 409-generator |
| 6 | Worker SIGKILLed, abandon report lost (S8, S10, D-9) | the progress sweep fails the job in ~60 s, the next reconciler tick takes the terminal-progress-job fast path and re-drives; the abandon report is an optimisation |
| 7 | In-process CLI driver killed (S9, D-10) | run has no progress job; `updated_at` staleness re-drives it through the queue (the CLI path now enqueues rather than driving in-process — see plan step 6) |
| 8 | Cancel of a run whose worker died (S4, D-22) | reconciler observes `cancel_requested_at` + staleness → terminal CAS `cancelled`; no revived zombie |
| 9 | Reconciler replicas race one run | §3a `job_id` CAS: one enqueues, others drop; duplicate delivery is contained by dedup + the batch fence anyway |
| 10 | Run stuck redoing one poisoned batch | `redrives_since_commit` never resets without progress → parks at `maxRedrives` as `failed` with a saying error; Retry is the operator re-drive |

## 📝 Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| False-positive re-drive duplicates upstream reads | Low | adapters, rate limits | generous `stallTtl`; fence bounds it to one batch; premise makes writes idempotent | wasted API quota on slow batches > 30 min |
| Unique index blocks a legitimate concurrent run shape someone relied on | Low | API | the index matches the overlap check the API already enforces via SELECT; only the race window closes | none identified |
| Migration closes a duplicate live row that was in fact healthy | Low | migration | only non-newest duplicates per key are closed; the shared cursor preserves committed progress; count logged, UPGRADE_NOTES | a healthy duplicate loses its uncommitted batch — the state D-11 calls corrupt anyway |
| Terminal-CAS change alters `markStatus` semantics for external callers | Medium | STABLE service surface | the non-terminal claim CAS already exists; terminal writes gain the same guard; last-writer-wins was D-14, a defect | callers that depended on overwriting a terminal status break — none in-repo; UPGRADE_NOTES |
| Engine no longer rethrows terminal errors — external monitors watching queue-job failures lose a signal | Low | ops | `data_sync.run.failed` event + run row are the authoritative signals; documented | queue-level dashboards undercount |
| Reconciler mass–re-drives after a long queue outage | Low | worker fleet | per-tick batch cap (100 runs, `SKIP LOCKED`-style paging); backoff via fresh `job_id` per drive | delayed recovery, by design |

## 📝 Backward compatibility review

| Surface (BACKWARD_COMPATIBILITY.md category) | Change | Class |
|---|---|---|
| DB schema (8) | `sync_runs.redrive_count` and `sync_runs.redrives_since_commit` (`int not null default 0`); partial unique index (with the §2 duplicate-close pre-step) | ADDITIVE / new constraint enforcing documented behaviour |
| Service `SyncRunService.markStatus` (2) | terminal transitions become CAS; unchanged signature | behavioural — UPGRADE_NOTES |
| `DataSyncAdapter` (2/3) | docblock contract + optional `TransientSyncError`; no signature change | ADDITIVE |
| `ProgressService.createJob` (2) | optional `em` option; event deferred to after commit when supplied | ADDITIVE |
| Events (5) | new `data_sync.run.redriven` (payload `{ runId, redriveCount, by }`) and `data_sync.run.interrupted` (payload `{ runId, batchesCompleted, reason }`) | ADDITIVE |
| Queue payloads | `queueJobId` on enqueue; payload shape unchanged — in-flight deliveries from the previous release carry no id and are processed as today | none |
| `progress` GET sweep | retained one release, then removed (follow-up) | deprecation protocol |

**Rollback**: redeploying the previous `data_sync` worker/engine and removing the two repeatable workers restores today's behaviour exactly — the GET-route sweep is still in place for the transition release, `redrive_count`/`redrives_since_commit` are ignored by old code, and the down-migration drops the two columns and the index. The §2 duplicate-close pre-step is the one irreversible piece; it only touches rows the unique index (and today's overlap SELECT) already declares invalid, and it logs what it closed.

## 📋 Integration coverage (each a named test that fails on today's code)

1. `TC-DSYNC-H01` kill the worker mid-run (SIGTERM and SIGKILL variants); assert the run resumes from the committed cursor and completes; no duplicate entities.
2. `TC-DSYNC-H02` two concurrent POST `/run` for one stream: one 201, one 409; exactly one live row (index, not SELECT, under concurrency).
3. `TC-DSYNC-H03` enqueue made to fail at start: run lands `pending`, reconciler tick re-enqueues, run completes.
4. `TC-DSYNC-H04` stale `running` run (heartbeat frozen): reconciler re-drives; after `maxRedrives` without progress it parks `failed` with the stall error; Retry then succeeds.
5. `TC-DSYNC-H05` adapter throws a transient error mid-stream: run completes after in-engine retry; `redrive_count` untouched; a terminal error marks `failed` once, queue job green.
6. `TC-DSYNC-H06` same batch delivered twice (conformance helper) on both in-repo adapters: identical end state.
7. `TC-DSYNC-H07` cancel a run whose worker is gone: reconciler finalizes `cancelled`; UI state agrees.
8. `TC-PROG-H01` stale progress job with no browser polling: worker sweep fails it within the tick interval, tenant-wide.

## 📋 Implementation Plan

1. Migration: `redrive_count` + `redrives_since_commit` + the §2 duplicate-live-row close pre-step + partial unique index; `yarn db:generate`, snapshot; entity + validator updates. Unit: index violation → 409 mapping; migration applies on a table seeded with duplicate live rows.
2. `startDataSyncRun` transaction + deterministic `job_id` + post-commit enqueue (uses part 5 `queueJobId`).
3. `markStatus` terminal CAS; cancel route and engine finalizers on it. Unit: concurrent finalizer matrix.
4. Engine: `classifySyncError`, transient retry loop, terminal no-rethrow, `SyncInterruptedError` on `ctx.signal`, both import and export paths.
5. Reconciler worker + `progress` sweep worker (part 5 `WorkerMeta.repeatable`); `redrive_count` reset inside `commitBatchProgress`; `data_sync.run.redriven` event.
6. CLI `pull` switches from in-process engine drive to enqueue-and-wait (closes D-10's uncovered driver).
7. Adapter contract docblocks, `TransientSyncError`, conformance helper + both adapters' tests; `data_sync/AGENTS.md` + `progress/AGENTS.md` updates; UPGRADE_NOTES.
8. Integration suite TC-DSYNC-H01…H07, TC-PROG-H01; 3-replica kill soak (salvaged from the former part 7) as a nightly job.

## 📝 Out of scope — named owners

- D-20 (Akeneo client caches a rejected promise as `null` — silent data loss): **own ticket, own PR**; ~5-line fix in `packages/sync-akeneo/.../client.ts:683-746`, independent of everything here.
- D-12 (adapter advisory locks), D-3 (adapter finalize phase), D-6 full heartbeat coverage, D-21 sub-batch cancel latency: deferred; D-3 and D-21 are naturally solved by slicing if trigger T-b ever fires.
- The leased tier, operator re-drive UI, `yield`, kind registry: part 4 §4.5, built when a trigger fires, from the archived designs.
- Part 2's production bugs (PG-1/SC-1/ST-1 and §0.1): already tracked as separate tickets.

## Changelog

- **2026-08-25 v5.0.1**: fresh-context verification pass. §3a split into the identity/budget pair (`redrive_count` monotone as the delivery-id source, `redrives_since_commit` as the resetting budget) — a single resetting counter would regenerate an id BullMQ still retains and the re-enqueue would silently no-op; §3 gained the terminal-progress-job fast path (the 60 s sweep and the 30 min `stallTtl` otherwise leave a ~29 min run-vs-job mismatch, recreating D-27), the DB-clock rule for reconciler predicates, and the progress-job revive on re-drive; §5 gained the `data_sync.run.interrupted` event so trigger T-b's instrument actually exists; §2 gained the duplicate-live-row migration pre-step (the index cannot build over exactly the rows D-11 produced); rollback stated.
- **2026-08-25 v5.0**: Replaced the leased-tier design (former parts 6–8, archived at `205fbd53f`) with the phase-1 hardening built on the existing `commitBatchProgress` fence and the part 3 delivery-semantics premise, per maintainer scope discussion on PR #5450.
