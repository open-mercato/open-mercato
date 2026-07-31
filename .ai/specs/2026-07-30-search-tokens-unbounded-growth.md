# Search tokens unbounded growth hardening

- **Issue:** [#4681](https://github.com/open-mercato/open-mercato/issues/4681)
- **Status:** In progress
- **Modules:** `query_index` (core), `shared/lib/search`

## Problem

On a self-hosted 0.6.6 instance the `search_tokens` table grew to 221M rows /
~100 GB overnight for an entity type with only 2,205 records
(`messages:message`, long email bodies). Four compounding root causes:

1. **Non-idempotent token replacement.** `search_tokens` has no unique
   constraint on the token tuple. `replaceSearchTokensForRecord` /
   `replaceSearchTokensForBatch` do `DELETE … then INSERT` in one transaction,
   which under READ COMMITTED concurrency lets one job's INSERT land after
   another's DELETE — both token sets survive, duplicating every
   `(field, token_hash)` at exact integer multiples.
2. **Auto-reindex stampede.** `QueryEngine.scheduleAutoReindex` fires a
   fire-and-forget `query_index.reindex` on every query whenever coverage shows
   a gap, with no debounce/dedupe — observed ~10 concurrent full reindexes of
   the same entity type.
3. **Coverage stats drift.** Incremental `+1` deltas inflate `base_count` so the
   auto-reindex gap never closes (self-sustaining loop). (Largely mitigated in
   current tree: `refreshCoverageSnapshot` is COUNT-authoritative and coverage
   carries a scope unique constraint + duplicate pruning.)
4. **Uncapped prefix tokenizer.** With `OM_SEARCH_ENABLE_PARTIAL=true`,
   `expandToken` expands every word into all prefixes with no cap on field size
   or tokens per record — a single email produced 61,230 tokens for one field.

## Fixes

- **(A) Idempotency.** Add a coalesced UNIQUE index on
  `(entity_type, entity_id, field, token_hash, organization_id, tenant_id)`
  (NULL scopes folded to a sentinel UUID) and switch every token INSERT to
  `ON CONFLICT DO NOTHING`. Migration first de-duplicates existing rows, then
  builds the unique index. This alone makes overlapping rebuilds harmless.
- **(B) Auto-reindex debounce.** Per-`(entityType, tenant, organization)`
  cooldown in `scheduleAutoReindex`, controlled by
  `OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS` (default 30000ms), collapsing the
  stampede into a single scheduled reindex per window.
- **(D) Tokenizer caps.** New config caps applied in `tokenizeText` /
  `buildSearchTokenRows`:
  - `OM_SEARCH_MAX_FIELD_CHARS` (default 20000) — truncate oversized field text.
  - `OM_SEARCH_MAX_TOKENS_PER_FIELD` (default 5000).
  - `OM_SEARCH_MAX_TOKENS_PER_RECORD` (default 20000).

## Test coverage

- `packages/shared/src/lib/search/__tests__/tokenize.test.ts` — field-char
  truncation; per-field cap; single maximum-length token bounded during expansion
  (no quadratic materialization); default caps applied when a legacy config omits
  the optional cap fields.
- `packages/core/src/modules/query_index/__tests__/search-tokens-record-cap.test.ts`
  — per-record cap across fields; per-field budget spanning array-valued fields.
- `packages/core/src/modules/query_index/__tests__/indexer.test.ts` — insert path
  exercises `onConflict(doNothing)`.
- `packages/core/src/modules/query_index/__tests__/auto-reindex-debounce.test.ts`
  — burst collapse; debounce across two independently constructed engines
  (per-request containers); distinct scopes not debounced; disabled window.

## Risks & Impact Review

- **Search recall reduction (medium / search):** the default caps truncate field
  text beyond `OM_SEARCH_MAX_FIELD_CHARS` and cap tokens per field/record, so
  matches that relied on tokens deep inside very large fields will no longer hit.
  Mitigation: defaults are generous (20000 chars / 5000 tokens per field) and every
  cap is env-tunable (set to `0` to disable a cap). Residual: intentional trade-off
  to bound index size.
- **Migration cost on a bloated table (high / operations):** de-duplicating a
  221M-row table and building the unique index is expensive. Mitigation: the index
  is built `CONCURRENTLY` (no long write-lock) and the migration is non-transactional;
  the issue's own workaround (`TRUNCATE search_tokens` + controlled reindex) makes the
  build instant. Residual: the dedup DELETE still scans the table once.
- **Concurrent-build invalidation (low / operations):** a `CONCURRENTLY` build can
  leave an INVALID index if interrupted or if a duplicate is written before the
  ON CONFLICT code is deployed. Mitigation: the migration drops a leftover index
  first; on failure, drop the invalid index and rerun. Residual: requires operator
  awareness, documented in the migration header.

## Migration & backward compatibility

- **DB schema:** additive — a coalesced unique index only. Declared on the entity
  via `@Unique({ expression })` (mirroring `entity_index_jobs`) and reflected in
  `migrations/.snapshot-open-mercato.json`, so `yarn db:generate` sees no drift.
- **Public types:** the three tokenizer caps are **optional** members of the
  exported `SearchConfig`, so third-party modules that construct the type keep
  compiling. Consumers normalize missing values to the module defaults via
  `resolveTokenCaps`; unset env vars therefore preserve the caps' default behavior.
- **Auto-reindex debounce state** is process-global; cross-process dedupe is not
  attempted because the now-idempotent token writes make a redundant reindex from
  another process harmless.

## Changelog

- 2026-07-30: Initial spec + implementation (A, B, D).
- 2026-07-31: Addressed `om-auto-review-pr` feedback — `SearchConfig` caps made
  optional (backward-compatible); migration switched to non-transactional
  `CONCURRENTLY` build with ctid dedup; unique index declared on the entity +
  snapshot; debounce state moved process-global; prefix expansion bounded during
  expansion; per-field budget spans array values; added regression tests.

