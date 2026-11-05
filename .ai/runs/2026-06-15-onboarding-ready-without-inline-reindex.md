# Onboarding: mark workspace ready without waiting for the inline query-index rebuild

## Overview

The demo "We are preparing your workspace" page polls `GET /onboarding/onboarding/status`
every ~1s and stalls forever: the response shows `status: "completed"` but
`ready: false`, `emailSent: false`, `loginUrl: null`, and no workspace-ready
email is ever sent.

`ready` is gated on `preparation_completed_at`
([status.ts](../../packages/onboarding/src/modules/onboarding/api/get/onboarding/status.ts) →
`ready = status === 'completed' && Boolean(preparationCompletedAt)`). That flag is
written at the very end of `runDeferredProvisioning`, immediately after a
**multi-minute inline force purge + reindex of every system entity**
(`rebuildTenantQueryIndexes`). On a loaded demo box that inline rebuild outran the
10-minute single-flight lease (`PREPARATION_CLAIM_STALE_MS`), the next ~1s status
poll re-claimed the request, a second concurrent rebuild started, and the PG
connection pool compounded into exhaustion — so `markWorkspaceReady` was never
reached and the flag stayed NULL.

The Thursday (2026-06-11) single-flight guard (#3052-era) stopped the *stampede*
but kept the heavy rebuild on the critical path to readiness, so a single slow
rebuild still stalls the page.

### Goal

Mark the workspace ready (and send the email) in seconds by moving the heavy
query-index rebuild **off** the readiness critical path and onto the durable
queue, while preserving the recoverability invariant the original authors
guarded with a test.

### Scope

- `packages/onboarding/src/modules/onboarding/lib/deferred-provisioning.ts`
- `packages/onboarding/src/__tests__/deferred-provisioning.test.ts`

### Non-goals

- No change to the status route, the single-flight claim, the email contract, or
  the seedExamples flow.
- No change to query_index / search internals. We reuse the existing durable
  `query_index.reindex` persistent event (the canonical enqueue at
  `query_index/lib/engine.ts`) that background workers already process.
- This is **distinct from PR #3089** (worker connection-budget hardening). #3089
  reduces overall pool pressure; this PR removes the onboarding-specific inline
  reindex that gated readiness. They are complementary.

### Approach

Replace the inline `rebuildTenantQueryIndexes` (explicit purge + reindex +
coverage per entity, run before the completion flag) with
`enqueueQueryIndexRebuild`, which emits one **persistent** `query_index.reindex`
job per system entity (`{ entityType, tenantId, organizationId, force: true }`,
`{ persistent: true }`). `reindexEntity({ force: true })` already purges the scope
and refreshes coverage internally, so no explicit purge/coverage sweep is needed.

Order in `runDeferredProvisioning`: claim → seedExamples (with lease heartbeat) →
**enqueue rebuild (durable, fast)** → `markWorkspaceReady` → ready email →
vector reindex enqueue. Enqueuing happens BEFORE the completion gate, so a runner
dying before the jobs are queued leaves `preparation_completed_at` unset → the
stale claim re-runs and re-enqueues (a repeated force reindex is idempotent/
harmless). Seeded rows are already indexed incrementally by the upsert
subscribers during seedExamples; the force reindex is the consistency sweep.

### Risks

- **Workers must be running** to process the queued reindex. The demo already
  runs `mercato worker` (the vector reindex enqueue and #3089 depend on it), so
  this matches the deployment model. If no workers run, query indexes lag until a
  worker drains the queue — but the workspace is usable and lists self-heal on
  writes. Documented in the PR body.
- **Already-stuck tenants do not self-heal** from a code change. Operators unstick
  them manually:
  `UPDATE onboarding_requests SET preparation_completed_at = now() WHERE preparation_completed_at IS NULL;`
- BC: no contract surface changes (no API fields, event IDs, DI keys, or imports
  removed from the public surface). `query_index.reindex` is an existing event.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Decouple readiness from the inline reindex

- [x] 1.1 Replace inline `rebuildTenantQueryIndexes` with durable `enqueueQueryIndexRebuild` (persistent `query_index.reindex` jobs); reorder to enqueue → mark ready → email — 098ce9e6e
- [x] 1.2 Update unit tests to assert durable per-entity enqueue before the completion gate, ready/email no longer wait on the reindex, and the email failure stays non-fatal — 098ce9e6e

### Phase 2: Validation

- [x] 2.1 Full validation gate (build:packages, generate, i18n, typecheck, test, build:app) — all green; one transient turbo worker-teardown flake in core resolved on standalone re-run (5895/5895)
- [x] 2.2 Code-review + BC self-review — no contract surface changes; `query_index.reindex` is an existing persistent event
- [x] Post-review fix: adversarial review flagged the queued payload narrowed the rebuild to one org; emit tenant-wide (no `organizationId`) to match the prior inline rebuild and avoid dropping org-null / org-derived rows — 1958af7d0
