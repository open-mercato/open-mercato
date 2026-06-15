# Harden background indexing against DB connection-pool exhaustion

## Overview

Onboarding on the demo seeds fully but never sets `preparationCompletedAt` — the
preparing page polls forever. Root-cause analysis traced this to **DB connection
starvation of the request/onboarding path by background worker jobs**, newly
exposed by #3011.

Causal chain:

1. **#3011** made `worker --all` build a fresh request container (own
   `EntityManager` = own pooled DB connection) **per job**, instead of sharing one
   EM across all concurrent jobs. Peak worker DB-connection demand is now
   `Σ(per-queue concurrency)` — but nothing bounds that sum against the DB pool
   (`DB_POOL_MAX`, default 20) or the database's global `max_connections`.
2. A misconfigured embedding stack on the demo (768-dim Ollama column vs 1536-dim
   OpenAI output, plus an unreachable `OLLAMA_BASE_URL`) produces a storm of
   failing vector/fulltext indexing jobs.
3. Each failing job holds its connection while the embedding call runs. The await
   is already bounded to ~3s by an existing `Promise.race` timeout, but the
   underlying `embed()` fetch is **not actually aborted**, so orphaned requests
   linger and the worker stays maximally busy.
4. Under that load the unbounded `Σconcurrency` over-subscribes connections —
   inside the worker (acquire-timeout thrash) and, against `max_connections`,
   across the worker + web processes — starving onboarding's completion write.

This is a hardening change: make background work unable to exhaust the connection
budget the request path depends on, regardless of which subsystem misbehaves.

### External References

None (no `--skill-url` provided).

## Goal

Background/indexing workers must never consume the DB connections the
request/onboarding path needs, and a misconfigured embedding provider must not
pin connections.

## Scope

- `packages/cli/src/lib/worker-connection-budget.ts` (new, pure, testable) — derive
  a per-queue effective-concurrency plan bounded by a DB connection budget.
- `packages/cli/src/mercato.ts` — apply the budget in `worker --all` (and clamp a
  single-queue run to the budget), log the resolved plan, warn on over-subscription.
- `packages/search/src/vector/services/embedding.ts` — pass a real `AbortSignal`
  to `embed()` and abort it on timeout so a dead provider releases sockets/the
  connection promptly.
- `packages/queue/AGENTS.md` + `packages/shared/AGENTS.md` — document the invariant
  `web_pool_max + worker_pool_max + overhead ≤ pg_max_connections` and the new knobs.

## Non-goals

- Not fixing the demo's embedding misconfiguration (ops/config, separate).
- Not changing onboarding's deferred-provisioning flow or completion semantics.
- Not introducing a separate ORM/pool instance for the worker (out of scope;
  documented as an ops concern instead).
- Not raising default concurrency or pool sizes.

## Risks

- Clamping `Σconcurrency` to the pool budget changes worker scheduling. Mitigation:
  the budget defaults to the resolved `DB_POOL_MAX`, so the clamp only bites when
  workers were already over-subscribed (jobs beyond `poolMax` were blocking on
  connection acquire anyway) — effective throughput is unchanged, only the
  thrash is removed. Override via `OM_WORKERS_DB_CONNECTION_BUDGET`; a floor of 1
  per queue guarantees no queue is starved.
- `queue/AGENTS.md` says "Ask before changing worker concurrency limits" — this is
  the user's explicit request; behavior change is surfaced in the PR + `needs-qa`.
- Aborting `embed()` changes the error surface on timeout. Mitigation: preserve the
  existing timeout error message; tests assert message + that a signal is passed.

## Implementation Plan

### Phase 1: Worker connection-budget bulkhead

- 1.1 Add pure `resolveWorkerConcurrencyBudget()` helper + unit tests (proportional
  scale-down to budget, floor 1, metadata for logging).
- 1.2 Wire it into `worker --all` and the single-queue path in `mercato.ts`; log the
  resolved budget/plan and warn when over-subscribed.

### Phase 2: Abort the embedding fetch on timeout

- 2.1 Pass an `AbortController` signal to `embed()` and abort on timeout in
  `createEmbedding`; preserve the timeout error message. Extend embedding tests.

### Phase 3: Document the connection-budget invariant

- 3.1 Add a "Connection Budget" section to `packages/queue/AGENTS.md` and a DB-pool
  note to `packages/shared/AGENTS.md` covering the invariant and new env knobs.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Worker connection-budget bulkhead

- [x] 1.1 Pure `resolveWorkerConcurrencyBudget()` helper + unit tests — ad6580b8f
- [x] 1.2 Apply budget in `worker --all` / single-queue + startup logging — 5ff4dca3b

### Phase 2: Abort the embedding fetch on timeout

- [x] 2.1 AbortSignal cancellation in `createEmbedding` + tests — 1b36cde42

### Phase 3: Document the connection-budget invariant

- [ ] 3.1 Document invariant + env knobs in queue/shared AGENTS.md
