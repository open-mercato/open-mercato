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

- `tokenize.test.ts`: field-char truncation, per-field and per-record token caps.
- `search-tokens.test.ts`: INSERT uses `ON CONFLICT DO NOTHING`; record cap honored.
- `engine` auto-reindex debounce: second query within the window schedules once.

## Migration & backward compatibility

- Additive migration; the unique index is built after de-duplication so it never
  fails on existing duplicate rows. New env vars are optional with safe defaults;
  existing behavior is preserved when unset. No contract surface removed.

## Changelog

- 2026-07-30: Initial spec + implementation (A, B, D).
</content>
</invoke>
