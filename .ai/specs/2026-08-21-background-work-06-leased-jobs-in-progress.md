# Background work, part 6 — leased jobs in `progress`

**Date**: 2026-08-21
**Status**: Draft v1.2 — implementation spec split out of part 4 v3 (§5.3–5.7, Phase 1), revised for the terminal-transition finding of the PR #5450 review (v1), the way out of `parked` (v1.1) and the domain side of the re-drive plus the durable mirror counter (v1.2). Awaiting review; blocked on part 4 decisions 1–3. Depends on part 5; blocks parts 7 and 8.
**Series**: [part 1](./2026-08-21-background-work-01-data-sync-problems.md) — `data_sync` problems (D-n) · [part 2](./2026-08-21-background-work-02-sibling-modules-problems.md) — sibling modules (Q/P/W/S/… ids) · [part 3](./2026-08-21-background-work-03-common-problems-and-requirements.md) — classes C-1…C-14, requirements R-A…R-M, open decisions Δ-1…Δ-11 · [part 4](./2026-08-21-background-work-04-solution.md) — options, decision, shared invariants · [part 5](./2026-08-21-background-work-05-queue-transport-contract.md) — queue transport contract · [part 6](./2026-08-21-background-work-06-leased-jobs-in-progress.md) — leased tier in `progress` · [part 7](./2026-08-21-background-work-07-data-sync-adoption.md) — `data_sync` adoption · [part 8](./2026-08-21-background-work-08-operator-surface.md) — operator surface.
**Scope of this spec**: the leased tier of the `progress` module — additive schema, lease and transition SQL, the service API and kind registry, `runSlice`, the reconciler and retention workers, the terminal-transition protocol, cancellation semantics, the re-drive route and DTO fields. Inert until a kind registers. Vocabulary and invariants are part 4 §5.1–5.2 and are not restated; "invariant n" below refers to them.

## 📝 TLDR

A `progress_jobs` row whose `kind` is registered becomes a **leased job**: it carries a lease (`lease_owner`, `lease_epoch`, `lease_expires_at`) on the database clock, a single-runner `lock_key` enforced by a partial unique index, a delivery identity `(continuation_seq, redrives)` that refuses stale deliveries, and budgets that reset only on committed progress. A worker runs it as a chain of bounded slices (`runSlice`), each under one lease, yielding on budget or SIGTERM through the transport's hand-back (part 5). A worker-side reconciler on a transport repeatable repairs orphans, lost hand-backs, dead cancels and — new in this version — unmirrored terminal states. **Every terminal transition (complete, fail, park, cancel) commits in one transaction with the kind's domain mirror**, so a generic job record and its domain record can never disagree for longer than one reconciler tick; kinds whose domain row lives outside the app database opt into a deferred, reconciler-retried mirror instead.

## 📝 §1 Problem Statement

Part 3 classes C-1…C-14 as they apply to `progress` (P-3, P-4, P-5, P-24, P-30, P-34) and to every adopter; part 4 §4 chose this module as the home. The v3 design had one hole the review found: `runSlice` and the reconciler performed the terminal CAS *first* and called `onTransition` *after*, so a crash or a throwing callback between the two left a terminal `progress_jobs` row beside a `running` domain row that no reconciler query ever selected again — exactly the divergence R-B2/R-E3 exist to prevent. §7 closes it.

## 📝 §2 Data model

Additive migration on `progress_jobs` (category 8, ADDITIVE-ONLY). No column is dropped, renamed or retyped; no existing default changes. Expression indexes are declared with MikroORM's `@Index({ expression })` (precedent: `customer_interactions_email_dedupe_uq`, `warranty_claims_external_ref_unique`).

```sql
alter table progress_jobs
  add column lease_owner          text null,
  add column lease_epoch          bigint not null default 0,
  add column lease_expires_at     timestamptz null,
  add column lock_key             text null,              -- non-null ⇔ leased tier; single-runner key
  add column queue_name           text null,
  add column queue_job_id         text null,              -- last enqueued delivery id (pj-<id>-<seq>-<redrives>); for removeJob
  add column subject_type         text null,              -- 'data_sync.run'
  add column subject_id           text null,
  add column continuation_seq     int  not null default 0,
  add column redrives             int  not null default 0,   -- monotone; part of the delivery identity
  add column redrives_since_commit int not null default 0,   -- budget; reset by a committed heartbeat (HOT)
  add column interruptions        int  not null default 0,
  add column consecutive_failures int  not null default 0,
  add column pending_since        timestamptz null,       -- set on create, yield and take; the reconciler's pending clock
  add column next_run_at          timestamptz null,       -- reconciler backoff / operator re-drive time (not the deferred timer feature)
  add column last_committed_at    timestamptz null,
  add column parked_at            timestamptz null,
  add column error_code           text null,              -- 'orphaned' | 'poison' | 'never_started' | 'no_handler' | 'unrecoverable' | owner codes
  add column domain_mirrored_at   timestamptz null,       -- set when the kind's onTransition committed for the terminal state AND its fenced UPDATE matched the domain row (§7); null on a terminal leased row ⇒ Q5 retries the mirror
  add column mirror_attempts      int  not null default 0;   -- failed domain-mirror attempts since the last successful terminal commit (§7 step 5); written in its own autocommit statement, never inside the rolled-back transaction; mirror_stuck ⇔ mirror_attempts >= maxMirrorAttempts

alter table progress_jobs set (fillfactor = 80);

-- single-runner: at most one live operation per key per tenant/org (R-D1). NULL org is constrained (zero-uuid), unlike the
-- warranty_claims precedent; PG15 NULLS NOT DISTINCT was considered and rejected to keep PG14 support.
create unique index progress_jobs_one_live_per_lock_key
  on progress_jobs (lock_key, tenant_id, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where lock_key is not null and status in ('pending','running');

-- reconciler scans: predicates exclude every heartbeat-written column (invariant 6). Q1 below filters lease_expires_at
-- inside this bounded set (a scan of live leased rows every tick; acceptable to ~10k live rows — see §6 cost note).
create index progress_jobs_leased_running_idx on progress_jobs (tenant_id) where status = 'running' and lock_key is not null;
create index progress_jobs_leased_pending_idx on progress_jobs (pending_since) where status = 'pending' and lock_key is not null;
create index progress_jobs_subject_idx       on progress_jobs (subject_type, subject_id) where subject_type is not null;
create index progress_jobs_retention_idx     on progress_jobs (finished_at) where status in ('completed','failed','cancelled');
create index progress_jobs_mirror_pending_idx on progress_jobs (finished_at) where lock_key is not null and subject_type is not null
  and status in ('completed','failed','cancelled') and domain_mirrored_at is null;   -- Q5: terminal rows whose domain mirror has not committed
```

Down-migration: drop the six indexes and the twenty columns, reset `fillfactor`. Data in the new columns is discarded; the tracked tier is unaffected. Backfill: `update progress_jobs set domain_mirrored_at = finished_at where status in ('completed','failed','cancelled')` — one statement, no branch: `subject_type` is added by the same ALTER, so every pre-existing row has no subject and nothing for Q5 to mirror.

- The existing `progress_jobs_status_tenant_idx` stays. `heartbeat_at` stays unindexed; so does `mirror_attempts` (it is read by part 8's "stuck" derivation inside the bounded leased set, never as a scan key).
- `meta` keeps today's rule (display-only, no credentials); `error_message` goes through the integration-log redaction.
- Per-kind configuration lives in the **registry**, not in columns.
- `ProgressJobStatus` is unchanged. Retention (§6) never deletes a terminal row whose `domain_mirrored_at` is null and `subject_type` is set — the mirror must land first. A park for an **unregistered kind** (`error_code = 'no_handler'`) has no mirror to run, so its CAS sets `domain_mirrored_at = now()` itself ("no domain mirror" is a *satisfied* mirror, not a pending one) and the row is collected by retention like any other failed row (§9, test 11). The Q6 follow-up will add `waiting`, `run_after` and full parent/child semantics; `next_run_at` and `pending_since` are intentionally narrower so that follow-up does not re-audit the claim predicate.
- `sync_runs` gains nothing here (part 7): `progress_job_id` already exists and is the link.
- `ProgressJobDto` (list/active/SSE) gains optional `cancelRequestedAt`, `parkedAt`, `errorCode`, `mirrorAttempts` and a server-derived boolean `redrivable` (category 2, additive) so the UI can render "cancelling", "parked" and "stuck", and enable **Re-drive** from exactly the predicate of the §3 `redrive` statement rather than guessing from status.

## 📝 §3 Lease semantics

Each statement is one autocommit transaction on a forked EM (part 4 invariant 1) — except the terminal transitions, which run inside the terminal transaction of §7 together with the domain mirror, and the operator `redrive`, which runs inside one short transaction together with the domain *re-open* (`onRedrive`) — the same invariant 11 in the other direction.

```sql
-- claim(jobId, owner, scope, { seq, redrives })
update progress_jobs
   set status = 'running', lease_owner = $owner, lease_epoch = lease_epoch + 1,
       lease_expires_at = now() + $ttl, heartbeat_at = now(), pending_since = null,
       started_at = coalesce(started_at, now()), updated_at = now()
 where id = $id and tenant_id = $tenant and (organization_id = $org or ($org is null and organization_id is null))
   and lock_key is not null
   and status in ('pending','running')                                                        -- parked rows are never claimed directly: the operator re-drive below moves them to 'pending' first
   and continuation_seq = $seq and redrives = $redrives
   and (next_run_at is null or next_run_at <= now())
   and (lease_expires_at is null or lease_expires_at < now())
 returning *;

-- heartbeatLease(lease, { processedCount?, totalCount?, committed? })   -- HOT: no indexed column
update progress_jobs
   set lease_expires_at = now() + $ttl, heartbeat_at = now(),
       processed_count = coalesce($p, processed_count), total_count = coalesce($t, total_count),
       consecutive_failures  = case when $committed then 0 else consecutive_failures end,
       redrives_since_commit = case when $committed then 0 else redrives_since_commit end,
       last_committed_at     = case when $committed then now() else last_committed_at end
 where id = $id and status = 'running' and lease_owner = $owner and lease_epoch = $epoch
 returning cancel_requested_at;                    -- zero rows ⇒ lease lost or taken ⇒ abort the slice's signal

-- yieldSlice(lease, { interrupted })               -- then hand the delivery back with the NEW seq in its payload (§5 step 4)
update progress_jobs
   set status = 'pending', continuation_seq = continuation_seq + 1,
       interruptions = interruptions + case when $interrupted then 1 else 0 end,
       lease_owner = null, lease_expires_at = now(), pending_since = now(), updated_at = now()
 where id = $id and status = 'running' and lease_owner = $owner and lease_epoch = $epoch
 returning continuation_seq, redrives;

-- failSlice(lease, error, { nextAttemptAt })      -- slice threw; stay 'running', release the lease, same (seq, redrives) for the transport retry;
--                                                  nextAttemptAt = the transport's next attempt (from the kind's retry policy and ctx.attemptNumber), or now() when attempts are exhausted
update progress_jobs
   set lease_owner = null, lease_expires_at = now(), next_run_at = $nextAttemptAt,
       consecutive_failures = consecutive_failures + 1,
       error_message = $msg, error_code = $code, updated_at = now()
 where id = $id and status = 'running' and lease_owner = $owner and lease_epoch = $epoch;

-- THE RE-DRIVE FAMILY. Three statements share one core — the "re-drive core" below — and differ only in the rows of the table that follows:
--   core: status = 'pending', lease_owner = null, lease_epoch = lease_epoch + 1, lease_expires_at = now(), redrives = redrives + 1,
--         pending_since = now(), updated_at = now()   … returning continuation_seq, redrives, tenant_id, organization_id
--   then enqueueLeasedJob with the new id pj-<id>-<seq>-<redrives> (never an id the transport may still hold — invariant 9, part 5's no-op add).

-- reconciler take (Q1 orphan):                     -- core + the orphan budget + backoff
update progress_jobs
   set <core>, redrives_since_commit = redrives_since_commit + 1, next_run_at = now() + $backoff
 where id = $id and status = 'running' and lock_key is not null
   and lease_expires_at < now() - $grace and (next_run_at is null or next_run_at < now() - $grace);

-- reconciler pending re-drive (Q2 never claimed / hand-back lost):   -- core + the orphan budget, no backoff
update progress_jobs
   set <core>, redrives_since_commit = redrives_since_commit + 1, next_run_at = now()
 where id = $id and status = 'pending' and lock_key is not null
   and greatest(pending_since, coalesce(next_run_at, pending_since)) < now() - $pendingTtl;

-- operator redrive(jobId, by) — the way OUT of 'failed' (parked or terminal) and the manual take of an expired lease.
-- One short transaction on a forked EM, three steps; the job row and the domain row leave the terminal state together, exactly as they entered it (§7):
--   (a) refuse when another live operation holds the key — the partial unique index would otherwise raise from inside the UPDATE:
select id from progress_jobs
 where lock_key = (select lock_key from progress_jobs
                    where id = $id and tenant_id = $tenant and (organization_id = $org or ($org is null and organization_id is null)))
   and tenant_id = $tenant
   and coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($org, '00000000-0000-0000-0000-000000000000'::uuid)
   and status in ('pending','running') and id <> $id
 for update;                                        -- one row ⇒ return { refused: 'lock_key_held', heldBy: id } (HTTP 409, same shape as part 7's start-time 409);
                                                    -- the subselect is tenant/org-scoped too, so an id the caller cannot see yields no rows here and not_redrivable in (b)
--   (b) the CAS: core + BOTH budgets reset (the operator is explicitly asking for more attempts) + every terminal/parked marker cleared.
--       error_code is cleared even when it is 'unrecoverable' — an operator re-drive is a deliberate override of the automatic policy (§5),
--       which is why the event in (d) records the previous code; error_message is kept until the next slice overwrites it.
update progress_jobs
   set <core>, redrives_since_commit = 0, consecutive_failures = 0, mirror_attempts = 0,
       parked_at = null, error_code = null, finished_at = null, domain_mirrored_at = null, next_run_at = now()
 where id = $id and tenant_id = $tenant and (organization_id = $org or ($org is null and organization_id is null))
   and lock_key is not null
   and ((status = 'failed')                                                              -- parked (parked_at set) OR terminal failed (retry budget exhausted, unrecoverable)
     or (status = 'running' and lease_expires_at < now() - $grace))                     -- expired lease the operator does not want to wait a tick for
 returning *;                                       -- zero rows ⇒ { refused: 'not_redrivable' } (completed and cancelled rows are never re-driven: start a new operation instead)
--   (c) the domain side, SAME transaction: kind.onRedrive?(job, scope, em) — the mirror image of onTransition; one fenced UPDATE that re-opens the
--       domain row (data_sync: sync_runs.status = 'running', finished_at = null — part 7). It returns { matched }; matched = 0 (domain row deleted or
--       not in a state this job may re-open) ⇒ rollback, { refused: 'domain_refused' } (HTTP 409). A kind that declares onTransition without onRedrive is
--       rejected by registerJobKind (a mirror with no way back); a kind that is not registered at all ⇒ not_redrivable (there is nothing to run it).
--   commit. A unique violation raised by (b) despite (a) — a concurrent start between the two statements — is caught and mapped to the same 409.
--   (d) after commit: enqueueLeasedJob(new id) and emit progress.job.redriven { jobId, by: { userId }, previousStatus, previousErrorCode, redrives }
--       (clientBroadcast like every progress.job.* event; the structured-log event of the same name carries the same fields).
-- redrive bumps redrives and the epoch like every other re-drive, and touches no other budget mechanism: interruptions stays (it is history, not a budget).

-- completeSlice / terminal fail / cancel: the existing CAS transitions, each extended with `and lease_epoch = $epoch` on the leased tier,
-- and each executed inside the §7 terminal transaction: CAS → onTransition(job, scope, em) → commit (atomic mode), or
-- CAS with domain_mirrored_at = null → commit → Q5 retries onTransition until it sets domain_mirrored_at (deferred mode).
-- A park for an unregistered kind (error_code = 'no_handler') has no mirror: its CAS sets domain_mirrored_at = now() directly (§2).
```

The three re-drive statements, side by side (drift between them is a review-time diff of this table, not an incident):

| Statement | Predicate | `redrives_since_commit` | `consecutive_failures` | `next_run_at` | Markers cleared | Domain hook |
|---|---|---|---|---|---|---|
| Q1 take | `running` ∧ lease expired beyond grace ∧ transport retry passed | `+1` (orphan budget) | unchanged (retry budget is the transport's) | `now() + backoff` (15 s · 2^rsc, ≤ 10 min) | none | none — the domain row is still open |
| Q2 pending re-drive | `pending` ∧ `greatest(pending_since, next_run_at) < now() − pendingTtl` | `+1` | unchanged | `now()` | none | none |
| operator `redrive` | `failed` (parked or terminal) ∨ `running` ∧ lease expired beyond grace; key not held (a) | `0` | `0` | `now()` | `parked_at`, `error_code` (incl. `unrecoverable`), `finished_at`, `domain_mirrored_at`, `mirror_attempts` | `onRedrive` in the same transaction; `matched = 0` ⇒ rollback + `domain_refused` |

All three share the core (`pending`, epoch + 1, `redrives` + 1, `pending_since = now()`) and the new-id enqueue; none resets `redrives` or `interruptions`.

Why `redrive` resets both budgets but never `redrives`: the budgets are the operator's to reset (they are explicitly asking for more attempts, and a row that exhausted `consecutive_failures` would otherwise be one throw from failing again); the identity is not, because a retained transport job or a straggling delivery may still carry the old pair (invariants 5 and 9). Why any `failed` leased row is re-drivable, not only a parked one: the retry budget (S2 in part 7) and the orphan budget end a row in `failed` by different paths, and an operator has the same reason to retry either — a dead end would force a fresh operation under a new `lock_key` holder with no continuity of cursor or history. `completed` and `cancelled` are not re-drivable by design: the first is done, the second was asked for. Why `claim` has no parked branch any more (v1 had one): the `status in ('pending','running')` predicate refuses any delivery for a `failed` row, whatever identity it carries. That is the argument, not "no delivery can exist" — Q2 is the counterexample: its last re-drive's delivery may still be queued when the row is parked `never_started`, carrying exactly the `(seq, redrives)` the parked row holds, and it *will* be delivered. This is a deliberate behaviour choice: a `never_started` park discards a delivery the transport was about to run (v1 would have let it through); the operator `redrive` is the only door, and it issues a new identity.

Why identity and budget are separate counters: if `redrives` could reset to 0, a transport retry holding an old `(seq, 0)` could become claimable again after a later driver committed (the reviewed interleaving: fail → take → re-drive claims → commit resets → old retry claims and fences the live driver). A monotone `redrives` closes it; `redrives_since_commit` carries the budget that must reset on progress (R-B3). Why there is no same-owner clause: a stalled redelivery to the *same* process should be refused while its sibling heartbeats, exactly like any other process; a dead process never matches because `owner` includes a per-process-start random. Why `claim` no longer admits `'failed'` at all: `progress` already allows `failed → running` (queue retries, stale revive) on the tracked tier; on the leased tier that door is closed — a genuinely failed operation is never resurrected by a late delivery, and a failed one (parked or terminal) leaves `failed` only through the operator `redrive` statement, which moves it to `pending` under a new delivery identity and re-opens the domain row in the same transaction.

## 📝 §4 Service API and the kind registry

Additive members on `ProgressService` (category 2/3, STABLE: optional methods, precedent `touchJobHeartbeat?`). Every method takes `scope`.

```ts
export type Lease = { jobId: string; owner: string; epoch: number; ttlMs: number }   // no worker-clock expiry is exposed
export type SliceOutcome = 'drained' | 'budget' | 'cancelled'
export type OrphanPolicy = 'redrive' | 'park'

export interface LeasedJobKind {
  queue: string
  requiredFeatures: string[]                         // who may cancel / re-drive via the generic routes (in addition to progress.* features)
  lease?: { ttlMs?: number; sliceBudgetMs?: number; pendingTtlMs?: number }           // 60 000 · 300 000 · 900 000
  budget?: { maxRedrives?: number; maxConsecutiveFailures?: number; poisonRedrivesWithoutCommit?: number }   // 10 · 5 · 3
  orphanPolicy?: OrphanPolicy                        // default 'park' (Solid Queue's stance); idempotent kinds declare 'redrive'
  retention?: { completedDays?: number; failedDays?: number }                           // 7 · 30
  /** One slice under a held lease. Return when `signal` aborts or the budget elapses. */
  step(ctx: {
    job: ProgressJob; scope: ProgressServiceContext; lease: Lease
    signal: AbortSignal
    heartbeat: (patch?: { processedCount?: number; totalCount?: number | null; committed?: boolean }) => Promise<void>
    budgetMs: number
    idempotencyKey: string                           // `${jobId}:${continuation_seq}` — forward to external side effects and commands
    container: AppContainer
  }): Promise<SliceOutcome>
  /** Mirror a terminal transition (completed | failed incl. parked | cancelled) onto the domain row (data_sync: sync_runs.status).
   *  Called INSIDE the terminal transaction with its EntityManager (mirror: 'atomic', default) — a throw rolls the terminal CAS back —
   *  or after it, retried by the reconciler's Q5 until it resolves (mirror: 'deferred'). MUST be idempotent: it may run more than once
   *  for the same terminal state, and it must not emit events or enqueue work (do that from an after-commit hook via `emitAfterCommit`).
   *  MUST return how many domain rows its fenced UPDATE matched: `matched = 0` is a mismatch (the domain row is gone or already terminal by
   *  another path) and is treated exactly like a throw — §7 step 3 never records `domain_mirrored_at` for it. "Mirrored" means
   *  "the domain row agrees", not "the callback ran". */
  onTransition?(job: ProgressJob, scope: ProgressServiceContext, em: EntityManager): Promise<{ matched: number }>
  /** Optional pre-terminal hook for cancel (release external resources). Same transaction and the same idempotency rule as onTransition. */
  onCancel?(job: ProgressJob, scope: ProgressServiceContext, em: EntityManager): Promise<void>
  /** Re-open the domain row when an operator re-drives a failed (parked or terminal) or lease-expired job — the mirror image of
   *  onTransition, with the same contract: called INSIDE the §3 redrive transaction with its EntityManager, idempotent (a row that is
   *  already open matches and changes nothing), one fenced UPDATE, no events/enqueue/HTTP, returns { matched }. `matched = 0` rolls the
   *  redrive back and the route answers 409 `domain_refused`. Required whenever `onTransition` is declared — `registerJobKind` throws otherwise. */
  onRedrive?(job: ProgressJob, scope: ProgressServiceContext, em: EntityManager): Promise<{ matched: number }>
  mirror?: 'atomic' | 'deferred'                     // default 'atomic'; 'deferred' only for kinds whose domain row is outside the app DB
  maxMirrorAttempts?: number                         // default 20 failed mirror attempts (§7 step 5) before progress.job.mirror_stuck
}

export interface ProgressService {
  // …existing members unchanged…
  registerJobKind?(kind: string, handler: LeasedJobKind): void
  /** Inserts the row on the given EM (the caller's transaction) and returns it with a deferred `emitCreated()`; the
   *  `progress.job.created` event is NOT emitted inside the transaction (R-E3). Worker/CLI scope: pass a forked EM. */
  createLeasedJob?(input: CreateProgressJobInput & { kind: string; lockKey: string; subject?: { type: string; id: string } },
                   ctx: ProgressServiceContext, em: EntityManager): Promise<{ job: ProgressJob; emitCreated: () => Promise<void> }>
  enqueueLeasedJob?(jobId: string, ctx: ProgressServiceContext): Promise<void>   // id pj-<id>-<seq>-<redrives>; delay = max(0, next_run_at − now()); stores queue_job_id
  claim?(jobId: string, ctx: ProgressServiceContext, delivery: { seq: number; redrives: number }): Promise<Lease | null>
  heartbeatLease?(lease: Lease, ctx: ProgressServiceContext, patch?: {...}): Promise<{ cancelRequested: boolean } | null>
  yieldSlice?(lease: Lease, ctx: ProgressServiceContext, opts: { interrupted: boolean }): Promise<{ seq: number; redrives: number } | null>
  completeSlice?(lease: Lease, ctx: ProgressServiceContext, input?: CompleteJobInput): Promise<ProgressJob | null>   // runs the §7 terminal transaction; null when the fence refused
  failSlice?(lease: Lease, ctx: ProgressServiceContext, error: { message: string; code?: string }): Promise<void>
  redrive?(jobId: string, ctx: ProgressServiceContext, by: { userId?: string | null }): Promise<ProgressJob | { refused: 'lock_key_held' | 'not_redrivable' | 'domain_refused'; heldBy?: string }>   // operator: any failed (parked or terminal) or expired-lease leased row whose kind is registered; the §3 redrive transaction (own predicate — NOT the take CAS) + onRedrive in the same transaction; resets both budgets, bumps redrives + epoch so the new id never collides with a retained failed job; `by` is recorded on the progress.job.redriven event; 409 with the refusal code otherwise
  reconcileOnce?(opts?: { batchSize?: number }): Promise<ReconcileReport>   // system scope; used by the tick and by tests
}
```

`createLeasedJob(em)` is the single most important line for C-5 on the way *in*; the §7 terminal transaction is its counterpart on the way *out*. It: data_sync creates the progress job and the `sync_runs` row on the same request-scoped EM under `em.begin()` (both services resolve the same EM today: `progress/di.ts`, `shared/lib/di/container.ts`), commits, then calls `emitCreated()` and `enqueueLeasedJob`. A unique-index violation rolls both rows back with no phantom event. If the enqueue throws, the row is `pending` with `pending_since` set and the reconciler enqueues it (R-E2). Category 2/3 note: `onTransition`/`onCancel`/`onRedrive` take `em` and `onTransition`/`onRedrive` return `{ matched }` in their first published version, so no existing implementer is affected. The generic cancel and re-drive routes require `progress.update` **and** the kind's `requiredFeatures`, so cancelling a sync still needs `data_sync.run`. `POST /api/progress/jobs/[id]/redrive` answers 200 with the row, or 409 `{ refused, heldBy? }` with one of the three codes; the acting user is the route's session user and is carried as `by` into the `progress.job.redriven` event — the only record of who re-drove, which matters most when `previousErrorCode` was `unrecoverable`.

## 📝 §5 `runSlice` (the worker body)

`runSlice(payload, ctx)` is registered once per queue a kind declares (the `progress` module ships a worker factory; the owner's `workers/*.ts` is a one-liner binding the queue).

1. `claim` with `payload.seq/redrives` → `null` ⇒ return (the queue job completes; a `progress.leased.delivery_refused` structured-log event with the reason).
2. Start the heartbeat interval at `ttl/3` (20 s) on a forked EM. A `null` from `heartbeatLease` aborts `signal`; `cancelRequested: true` aborts `signal` and marks the slice as ending by cancel.
3. `ctx.signal` (transport: shutdown / lock loss) is chained into the same `signal`.
4. `await step()`. Then:
   - `drained` → `completeSlice`, which runs the §7 terminal transaction (CAS + `onTransition` in one commit). A throw from the mirror (or `matched = 0`) rolls the CAS back, is counted by §7 step 5 (`mirror_attempts + 1` in its own autocommit statement) and is then treated exactly like a `step()` throw (next bullet but one): `failSlice` + rethrow, so the transport retries the slice; `step()` re-runs, finds nothing to do, returns `drained` again and the terminal transaction is retried.
   - `budget`, or `signal` aborted by shutdown/lease loss → `yieldSlice({ interrupted })` returning `{ seq, redrives }` → **`ctx.yield({ data: { …payload, seq, redrives } })`**: the transport rewrites the stored payload *before* handing the job back (BullMQ: `job.updateData()` then `moveToDelayed(now, token)` + throw `DelayedError`, which the processor must let propagate; local: rewrite the stored job and mark this delivery finished without touching `attemptCount`). Where the transport lacks `yield`, `enqueueLeasedJob` for the new `seq` is used instead (same id scheme) and `queue_job_id` is updated; a native hand-back keeps the transport's job id, so `queue_job_id` is left as is.
   - `cancelled` → the §7 terminal transaction with the cancel CAS, `onCancel` and `onTransition`; `progress.job.cancelled` is emitted for leased rows after that commit.
   - throw → `failSlice({ nextAttemptAt })` and **rethrow**: the transport retries *this delivery* (same `seq, redrives`) with its own attempts/backoff; the retry's `claim` succeeds because the lease was released and `next_run_at` has passed. `QueueUnrecoverableError` → terminal fail via the §7 terminal transaction (`error_code='unrecoverable'`), no transport retry; if *that* transaction's mirror throws, the row stays `running` with the lease released and `next_run_at = now()` — Q1 takes it on the next tick and parks it (the kind's policy cannot re-drive an unrecoverable error: `error_code` is preserved), mirroring again inside the park transaction.
5. A delivery that exhausts transport attempts leaves the row `running`, lease released, `next_run_at = now()` — the reconciler's case on its next tick. The failed transport job keeps the old id; the reconciler's re-drive uses a new one (invariant 9).

## 📝 §6 The reconciler

**Hosting the reconciler (Δ-6, decided).** The `progress` module ships two queue workers: `progress-reconcile` and `progress-retention`. The tick is a **repeatable job owned by the transport**, not a job that re-enqueues itself (a re-add from inside the running job is a dedup no-op on both strategies, and a retained failed job with the same id would block every later add — the chain would die). Part 5 adds `Queue.upsertRepeatable(id, { everyMs })` to the transport contract: async maps to BullMQ's `upsertJobScheduler('progress-reconcile', { every: 30_000 })`, which is idempotent across replicas and survives completion/failure of individual runs; local implements it as bucketed deterministic ids `progress-reconcile-<bucket+1>` enqueued at the *start* of each run inside `try/finally` (monotone ids never collide with retained failed ones) plus an unref'd boot timer that re-adds the next bucket as a self-heal. Every worker process calls `upsertRepeatable` at boot; the reconciler's steps are all CAS, so a redundant run is harmless. It does not depend on the optional `scheduler` package and never runs in the web process. `progress/AGENTS.md`'s "never timers for durable work" gains the explicit carve-out: the repairer is the one periodic job, and it is the transport's repeatable. Failure mode stated: if the repeatable is lost (Redis flush), the next worker boot re-creates it; until then leased orphans wait — the soak (part 7 §6) includes a Redis flush.

```mermaid
flowchart TB
  T["reconcileOnce: each query SELECT … FOR UPDATE SKIP LOCKED LIMIT 100 in its own short transaction; loop until empty; every row in its own try/catch (R-H3)"]
  T --> Q1["leased · running · lease_expires_at < now() − 20 s · (next_run_at is null or next_run_at < now() − 20 s)"]
  Q1 --> POL{"orphanPolicy · redrives_since_commit · poison"}
  POL -->|"'redrive' ∧ redrives_since_commit < maxRedrives ∧ (no commit since last redrive ⇒ count < poison)"| RE["take CAS (epoch+1, redrives+1, redrives_since_commit+1, next_run_at = now() + min(15 s·2^rsc, 10 min))<br/>→ enqueueLeasedJob (delay = next_run_at − now()) · emit progress.job.orphaned"]
  POL -->|otherwise| PK["park: §7 terminal transaction — status='failed', parked_at=now(), error_code='orphaned'|'poison' + onTransition, one commit · then emit progress.job.failed{parked:true}<br/>unregistered kind: same CAS with error_code='no_handler' and domain_mirrored_at=now(), no callback"]
  T --> Q2["leased · pending · greatest(pending_since, coalesce(next_run_at, pending_since)) < now() − pendingTtl (never claimed, or hand-back lost)"]
  Q2 --> RE2["§3 Q2 statement: core + redrives_since_commit+1 → enqueueLeasedJob with the new id · after maxRedrives → park 'never_started'"]
  T --> Q3["leased · cancel_requested_at set · lease expired"]
  Q3 --> C["§7 terminal transaction — cancel CAS + onCancel + onTransition, one commit · then emit progress.job.cancelled"]
  T --> Q5["leased · terminal · subject_type set · domain_mirrored_at is null (mirror: 'deferred' kinds only)"]
  Q5 --> M["onTransition(job, scope, em) on a short transaction → matched ≥ 1 ⇒ set domain_mirrored_at = now(), mirror_attempts = 0 in the same commit; a throw or matched = 0 ⇒ rollback, then mirror_attempts + 1 in its own autocommit statement (§7 step 5); mirror_attempts reaching maxMirrorAttempts ⇒ progress.job.mirror_stuck (event + structured log, once per crossing) + part 8 'stuck'"]
  T --> Q4["tracked tier: markStaleJobsFailed over all tenants — the existing sweep, moved here from GET /api/progress/active"]
  D["progress-retention (daily)"] --> R["delete terminal rows older than the kind's retention (tracked tier: 30 d default), batches of 1000"]
```

Every reconciler transition that ends a row (Q1 park, Q3 cancel) is a §7 terminal transaction: the CAS and the domain mirror commit together, and a throwing mirror rolls the CAS back so the row is selected again next tick. Q5 is the only path in which the mirror runs *after* a terminal CAS committed, and it exists for one case only: kinds that declared `mirror: 'deferred'`. (The migration backfill stamps every pre-existing terminal row with `domain_mirrored_at = finished_at` — §2 — because none of them can carry a subject; Q5 can be dropped the day every kind declares `mirror: 'atomic'`.) A park for an unregistered kind never reaches Q5: its CAS sets `domain_mirrored_at` itself (§2), so a `no_handler` row is neither re-selected every tick nor retained forever.

Constraint: `pendingTtlMs` must exceed the worst-case queue backlog for that kind, otherwise Q2 re-drives healthy queued deliveries (they are refused on `redrives` and cost nothing but a wasted delivery, yet each one counts toward `never_started`); the default 15 min is per kind and the reconciler logs a warning when a Q2 re-drive finds the previous delivery still queued (via `Queue.getJobState` where the capability exists). Cost note: Q1 scans the `running ∧ leased` partial index and filters `lease_expires_at` in the heap — a bounded scan of live leased rows every 30 s, which stays cheap to ~10k live rows; beyond that the follow-up is a narrow `progress_job_leases` side table, not an index on `lease_expires_at` (invariant 6).

**Connection ceiling** (`packages/queue/AGENTS.md` → Connection Budget): a leased slice uses its request-scoped EM plus one *transient* pooled connection during each heartbeat/lease statement (≤ 1 query every 20 s per slice), and the reconciler worker uses one connection per batch query. The worst case per worker process is therefore `Σconcurrency + 1` concurrent connections instead of `Σconcurrency`; the existing DB-budget clamp in `mercato worker --all` is updated to reserve that one extra connection and the integration test asserts `pg_stat_activity` stays under the clamp during the soak.

## 📝 §7 The terminal-transition protocol (invariant 11)

A leased row reaches `completed`, `failed` (including parked) or `cancelled` through exactly one code path, `runTerminalTransition(jobId, transition, scope)`, used by `completeSlice`, the terminal branch of `failSlice`, `cancelJob` on a pending leased row, and the reconciler's Q1-park, Q3-cancel and Q5-mirror:

1. Open a short transaction on a forked EM (`em.fork()` defaults, invariant 1's discipline).
2. Run the terminal CAS with the epoch fence (`… and lease_epoch = $epoch` for slice-initiated transitions; the reconciler's predicates for Q1/Q3). Zero rows → rollback, return `null`, do nothing else.
3. **`mirror: 'atomic'` (default):** call `onCancel?` then `onTransition(job, scope, em)` on the *same* EM; **`matched ≥ 1`** ⇒ set `domain_mirrored_at = now(), mirror_attempts = 0` on the row, commit. A throw anywhere, or **`matched = 0`** (raised as `DomainMirrorMismatchError`), → rollback: the row is still non-terminal, the lease is released by the caller's normal failure path (`failSlice` for a slice; nothing for the reconciler — the row is simply selected again next tick). `domain_mirrored_at` is therefore never set by a callback whose UPDATE matched nothing: "mirrored" means the domain row agrees.
   **`mirror: 'deferred'`:** commit the CAS with `domain_mirrored_at = null`; Q5 retries `onTransition` on a fresh short transaction every tick until it returns `matched ≥ 1`, setting `domain_mirrored_at` and `mirror_attempts = 0` in that same commit.
   **Unregistered kind** (the reconciler parks a row whose `kind` has no handler, `error_code = 'no_handler'`): there is no callback and no `mirror` mode to read; the park CAS sets `domain_mirrored_at = now()` itself and the transaction is the CAS alone.
4. Only after commit: emit the terminal `progress.job.*` event and run any after-commit hooks the kind registered through `emitAfterCommit`. Events are therefore at-most-once (part 4 outbox/inbox section — accepted: the 5 s poll converges the UI).
5. **Counting failed mirrors (R-H1: no process memory).** After a step-3 rollback — from *any* caller: a slice's `completeSlice`/terminal `failSlice`, the reconciler's Q1 park, Q3 cancel or Q5 retry — `runTerminalTransition`'s `catch` issues one separate autocommit statement on the forked EM, outside the rolled-back transaction: `update progress_jobs set mirror_attempts = mirror_attempts + 1, updated_at = now() where id = $id returning mirror_attempts`. When the returned value equals the kind's `maxMirrorAttempts` (default 20) it emits `progress.job.mirror_stuck { jobId, kind, mirrorAttempts, lastError }` and the structured-log event of the same name — once per crossing; the row keeps being retried every tick (the set is bounded and the retry is one short transaction), the counter keeps growing, and part 8's "stuck" derivation (`mirror_attempts >= maxMirrorAttempts`) keeps matching. The counter survives replicas, `SKIP LOCKED` partitioning and deploys because it lives on the row; it is reset only by a successful terminal commit (step 3) or an operator `redrive` (§3). `DomainMirrorMismatchError` (`matched = 0`) counts exactly like a throw, which is what makes a deleted or foreign-state domain row *visible* instead of silently "mirrored".

Rules for `onTransition`: idempotent (it may run twice for the same terminal state — once in a rolled-back attempt, once in the committed one; or once per Q5 tick); a single fenced UPDATE on the domain row where possible (`data_sync`: `update sync_runs set status = $s, finished_at = … where id = $id and progress_job_id = $jobId and status not in (terminal)`), returning `{ matched: <rows affected> }`; no events, no enqueue, no HTTP inside it. A kind that needs more than that is a kind whose domain state should be derived from the job row, not mirrored. `onRedrive` obeys the same rules in the opposite direction (§3 step (c)): one fenced UPDATE that re-opens the domain row, inside the `redrive` transaction, `matched = 0` ⇒ the re-drive is refused. The two hooks are the two halves of invariant 11: a job row and its domain row enter and leave terminal states together.

Why not "domain row first": the job row is the record every surface reads (UI, cancel, ACL, reconciler); a domain row that is terminal while the job row is `running` would be repaired by Q1 as an orphan and re-driven — worse than the v3 bug. The job row and the mirror move together or not at all.

## 📝 §8 Cancellation

`cancelJob` (existing) on a leased row: `pending` with no lease → `cancelled` immediately, `removeJob(queue_job_id)`; `running` → `cancel_requested_at` (existing CAS) — and for leased rows **the `progress.job.cancelled` event is emitted later**, by the slice that observes the request (within one heartbeat interval via the heartbeat response, or at once via `signal` where the transport relays it) or by the reconciler after the lease expires. The UI renders "cancelling" from `cancelRequestedAt` in the meantime. Event id unchanged; timing documented in UPGRADE_NOTES (the DataTable bulk handlers only track tracked-tier jobs and are unaffected).

A `pending` row cancelled immediately also goes through the §7 terminal transaction (cancel CAS + `onTransition`), on the caller's forked EM.

**Minimal cascade (R-G3, now).** `cancelJob` also sets `cancel_requested_at` on every non-terminal row with `parent_job_id = $id` (same CAS per child) and `removeJob`s pending children; children then follow the same rules as the parent. Parent aggregation ("parent completes when children are terminal") and parent-driven creation stay in the Q6 follow-up.

## 📝 §9 Edge Cases & Failure Scenarios (mechanism-level; the `data_sync` scenarios S1–S11 are in part 7)

| Scenario | Behaviour under this design |
|---|---|
| S3 lock lost, handler alive | The transport lock and the `progress_jobs` lease are different things: losing the BullMQ lock (`lockRenewalFailed` → the strategy aborts `signal`, part 5) does not release the lease, which the handler keeps heartbeating until it yields at its next durable boundary. BullMQ's stalled-job redelivery — to another worker **or to the same process** at `concurrency > 1` — carries the same `(seq, redrives)` and hits a live lease: `claim` refuses it (`lease_expires_at` is in the future; there is no same-owner exception, invariant 5), the delivery completes as refused, and the original handler's yield then hands the job back normally. If the handler is actually dead, the lease expires ≤ `ttlMs` (60 s) later and Q1 takes the row on the next tick with `redrives+1` and a new epoch; any later straggler is refused by identity. Bounded window: a live-but-lockless handler keeps running for at most one slice budget, alone, under its own lease; a dead one is re-driven within `ttlMs + grace + tick` (≈ 2 min). No window in which two drivers hold the lease. |
| S4 cancel | `cancel_requested_at` → next heartbeat (≤ 20 s) aborts `signal` → the step stops at its boundary → the slice runs the §7 terminal transaction (`cancelled` + `onCancel` + `onTransition`, one commit), then emits the event. UI shows "cancelling" until then. Cancel of a slice that is already dead: Q3 runs the same terminal transaction after the lease expires (≤ 60 s + tick). |
| **Hand-back lost after yield** (Redis flush, `moveToDelayed` throws, SIGKILL between the yield CAS and `ctx.yield`) | row `pending`, `lease_owner` null, `pending_since` set → reconciler Q2 re-drives after `pendingTtl` with a new `(redrives)` id. Not stranded. |
| **Transport retry after `failSlice` vs reconciler re-drive** | the reconciler does not act before `next_run_at + grace`, so the transport's retry normally claims first (same `(seq, redrives)`, lease released). If the transport gave up, the take bumps `redrives` and the epoch; a straggling transport retry with the old pair is refused forever (identity is monotone). No id collision (invariant 9). |
| **Transport backoff longer than the reconciler grace** | covered by `next_run_at`: Q1 ignores the row until the transport's scheduled attempt has passed, so a slow retry is not mistaken for an orphan and does not spend the orphan budget (invariant 8). |
| P-13 create-then-enqueue (other consumers) | unchanged until they adopt the leased tier; the tracked tier's pending sweep now runs from the worker tick, so a `pending` zombie is failed within 15 min without a browser. |
| Reconciler takes a slow-but-alive driver | take bumps the epoch: the driver's next heartbeat returns `null` → `signal` aborts; its fenced commit affects zero rows. At most the in-flight page is applied twice — idempotent by contract. |
| Two reconciler replicas | `SKIP LOCKED` partitions the set; the take CAS is the correctness guard; the repeatable is idempotent across replicas (`upsertRepeatable`). |
| Repeatable tick lost (Redis flush) | re-created by the next worker boot; until then leased orphans wait; covered by the soak. |
| Redis flushed | queue jobs gone; every leased row is `running` with an expiring lease or `pending` with `pending_since` → both re-enqueued by the reconciler with fresh ids. |
| **Operator re-drives a parked row** | §3 `redrive`, one transaction: job row → `pending` with `redrives+1`, a new epoch, both budgets and `mirror_attempts` reset, `parked_at`/`error_code`/`finished_at`/`domain_mirrored_at` cleared **and** `onRedrive` re-opens the domain row (`data_sync`: `sync_runs.status = 'running'`, `finished_at = null`) in the same commit; then a new delivery id is enqueued (the retained failed transport job keeps the old id and is ignored) and `progress.job.redriven { by, previousStatus: 'failed', previousErrorCode }` is emitted. The next `claim` succeeds on `pending`; the next slice's fenced batch commit (part 7) finds `status = 'running'` and lands. Part 8 stops showing it as parked the moment the statement commits and the dashboard sees the event. |
| **Operator re-drives a terminal `failed` row** (retry budget exhausted — part 7 S2 — or `error_code = 'unrecoverable'`) | same statement, same outcome: any `failed` leased row is admitted, `consecutive_failures` is reset so the re-driven slice has a full retry budget, and `unrecoverable` is cleared as a deliberate operator override recorded by the event's `previousErrorCode` and `by`. A re-driven row that fails terminally again is re-drivable again — there is no dead end on the leased tier short of `cancelled`/`completed`. |
| **Re-drive while another live operation holds the lock key** (operator started a fresh `data_sync` run for the same stream after the old one parked) | `redrive` step (a) finds the live row and returns `{ refused: 'lock_key_held', heldBy }` → HTTP 409 naming the live operation, no state change; the concurrent-start race between (a) and (b) surfaces as a unique violation that is caught and mapped to the same 409. The parked row stays parked until the live one ends; the operator can cancel the live one first. |
| **Re-drive whose domain row cannot be re-opened** (`sync_runs` row soft-deleted, or in a state the kind refuses to re-open) | `onRedrive` returns `matched = 0` → the whole transaction rolls back (job row unchanged, still `failed`) → HTTP 409 `{ refused: 'domain_refused' }`. Nothing is enqueued; the operator starts a new operation instead. Without this fence the re-driven slice would burn its retry budget on the part 7 ownership fence and park again. |
| Owner module disabled (unknown kind) | first delivery or first tick → park with `error_code='no_handler'` and `domain_mirrored_at = now()` in the park CAS (no callback exists to run, §7 step 3): the row is a normal `failed` row for Q5 (never selected) and for retention (collected after the tracked-tier default 30 d, since the kind's own retention is unknown). `redrive` of such a row is refused `not_redrivable` until the kind is registered again; once it is, `onRedrive` re-opens the domain row as for any failed row. |
| Per-row owner callback throws in the tick | caught per row, the batch continues (R-H3) — and because the callback ran inside that row's §7 terminal transaction, the CAS rolled back with it: the row is still non-terminal and is selected again next tick, with `mirror_attempts + 1` written by the separate autocommit statement of §7 step 5. No row is left terminal-but-unmirrored by a throwing callback. |
| **`onTransition` matches zero rows** (domain row deleted, or terminal by another path) | treated as a failed mirror (`DomainMirrorMismatchError`): atomic mode rolls the CAS back, deferred mode leaves `domain_mirrored_at` null; `mirror_attempts` counts it, `mirror_stuck` surfaces it. A `completed` job can never sit beside a `failed` run with the job marked "mirrored" — that state is now unreachable. |
| **Crash between the terminal CAS and the domain mirror** (the v3 gap) | atomic mode: impossible — they are one commit; a crash before commit leaves the row `running` with a released lease (`failSlice` never ran either) → lease expires → Q1. Deferred mode: the CAS committed with `domain_mirrored_at = null` → Q5 retries `onTransition` every tick until it commits. Either way `sync_runs` cannot stay `running` while its job is terminal for longer than one tick. |
| Domain mirror throws persistently (atomic mode) | the slice's terminal transaction keeps rolling back → each rollback is one `mirror_attempts + 1` (§7 step 5) → transport retries → `consecutive_failures` grows → at `maxConsecutiveFailures` the slice fails terminally, which is itself a §7 transaction whose mirror also throws → the row stays `running`, lease released, `next_run_at = now()` → Q1. For an `orphanPolicy: 'park'` kind Q1 parks on the next tick; for a `'redrive'` kind such as `data_sync` Q1 first re-drives (up to `poisonRedrivesWithoutCommit` = 3 times, each another transport retry chain) and only then parks — every attempt in that chain, slice-side or reconciler-side, increments the same row counter, so `mirror_stuck` fires at 20 *attempts* (`park` kind: ≈ 10 min of ticks; `data_sync`: ≈ 15–20 min, dominated by the transport's exponential backoff rather than by the tick), not after "20 ticks from the first park". The park transaction's mirror throws again → CAS rolls back → selected again next tick. After `maxMirrorAttempts` the reconciler emits `progress.job.mirror_stuck` (once) and the row is visible under the part 8 "stuck" filter via `mirror_attempts`. It is never silently terminal and the count survives a reconciler restart (test 7). |
| Clock skew between workers | irrelevant: every predicate is DB time; a skewed worker only heartbeats at a slightly different cadence. |
| Transport without `yield`/dedup/delay (future strategy) | `yield` = `enqueueLeasedJob(seq+1)`; duplicates refused by `claim`; delay = reconciler backoff via `next_run_at`. Correct, less efficient (R-J1). |

## 📝 Risks & Impact Review

| Risk | Sev | Mitigation | Residual |
|---|---|---|---|
| `progress_jobs` is written by ~40 files; wider row, six new partial indexes | Low | nullable/defaulted columns; heartbeat path unchanged for tracked rows; indexes partial on the leased tier; `fillfactor 80` converges on rewrite | none observable at today's volumes |
| Stale sweep moves off the GET (tracked jobs fail sooner, everywhere) | Low | same predicate and CAS; `OM_PROGRESS_SWEEP_ON_READ` **defaults on for one minor release** (so rolling back only the worker leaves sweeps alive), then off | — |
| `progress.job.cancelled` timing for leased rows; `progress.job.failed` gains `parked`; new `progress.job.orphaned`, `progress.job.redriven`, `progress.job.mirror_stuck` | Med | category 5: ids unchanged, payload additive, three new ids; timing change documented in UPGRADE_NOTES | consumers treating `cancelled` as "stopped" were already wrong (P-21) |
| Orphan policy default `park` surprises owners expecting auto-retry | Low | documented; data_sync declares `redrive`; parked rows are visible and re-drivable | — |
| Operator re-drive overrides `unrecoverable` and resets both budgets | Low | deliberate: the operator is the authority; `progress.job.redriven` records `by` and `previousErrorCode`; the route needs `progress.update` + the kind's features | an operator can re-drive a job the policy gave up on — by design |
| A kind declares `onTransition` but forgets `onRedrive` | Low | `registerJobKind` throws at worker boot — a mirror with no way back is rejected before any row exists | — |
| Connection ceiling +1 per worker process | Low | §6 ceiling stated; clamp updated; soak asserts it | — |
| Terminal transaction holds two row locks (`progress_jobs` + the domain row) for the duration of `onTransition` | Low | `onTransition` is a single fenced UPDATE by contract; the transaction is short and never waits on the transport | a slow mirror lengthens the slice's tail by that time |
| Compat surfaces touched | — | 8 DB schema additive (+ down-migration); 2/3 `ProgressService` optional members and DTO fields; 5 events as above; 7 one new action route `POST /api/progress/jobs/[id]/redrive`; 9 DI unchanged; 10 ACL reuses `progress.*` + kind features | — |
| Rollback | — | inert until a kind registers (code) + down-migration (schema). With a kind registered (part 7) the consumer's rollback applies first | — |

## 📝 Backward compatibility review

| Surface (`BACKWARD_COMPATIBILITY.md`) | Change | Class |
|---|---|---|
| 8 DB schema (`progress_jobs`) | 20 nullable/defaulted columns (incl. `mirror_attempts int not null default 0`), 6 partial indexes, `fillfactor 80`; down-migration provided; backfill sets `domain_mirrored_at = finished_at` on every pre-existing terminal row | ADDITIVE |
| 2/3 `ProgressService`, `LeasedJobKind`, `ProgressJobDto` | optional members and fields only; `onTransition`/`onCancel`/`onRedrive` are new in this version (with `em`; `onTransition`/`onRedrive` return `{ matched }`); DTO gains `cancelRequestedAt`, `parkedAt`, `errorCode`, `mirrorAttempts`, `redrivable` | ADDITIVE |
| 5 event ids | `progress.job.failed` payload gains `parked`; new `progress.job.orphaned`, `progress.job.redriven` (`by`, `previousStatus`, `previousErrorCode`, `redrives`), `progress.job.mirror_stuck` (`mirrorAttempts`, `lastError`), all `clientBroadcast`; **timing** of `progress.job.cancelled` for leased rows changes (emitted when stopped, not when requested) | ADDITIVE + documented behaviour change (UPGRADE_NOTES) |
| 7 API routes | new `POST /api/progress/jobs/[id]/redrive` (200 with the row; 409 `{ refused: 'lock_key_held' \| 'not_redrivable' \| 'domain_refused', heldBy? }`); `GET /api/progress/active` no longer sweeps by default after one minor release (`OM_PROGRESS_SWEEP_ON_READ`) | ADDITIVE + flagged behaviour change |
| 9 DI keys, 10 ACL features | unchanged; the new route reuses `progress.update` + the kind's `requiredFeatures` | — |
| 12 CLI | `mercato worker` gains the two `progress-*` workers (auto-discovered) | ADDITIVE |

Rollback: the tier is inert until a kind registers. Code rollback leaves the columns in place unused; schema rollback is the down-migration. Rolling back only the worker keeps sweeps alive because `OM_PROGRESS_SWEEP_ON_READ` defaults on for one minor release.

## 📋 §10 Integration coverage (R-M1 — each a named test that fails on today's code)

Real Postgres + Redis (`__integration__`, docker-compose runner), with a test kind whose `step()` and `onTransition` are scriptable:

1. SIGKILL mid-slice → lease expires → Q1 takes with `redrives+1` and a new epoch; the old driver's fenced write (if it resumes) affects zero rows.
2. SIGTERM at the slice deadline → interrupted yield, counters untouched, redelivery claims with the rewritten `seq`.
3. Lost lock with a live handler (simulated `lockRenewalFailed`) → the redelivery is refused while the lease lives; the original yields normally (S3).
4. Duplicate / late / early delivery → refused by `(seq, redrives)`; the live driver is unaffected.
4b. **Re-drive out of parked**: park a row (poison), call `redrive` → row `pending`, both budgets and `mirror_attempts` zero, markers cleared, the test kind's `onRedrive` ran on the *same* transaction (assert: a failure injected into `onRedrive` leaves the row `failed` and answers `domain_refused`), `progress.job.redriven` carries `by` and `previousErrorCode = 'poison'`, a delivery with the new id is *actually processed* by BullMQ (the retained failed job with the old id does not block it) and completes; then park another row, start a live operation on the same lock key, `redrive` → 409 `lock_key_held`, no state change; cancel the live one, `redrive` → succeeds.
4c. **Re-drive out of terminal failed**: exhaust `maxConsecutiveFailures` → `failed` (not parked) → `redrive` succeeds, `consecutive_failures = 0`, the re-driven slice completes; fail it terminally again → `redrive` succeeds again. A `completed` and a `cancelled` row → `not_redrivable`. The domain-level counterpart (`sync_runs` re-opened, next batch commits) is part 7 test 7.
5. Two worker replicas + two reconciler replicas on one set → every slice runs once; `SKIP LOCKED` partitions the tick.
6. Crash between record and domain write on the way in (`createLeasedJob` in `em.begin()` + abort) → no row, no event.
7. **Crash between the terminal CAS and the domain mirror** — process killed inside `onTransition` (atomic mode) → row still `running`, lease released, re-driven, completes on the retry; **`onTransition` throws** once → CAS rolled back, `mirror_attempts = 1`, retry succeeds, `domain_mirrored_at` set and `mirror_attempts = 0`; throws persistently → park attempted each tick, `mirror_attempts` grows by one per attempt **and survives a reconciler restart between attempts** (the assertion that distinguishes a row counter from the in-memory one R-H1 forbids), `mirror_stuck` emitted exactly once when the counter reaches `maxMirrorAttempts`, row never terminal-but-unmirrored; **`onTransition` returns `matched: 0`** → same path as a throw, `domain_mirrored_at` stays null. Deferred mode: CAS committed, `domain_mirrored_at` null, Q5 sets it on the next tick once the mirror succeeds.
8. Cancel during I/O → `cancelled` written by the slice with the mirror in the same commit; cancel of a dead slice → Q3, same assertion.
9. Reconciler vs live driver → take fences the driver at its next heartbeat; at most one in-flight page applied twice.
10. Connection ceiling: `pg_stat_activity` stays under the `mercato worker --all` clamp during a 3-replica soak.
11. Retention never deletes a terminal row with `domain_mirrored_at is null` and a subject — and **does** collect a `no_handler` park with a subject (its CAS set `domain_mirrored_at`), so an unregistered kind's rows do not accumulate forever; Q5 never selects that row.

## 📋 Implementation Plan

1. Migration (§2, twenty columns, expression indexes via `@Index({ expression })`) + down-migration + snapshot + backfill; entity fields; validators; DTO fields (`cancelRequestedAt`, `parkedAt`, `errorCode`, `mirrorAttempts`, `redrivable`). Test: migration applies/reverts on a populated table; backfill stamps every pre-existing terminal row with `domain_mirrored_at = finished_at`; existing tests green.
2. `createLeasedJob(em)` with deferred `emitCreated`, `enqueueLeasedJob`, `claim`, `heartbeatLease`, `yieldSlice`, `failSlice` (non-terminal branch), `redrive` — the §3 statements via the query builder on a forked EM (`nativeUpdate` cannot return rows). Unit tests per transition incl. epoch refusal, `(seq, redrives)` refusal, the reviewed fail→take→re-drive→commit→stale-retry interleaving (stale retry must be refused), absence of a same-owner bypass, `redrive` on a parked row and on a terminal failed row (predicate matches, markers cleared, `redrives` bumped, `redrives_since_commit` and `consecutive_failures` reset, `onRedrive` called on the transaction's EM, enqueue uses the new id, `progress.job.redriven` emitted after commit with `by` and `previousErrorCode`), `redrive` refused on `completed`/`cancelled`/live-lease rows (`not_redrivable`), on an unregistered kind (`not_redrivable`), when the key is held (`lock_key_held`, incl. the race mapped from the unique violation) and when `onRedrive` returns `matched: 0` (`domain_refused`, transaction rolled back, row unchanged); step (a)'s subselect does not see a job outside the caller's tenant/org; a test asserting `n_tup_hot_upd` grows under heartbeats; a test that `createLeasedJob` inside `em.begin()` + rollback leaves no row and emits nothing.
3. `runTerminalTransition` (§7) and the terminal members built on it: `completeSlice`, terminal `failSlice`, leased `cancelJob`, park (incl. the `no_handler` park that sets `domain_mirrored_at` itself). Unit tests: mirror runs on the transaction's EM; a throwing mirror and a `matched: 0` mirror both roll the CAS back, return the row non-terminal and increment `mirror_attempts` in a statement that is *not* part of the rolled-back transaction (assert the value persists after the rollback); a successful commit sets `domain_mirrored_at` and zeroes `mirror_attempts`; `mirror_stuck` fires once at the threshold; deferred mode commits with `domain_mirrored_at = null`; events are emitted only after commit; `emitAfterCommit` hooks run once.
4. Kind registry (`mirror` option, `maxMirrorAttempts`, `onRedrive` required alongside `onTransition`) + `runSlice` factory + generic worker binding. Tests: refused claim does no work; budget → yield → rewritten delivery claims; throw → `failSlice` + rethrow → retry claims; unrecoverable → terminal via §7; shutdown → interrupted yield with counters untouched; mirror throw on `drained` → slice fails, retry completes.
5. Reconciler worker (`progress-reconcile` repeatable every 30 s via `upsertRepeatable`, registered at worker boot) + `progress-retention`; Q1–Q5; `SKIP LOCKED` batches; per-row isolation; stale sweep moved here; `OM_PROGRESS_SWEEP_ON_READ` (default on). Tests: orphan take bumps epoch and re-drives with backoff; Q1 waits for `next_run_at`; poison park on `redrives_since_commit`; lost hand-back re-drive; Q3 cancels a dead slice with the mirror in the same commit; Q5 mirrors a deferred row; a throwing park mirror leaves the row for the next tick and increments `mirror_attempts`; a `no_handler` park sets `domain_mirrored_at` and is never selected by Q5; two reconcilers on one set; tracked-tier sweep parity; repeatable survives a failed run and a Redis flush + boot; retention skips unmirrored rows.
6. Leased cancel semantics + minimal cascade (§8); `POST /api/progress/jobs/[id]/redrive` (ACL `progress.update` + kind features; 200 / 409 with the three refusal codes; `by` from the session); `progress.job.redriven` and `progress.job.mirror_stuck` event definitions; top bar "cancelling"/"parked"; OpenAPI.
7. Integration coverage above.
8. AGENTS.md (`progress` incl. the repairer carve-out and the `onTransition` idempotency rule, root Task Router row), docs page "leased jobs", `BACKWARD_COMPATIBILITY.md` and UPGRADE_NOTES entries, `.ai/lessons.md`.

## Open items for review

- Part 4 decisions 1–3 (home, default orphan policy, default mirror mode).
- `maxMirrorAttempts` default 20 failed mirror *attempts* (counted on the row across slice and reconciler callers, §7 step 5) before `mirror_stuck`: ≈ 10 min of ticks for a `park` kind, ≈ 15–20 min for `data_sync` whose `redrive` policy interposes transport retry chains — long enough to ride out a domain-table lock storm, short enough that an operator sees it the same morning.
- Whether `redrive` should also admit `cancelled` rows (an operator who cancelled by mistake). The spec says no — cancel is a request the system honoured; re-running is a new operation — but it is one predicate clause if maintainers prefer otherwise.
- Whether `onCancel` is worth keeping as a separate hook now that it shares the terminal transaction, or should fold into `onTransition` with `job.status === 'cancelled'`.

## Changelog

- 2026-08-23 — Draft v1.2 after the third and fourth reviews (PR #5450). **Domain side of the re-drive**: new kind hook `onRedrive(job, scope, em)` runs inside the `redrive` transaction and re-opens the domain row (the mirror image of `onTransition`; `matched = 0` ⇒ rollback + third refusal code `domain_refused`; required alongside `onTransition`). `redrive` now admits any `failed` leased row (parked or terminal) plus expired leases, resets **both** budgets and `mirror_attempts`, clears `unrecoverable` as a recorded operator override, and emits `progress.job.redriven { by, previousStatus, previousErrorCode }` — the audit trail. **Durable mirror counter**: twentieth column `mirror_attempts`, incremented by `runTerminalTransition`'s catch in its own autocommit statement outside the rolled-back transaction (§7 step 5) from every caller, reset by a successful terminal commit; `mirror_stuck` ⇔ `mirror_attempts >= maxMirrorAttempts`; `onTransition` returns `{ matched }` and `matched = 0` counts as a failed mirror, so `domain_mirrored_at` means "the domain row agrees". **`no_handler` parks** set `domain_mirrored_at` in the CAS (never re-selected by Q5, collected by retention). The re-drive family is written as one core plus a six-column difference table; `claim`'s parked-branch rationale corrected (the status predicate refuses late deliveries — Q2 is the counterexample); step (a)'s subselect tenant/org-scoped; backfill stated as the one-liner it is and Q5 given its single justification; §9 timing for `data_sync` corrected (re-drives precede the first park). DTO gains `mirrorAttempts` and `redrivable`. §9 rows, tests 4b/4c/7/11 and steps 1–6 updated.

- 2026-08-22 — Draft v1.1 after the second review (PR #5450): `redrive` now has its own §3 statement (predicate `parked` or expired lease; bumps `redrives` + epoch, resets `redrives_since_commit`, clears `parked_at`/`error_code`/`finished_at`/`domain_mirrored_at`, moves to `pending`) instead of pointing at the take CAS whose `status = 'running'` predicate excluded parked rows; `claim`'s parked branch removed (a parked row never receives a delivery); the lock-key-held case is refused with a 409 before the UPDATE and the race is mapped from the unique violation; §9 rows, unit tests (step 2) and integration test 4b added for the way out of parked.

- 2026-08-22 — Draft v1: split out of part 4 v3 §5.3–5.7 + Phase 1 after review (PR #5450). **Terminal-transition protocol (§7, invariant 11)**: the terminal CAS and the kind's domain mirror now commit in one transaction (`onTransition(job, scope, em)`), with a `mirror: 'deferred'` mode, a `domain_mirrored_at` column, a reconciler query Q5 that retries unmirrored terminal rows, a `mirror_stuck` signal, a retention guard, a migration backfill, and crash/throw tests at that exact boundary (integration test 7, unit tests in steps 3–5). `runSlice` step 4 and every reconciler terminal path rewritten to use it. S3 rewritten to match the claim predicate (no same-owner exception). Compatibility review, rollback and integration coverage made explicit for this spec alone.
