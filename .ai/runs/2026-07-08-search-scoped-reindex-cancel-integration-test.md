# Execution plan: integration test for scoped search reindex cancellation

## Goal

Add the integration test flagged as a follow-up in PR #3992 (Fixes #3900): lock in the
tenant/org-scoped reindex-cancellation contract at the real HTTP API + real queue layer,
closing the gap the mocked unit tests cannot cover.

## Context

PR #3992 changed `/api/search/reindex/cancel` and `/api/search/embeddings/reindex/cancel`
so they no longer call `queue.clear()` (which wiped every tenant's queued indexing jobs).
Cancel now calls `queue.removeQueuedJobsByScope({ tenantId, organizationId?, jobTypes: ['batch-index'] })`
and **fails closed with 503** when that scoped method is unavailable or throws. The queue
strategies (`packages/queue/src/strategies/{local,async}.ts`) gained `removeQueuedJobsByScope`.

The PR shipped unit + route tests with a **mocked** queue. The follow-up comment
(pkarw, 2026-07-07T23:36:10Z) asked for an integration test that exercises the cross-scope
isolation guarantee through the **real** cancel API + **real** queue strategy.

### External References

None (`--skill-url` not used).

### Environment constraints (drive the test design)

- The ephemeral integration env has **no Meilisearch and no embedding provider** (documented
  in `TC-SEARCH-007`). A fulltext/vector reindex therefore returns 503, holds no lock, and
  enqueues **zero** `batch-index` jobs. So `jobsRemoved` is always `0` here and a persistent
  reindex lock cannot be obtained via the API.
- `QUEUE_STRATEGY=local` (jobs live under `.mercato/queue`); the local strategy **does**
  implement `removeQueuedJobsByScope` (verified at develop tip 46e1a2ecf).
- Full second-**tenant** provisioning is not available to integration fixtures; the established
  isolation precedent (`TC-SEARCH-004`) provisions a **second organization** in the same tenant.
  The scope object keys on `organizationId`, so two orgs still exercise the scoping dimension.

### What the test deterministically asserts (and why it is non-redundant)

1. **Scoped-cancel contract is wired on the real queue.** A real admin cancel of both the
   fulltext and vector paths returns `200 { ok: true, jobsRemoved: <number> }` — **not** the
   `503` fail-closed body. Under the old code cancel always returned 200 via `queue.clear()`;
   under the new code the route returns 503 if the strategy lacks `removeQueuedJobsByScope`.
   So this proves the running app's real local queue strategy actually implements the scoped
   method — the queue-strategy half of #3992 that the mocked unit tests never touch. A revert
   of just the strategy change would flip this to 503 and fail the test.
2. **Per-scope isolation / no shared-state wipe.** A second organization (orgB) with its own
   confined user cancels independently; admin (orgA) and orgB cancels interleave and every call
   returns a clean `200 { ok: true }`. One scope's cancel neither errors nor 503s another
   scope's cancel — the observable proxy for "cancel does not disrupt other scopes' queue state"
   that is available without a live search backend.

Fail-closed (503-on-missing-method) and cross-scope job survival with real enqueued jobs are
**not** integration-observable in this backend-less env (no fault injection over black-box HTTP,
no way to enqueue `batch-index` jobs); they remain covered by the PR's unit/route tests. The
docblock states this limitation explicitly, mirroring `TC-SEARCH-007`.

## Scope

- **In:** one new file `packages/search/src/modules/search/__integration__/TC-SEARCH-013.spec.ts`.
- **Out (non-goals):** no product-code changes; no new fixtures/helpers; no markdown scenario
  (optional per `.ai/qa/AGENTS.md`); no changes to queue strategies or routes.

## Risks

- Env may not allow provisioning a second organization → guard with `test.skip(...)` exactly as
  `TC-SEARCH-004` does; the single-scope contract assertions still run for the admin scope.
- Cancel-without-prior-reindex must be safe (idempotent) → it is; `TC-SEARCH-003/007` already
  call cancel defensively in teardown. Test cleans up org/role/user in `finally`.

## Implementation Plan

### Phase 1: Author the integration test

- Add `TC-SEARCH-013.spec.ts` asserting the two properties above, self-contained with
  `finally` teardown, `test.skip` fallback when orgB cannot be provisioned.

### Phase 2: Validate

- Typecheck the search package; run the full gate (`build:packages`, `generate`, i18n checks,
  `typecheck`, `test`, `build:app`). Integration specs run in the ephemeral env on CI; locally
  confirm the file typechecks and lints and does not regress the suite build.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Author the integration test

- [ ] 1.1 Add `TC-SEARCH-013.spec.ts` (scoped-cancel contract + per-scope isolation)

### Phase 2: Validate

- [ ] 2.1 Typecheck search package + full validation gate
