# Background work, part 7 — `data_sync` adoption of the leased tier

**Date**: 2026-08-21
**Status**: Draft v1 — implementation spec split out of part 4 v3 (§5.10, Phase 2 + the `data_sync` items of Phase 0). Awaiting review; three `data_sync/AGENTS.md` Ask-First items flagged for the module owners. Step 0 depends on part 5 only; the rest depends on part 6.
**Series**: [part 1](./2026-08-21-background-work-01-data-sync-problems.md) — `data_sync` problems (D-n) · [part 2](./2026-08-21-background-work-02-sibling-modules-problems.md) — sibling modules (Q/P/W/S/… ids) · [part 3](./2026-08-21-background-work-03-common-problems-and-requirements.md) — classes C-1…C-14, requirements R-A…R-M, open decisions Δ-1…Δ-11 · [part 4](./2026-08-21-background-work-04-solution.md) — options, decision, shared invariants · [part 5](./2026-08-21-background-work-05-queue-transport-contract.md) — queue transport contract · [part 6](./2026-08-21-background-work-06-leased-jobs-in-progress.md) — leased tier in `progress` · [part 7](./2026-08-21-background-work-07-data-sync-adoption.md) — `data_sync` adoption · [part 8](./2026-08-21-background-work-08-operator-surface.md) — operator surface.
**Scope of this spec**: `data_sync` as the first leased kind — `startDataSyncRun` atomicity, the engine as a bounded slice, the ownership fence extended with the lease epoch, rethrown errors, fenced cancel, the CLI and the scheduled trigger through the lease, the run-status mirror, and the soak that proves it. Plus **step 0**, the mechanism-independent hardening that only needs part 5 (`queueJobId`, `sync_runs.job_id`, the stall default) and can ship first. Closes fsh#101.

## 📝 TLDR

A run stops being one multi-day queue job and becomes a chain of ≤ 5-minute slices under a `progress_jobs` lease: created atomically with its `sync_runs` row, single-runner by a partial unique index instead of a racy SELECT, heartbeated through both `next()` and the handler phase, yielding on budget and SIGTERM, rethrowing transient errors so the transport retries the slice, refusing stale deliveries by identity, cancelled cooperatively through the lease's own channel, repaired by the reconciler under `orphanPolicy: 'redrive'` (the adapter contract is idempotent by construction), and **mirrored onto `sync_runs.status` in the same transaction as every terminal transition** so the dashboard can never show a run as `running` after its job has ended.

## 📝 Problem Statement

Part 1 in full (D-1…D-28, scenarios S1–S11); S-14 from part 2. Everything else is inherited from parts 4–6 and not restated.

## 📝 Design — today vs the leased tier

| Today | With the leased tier |
|---|---|
| `startDataSyncRun`: `createJob` → `createRun` → `queue.add` (D-13) | `em.begin()`: `createLeasedJob({ kind, lockKey, subject }, scope, em)` + `createRun` → commit → `emitCreated()` → `enqueueLeasedJob`; enqueue failure → reconciler pending predicate |
| `findRunningOverlap` plain SELECT (D-11) | kept for the 409 message only; the **partial unique index** on `lock_key = data_sync:<integrationId>:<entityType>:<direction>[:<scopeKey>]` is the guarantee; the unique violation maps to the same 409 |
| one BullMQ job = whole run (D-1) | `step()` drives `forEachBatch` until `sliceBudgetMs` (5 min) or `k` batches, returns `budget`; the engine stops *after* a yield, never mid-`next()`; the adapter is closed (`iterator.return()`), the next slice reopens from `run.cursor` — the replay clause already required of every adapter |
| heartbeat only around `next()` (D-6) | `heartbeat()` called around `next()` **and** the handler phase; `committed: true` after `commitBatchProgress` |
| ownership fence `status='running' ∧ batches_completed=N` | fence adds `EXISTS (select 1 from progress_jobs p where p.id = run.progress_job_id and p.lease_owner = $owner and p.lease_epoch = $epoch)` — a cross-module SQL reference, read-only, no ORM relation; no lease column on `sync_runs` |
| engine swallows errors (D-17, D-16) | engine **rethrows**; `QueueUnrecoverableError` for the fatal allowlist (from fsh#101, fail-fast only); transport retries the slice (`attempts 5`, exponential 5 s, max 5 min); `consecutive_failures` resets on commit; at `maxConsecutiveFailures` the slice fails terminally |
| post-commit bookkeeping unguarded (D-18) | wrapped: log/progress write failures are logged, never fatal |
| cancel advisory, `markCancelled` immediately (D-21, D-22) | `signal` from the heartbeat response; engine checks `signal.aborted` at the batch boundary and passes `signal` to the adapter (#5403); `cancelled` written by the slice in the terminal transaction that also mirrors the run |
| `onJobAbandoned` + 5-min sweep (D-9) | retired for data_sync queues (kept in `packages/queue` for others); reconciler + `orphanPolicy: 'redrive'` (the adapter contract is idempotent by construction); `maxRedrives 10`, poison after 3 redrives without a committed batch |
| CLI `pull` in-process, no lease (D-10) | CLI creates the leased job on its own forked EM transaction and either enqueues it (default) or runs `runSlice` in-process under the same lease; a killed CLI is an orphan the reconciler sees |
| `sync-scheduled`: `lastRunAt` flushed before anything durable (S-14) | start the run first (one transaction), then `lastRunAt`; a second firing hits the unique index → 409 → skipped (Fivetran semantics) |
| stale sweep from the browser (D-5) | reconciler; `sync_runs.status` mirrored by `onTransition` **inside the terminal transaction** (part 6 §7, `mirror: 'atomic'`) on every terminal/park/cancel transition (D-28) — a run can no longer stay `running` while its job is terminal |
| `paused` declared, never written (D-26) | unchanged here; becomes `waiting` in the Q6 follow-up |

Adapter contract: **signature unchanged**. Three `data_sync/AGENTS.md` Ask-First items are changed by this spec (overlap detection, cancellation delivery, lifecycle writes) — flagged for the module owners.

**Ask-First items changed** (`data_sync/AGENTS.md`): overlap detection (SELECT → unique index), cancellation delivery (flag → lease channel + `signal`), lifecycle writes (`markCancelled`/`markCompleted` from the engine → `onTransition` in the terminal transaction). Flagged for the module owners; nothing else in that file changes.

## 📝 Contracts

- `LeasedJobKind` registrations: `data_sync.import` and `data_sync.export`, `queue` = the existing per-direction queues, `requiredFeatures: ['data_sync.run']`, `lease: { ttlMs: 60_000, sliceBudgetMs: 300_000, pendingTtlMs: 900_000 }`, `budget: { maxRedrives: 10, maxConsecutiveFailures: 5, poisonRedrivesWithoutCommit: 3 }`, `orphanPolicy: 'redrive'`, `mirror: 'atomic'`.
- `lock_key = data_sync:<integrationId>:<entityType>:<direction>[:<scopeKey>]`; `subject = { type: 'data_sync.run', id: run.id }`.
- `onTransition(job, scope, em)`: one fenced UPDATE — `update sync_runs set status = $mapped, finished_at = coalesce(finished_at, now()), error_message = $msg where id = $runId and progress_job_id = $jobId and status in ('pending','running')` — idempotent, no events; `data_sync.run.completed|failed|cancelled` are emitted from the after-commit hook.
- Ownership fence in `commitBatchProgress`: existing `status='running' ∧ batches_completed=N` **and** `exists (select 1 from progress_jobs p where p.id = sync_runs.progress_job_id and p.lease_owner = $owner and p.lease_epoch = $epoch)` — a read-only cross-module SQL reference, no ORM relation, no lease column on `sync_runs`.
- Adapter contract: **signature unchanged**; the replay clause (reopen from `run.cursor`) is now exercised on every yield.
- `sync_runs.job_id` (text, exists, never written): carries the latest `queue_job_id` from step 0 on.

## 📝 Edge Cases & Failure Scenarios (the part 1 scenarios under this design; mechanism-level cases are in part 6)

| Scenario | Behaviour under this design |
|---|---|
| S1 deploy, two replicas, mid-batch | SIGTERM → runner aborts `signal` → engine finishes the current batch → `yieldSlice({interrupted:true})` → `ctx.yield({data})` → `close()` returns; the new pod claims the rewritten delivery at once. No stall, no attempt, no budget. Grace shorter than a page (Railway default 0 s): SIGKILL → lease expires ≤ 60 s → reconciler takes and re-drives within one tick with `redrives+1`, reset by the next committed batch. |
| S2 transient error mid-batch | `failSlice` + rethrow → transport retries the same delivery after 5 s/10 s/…; the retry claims (lease expired, same `seq, redrives`) and resumes from `run.cursor`. Same end state whether the outage lasted 1 s or 5 min (R-F4). After 5 consecutive failures with no commit → terminal `failed`. |
| S5 double start | second `createLeasedJob` violates the partial unique index inside the transaction → both rows roll back → 409. No window. |
| S6 enqueue fails after the row exists | row `pending` with `pending_since`, no lease; reconciler Q2 re-drives it after `pendingTtl` (15 min) with a new delivery id. |
| S7 stale sweep false positive | leased rows are not subject to the heartbeat-based sweep; the lease is heartbeated through the handler phase. |
| S8 abandoned while alive | no stall budget consumed by deploys; a poison page parks after 3 redrives without a commit (`error_code='poison'`) with operator re-drive. |
| S9 in-process CLI killed | orphan under the same lease → reconciler. |
| S10 abandon report lost | not needed: the reconciler reads Postgres. |
| S11 Akeneo reconciliation after last yield | unchanged here; the `finalizeRun` adapter hook is a data_sync follow-up. |
| Heartbeat inside the slice's domain transaction | impossible by construction: `heartbeatLease` runs on a forked EM (invariant 1); the engine's `withAtomicFlush` transaction never contains a lease statement. |
| Rolling deploy with mixed versions | new columns nullable/defaulted; old workers ignore them; old `startDataSyncRun` still works (tracked tier) until the data_sync worker is updated — this spec ships worker and route together. |
| Run completes, then the process dies before `sync_runs` is updated | impossible under part 6 §7: the run's `status` is written by `onTransition` in the same transaction as the job's terminal CAS; a crash before commit leaves both `running`, the lease expires, the reconciler re-drives, `step()` finds the cursor at the end and returns `drained`, and the terminal transaction is retried. |

## 📝 Risks & Impact Review

| Risk | Sev | Mitigation | Residual |
|---|---|---|---|
| `DATA_SYNC_MAX_STALLED_COUNT` default raised (step 0) | Low | UPGRADE_NOTES entry; env override unchanged | — |
| `data_sync` AGENTS.md Ask-First items change | Med | flagged; this spec is its own PR | maintainers may ask for B |
| `findRunningOverlap` replaced by the unique index as the guarantee | Low | the SELECT stays for the 409 message; the index is the guard; test asserts the violation maps to the same 409 | — |
| `onJobAbandoned` retired for data_sync queues | Low | kept in `packages/queue` for other consumers; the reconciler covers the case | — |
| Adapter replay clause now load-bearing (resume from `run.cursor` after every yield) | Med | already required of every adapter; the soak exercises it 500 times with kills | an adapter that violated it silently today will fail loudly |
| Rollback | — | redeploy the previous `data_sync` worker and route; leased rows in flight are parked by the reconciler (`no_handler`) and can be cancelled; step 0 is independently revertible | — |

## 📝 Backward compatibility review

| Surface | Change | Class |
|---|---|---|
| 8 DB schema | none on `sync_runs` | — |
| 7 API routes | `POST …/runs` unchanged shape; the 409 now comes from the unique violation (same body) | — |
| 5 event ids | `data_sync.run.*` unchanged; emitted after the terminal commit (slightly later than today) | documented |
| 12 CLI | `mercato data_sync pull` creates a leased job (visible in the progress UI; a killed CLI is repaired) | behaviour change, UPGRADE_NOTES |
| env | `DATA_SYNC_MAX_STALLED_COUNT` default raised (step 0) | UPGRADE_NOTES |
| `data_sync/AGENTS.md` Ask-First | three items above | flagged |

## 📋 Integration coverage (R-M1/M2)

1. Engine slice loop: budget → yield → resume from cursor; fence refusal on a stale epoch; `committed: true` after each fenced commit resets the counters.
2. `startDataSyncRun` atomicity: unique-index violation rolls both rows back and returns 409; no `progress.job.created` event.
3. Scheduled double-fire → second start hits the index → 409 → skipped; `lastRunAt` written only after the run exists.
4. Cancel during adapter I/O → adapter receives `signal` → run `cancelled` and mirrored in one commit.
5. Existing `data_sync` integration specs green.
6. **Soak**: docker-compose with 3 worker replicas, a fake adapter producing 500 batches, a supervisor SIGKILLing one replica per minute and flushing Redis once; assert every `(run_id, batch_no)` appears exactly once in a test ledger the adapter writes inside the fenced commit, `sync_runs.batches_completed = 500`, `sync_runs.status = 'completed'` with `finished_at` set, and no row is left `running`/`pending`/unmirrored after the reconciler's next tick.

## 📋 Implementation Plan

0. **Hardening that needs only part 5** (ships first, independently): `queueJobId: run:<id>` on enqueue; write `sync_runs.job_id`; raise the `DATA_SYNC_MAX_STALLED_COUNT` default to a large finite value; UPGRADE_NOTES; deployment-grace docs cross-link. Closes D-2 and S8's budget half.
1. `start-run.ts`: `em.begin()` → `createLeasedJob` + `createRun` → commit → `emitCreated` → `enqueueLeasedJob`; `lock_key` scheme; 409 from the unique violation; `findRunningOverlap` kept for the message.
2. Engine: `step()` over `forEachBatch` with budget/k-batches; heartbeat around `next()` + handler; `committed: true` after the fenced commit; fence extended with the epoch `EXISTS`; rethrow; `QueueUnrecoverableError` allowlist (from fsh#101, fail-fast only); post-commit bookkeeping wrapped; `signal` to the adapter.
3. Kind registrations + `onTransition` (one fenced UPDATE, idempotent, no events) + after-commit event hook; worker files rebind to `runSlice`; `onJobAbandoned` removed for data_sync queues; CLI `pull` through the lease; `sync-scheduled` start-then-`lastRunAt`.
4. Remove/adjust: `abandoned-run.ts` (keep for export until it adopts), the heartbeat-only-around-`next()` helper, the `createProgressJob: false` path (lease mandatory; the CLI creates the job).
5. Integration coverage above, incl. the soak.
6. `data_sync/AGENTS.md` Ask-First items updated; spec changelog; close fsh#101 as superseded.

## Open items for review

- `sliceBudgetMs` 5 min vs `pendingTtlMs` 15 min (part 4 decision 4).
- Whether export adopts in the same PR or keeps `abandoned-run.ts` one release longer.

## Changelog

- 2026-08-22 — Draft v1: split out of part 4 v3 §5.10 + Phase 2 (+ the `data_sync` items of Phase 0 as step 0) after review (PR #5450). `onTransition` specified as the single fenced UPDATE that runs inside part 6's terminal transaction; S1–S11 carried over with a new "completes then dies before the run is updated" row; contracts, compatibility review, rollback and integration coverage made explicit for this spec alone.
