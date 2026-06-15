# Harden vector indexing against a misconfigured / unreachable embedding provider

## Overview

When the **global** embedding-provider config (a single per-database row keyed only by
`(moduleId='vector', name='embedding_config')` — see
`packages/core/src/modules/configs/lib/module-config-service.ts` `findOne({ moduleId, name })`)
points at a provider that is unreachable, or whose embedding dimension no longer
matches the **shared** pgvector table dimension, the vector indexer fails **once per
record**:

- `[vector.embedding] fetch failed. Check OLLAMA_BASE_URL.` (provider unreachable), and
- `expected 768 dimensions, not 1536` (config dimension ≠ shared table dimension).

Each onboarded tenant enqueues a full `reindexAllToVector`
(`packages/onboarding/src/modules/onboarding/lib/deferred-provisioning.ts`), so the
demo deployment generates a storm of per-record failures + wasted embedding calls.
Onboarding itself already completes independently (deferred, best-effort), so this is
**not** a transaction-abort bug — it is reliability / log-noise / wasted-work hardening.

This change makes the vector **worker** preflight the provider once per job and skip
cleanly with a **single** actionable warning instead of failing every record.

### Relationship to PR #3089

PR #3089 (`fix/harden-indexing-db-pool-exhaustion`) bulkheads the worker DB-connection
budget and aborts the `embed()` fetch on timeout — it explicitly does **not** stop the
doomed jobs at the source. This PR is the complementary piece: detect the broken
provider/dimension up front and **skip** the work (no per-record error spam, no wasted
embedding calls, no doomed inserts). The user chose to ship it as a separate parallel
branch. Overlap is limited to one shared file (`embedding.ts`) where this PR only
*reads* the existing `available`/`dimension`/`createEmbedding` surface (no edits to the
timeout/abort logic #3089 changes), to minimize merge conflict.

### External References

None (no `--skill-url` provided).

## Goal

A misconfigured or unreachable embedding provider, or a config↔table dimension
mismatch, produces **one** concise warning per vector-index job and skips gracefully —
instead of per-record error spam and a flood of doomed inserts/embedding calls.

## Scope

- `packages/search/src/lib/debug.ts` — add an always-on `searchWarn` (current
  `searchDebugWarn` is gated by `OM_SEARCH_DEBUG`; the preflight warning must be visible
  by default).
- `packages/search/src/vector/lib/preflight.ts` (new, pure, testable) —
  `evaluateVectorPreflight(input)` returning `{ ok } | { ok:false, code, reason }` for
  `provider_not_configured | dimension_mismatch | provider_unreachable`.
- `packages/search/src/modules/search/workers/vector-index.worker.ts` — run the
  preflight in both the `batch-index` and single-record `index` paths; skip with one
  `searchWarn`; in the batch path still advance reindex progress/heartbeat/lock so the
  run completes (no stuck "preparing"). `delete` jobs are never gated by the provider.
- Unit tests under `packages/search/src/**/__tests__`.

## Non-goals

- Not fixing the demo's embedding misconfiguration (ops/config; separate — flip the
  global config back to OpenAI in Settings → Search, which recreates the table at 1536).
- Not changing the global-vs-per-tenant config model (intentional).
- Not auto-recreating the pgvector table on mismatch (the user explicitly did not pick
  the self-heal option).
- Not preventing the batch jobs from being *enqueued* in `SearchIndexer.reindexAllToVector`
  (that class has no embedding/driver deps; threading them in is a larger cross-cutting
  change). The worker guard makes those jobs no-op instantly instead, which removes the
  per-record failures and wasted embedding work — the actual cost.
- Not touching `embedding.ts` timeout/abort logic (owned by PR #3089).

## Risks

- **Stuck reindex progress** if a skipped batch does not advance the progress counter /
  clear the reindex lock. Mitigation: on skip, advance progress by the batch size
  (records counted as processed) and run the same lock bookkeeping as a normal batch.
- **Over-suppression:** a transient provider blip during a single probe could skip a
  legitimate batch. Accepted: the next reindex re-runs; this is best-effort indexing and
  far better than a storm. The probe runs only in the batch path, not on healthy
  single-record CRUD writes.
- **Merge conflict with #3089** on `embedding.ts`: avoided by read-only use of its
  public surface.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append `— <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Pure preflight helper + log helper

- [x] 1.1 Add always-on `searchWarn` to `packages/search/src/lib/debug.ts` — b01f9bb71
- [x] 1.2 Add pure `evaluateVectorPreflight` helper in `packages/search/src/vector/lib/preflight.ts` — b01f9bb71
- [x] 1.3 Unit tests for `evaluateVectorPreflight` (ok + all three skip codes, probe injected) — b01f9bb71

### Phase 2: Wire preflight into the vector-index worker

- [x] 2.1 Resolve embedding service + pgvector driver and run preflight in the `batch-index` path; skip with one warning while still advancing progress/heartbeat/lock — 6273cdb80
- [x] 2.2 Run preflight (no probe) in the single-record `index` path; skip with one warning; never gate `delete` jobs — 6273cdb80
- [x] 2.3 Unit tests: batch skip on dimension-mismatch & provider-unreachable emits one warning and indexes no records; single-record skip on mismatch — 6273cdb80

### Phase 3: Validation gate

- [ ] 3.1 `yarn generate` (if discovered files changed), `yarn workspace @open-mercato/search build`, `yarn workspace @open-mercato/search test`
- [ ] 3.2 `yarn typecheck`, `yarn lint`, then full gate (`yarn build:packages`, `yarn test`, `yarn build:app`)

### Phase 4: Review & PR

- [ ] 4.1 `om-code-review` + BC self-review
- [ ] 4.2 Open PR against `develop`, normalize labels (bug, risk-medium, priority-medium, skip-qa), run `om-auto-review-pr`, post summary comment
