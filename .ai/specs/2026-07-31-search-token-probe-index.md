# Search Token Probe Index — O(1)-class Availability Answer

- **Status:** Implemented (pending review)
- **Scope:** OSS
- **Date:** 2026-07-31
- **Related:**
  - `.ai/specs/2026-07-24-search-architecture-clarification-and-evolution.md` (Phase 4 / B.4 — the availability resolver whose probe this index serves)
  - PR #4723 (probe gate + the original analysis of the pathological plan), PR #4685 (adds `search_tokens_unique_tuple_idx` — different column order, no overlap)
  - Code: `packages/shared/src/lib/search/availability.ts`, `packages/core/src/modules/query_index/data/entities.ts`, `packages/core/src/modules/query_index/migrations/Migration20260731105052_query_index.ts`

## TLDR

Make the query engines' "does (entity_type, tenant, org) have any search tokens?" probe cheap for **both** answers by adding one index in the probe's exact column order:

```sql
create index concurrently "search_tokens_presence_idx"
  on "search_tokens" ("entity_type", "tenant_id", "organization_id");
```

The measures already shipped in Phase 4 (like/ilike gate, `= / IS NULL` predicates, 30 s process-level TTL cache) gate and amortize the probe but cannot make its worst case cheap: the **miss** — an entity whose tokens exist for other tenants but not the caller's — had to exhaust every index entry for that `entity_type`, because no existing index exposes `tenant_id` as an access column (`search_tokens_lookup_idx` interposes `field, token_hash`). Production experience confirms multi-million-row `search_tokens` is the steady state for real deployments — not an artifact of the #4685 growth bug — so the miss cost does not go away on its own.

With this index, the probe `WHERE entity_type = ? AND tenant_id = ? [AND organization_id IN (...)] LIMIT 1` is a pure B-tree prefix seek: a few page reads whether the answer is yes **or no**.

## Why an index and not a summary table

An earlier draft of this spec proposed a `search_token_presence` marker table (one row per scope with tokens), maintained by the four token write/purge sites. It was implemented and then replaced by this index at the maintainer's direction ("can we avoid a third table?"), because the index dominates on every axis that matters:

| | Marker table | This index |
|---|---|---|
| Drift risk | 4 write hooks + stale-marker analysis + pinning tests | **Zero — Postgres maintains it** |
| Code | ~500 lines (entity, helpers, wiring, resolver layer, tests) | **Zero — the probe already has the right shape after Phase 4's predicate reshape** |
| Rollout | "table exists ⇒ authoritative" fallback protocol | None — the probe just gets fast |
| Miss cost | 1 row read | ~3–4 page reads (equivalent in practice) |
| Disk | ~KBs | ~1–3 GB on a 412M-row table (PG13+ B-tree deduplication compresses the low-cardinality keys heavily) |
| Write cost | 1 upsert per token batch | One more index on a high-churn table — the cost class #4685's 6-column unique index already accepts |

The key unlock: #4723's original "no index rescues this query" conclusion was true only for the `IS NOT DISTINCT FROM` predicate shape, which cannot be an index access condition. Phase 4 replaced it with `= / IS NULL`; after that, a purpose-ordered index serves the probe directly. `IS NULL` is a B-tree access condition, and an org-scope filter within the `(entity_type, tenant_id)` prefix touches only that tenant's distinct org keys.

`entity_index_coverage` was also evaluated as a host for the answer and rejected: its rows are created lazily (absent ≠ "no tokens"), its refresh machinery rewrites rows the flag would ride on, and its NULL-tenant keying needs a prune-duplicates workaround — a tri-state column there re-introduces the expensive miss for every scope its warmup has not visited.

## Changes

- `data/entities.ts` — `@Index({ name: 'search_tokens_presence_idx', properties: ['entityType', 'tenantId', 'organizationId'] })` on `SearchToken`.
- `Migration20260731105052_query_index.ts` — retry-safe `drop index concurrently if exists` followed by `create index concurrently`, with `isTransactional() => false` (concurrent index operations cannot run inside a transaction; same pattern as `Migration20260611103000_query_index`). Dropping first removes an invalid index stub left by an interrupted build instead of letting `IF NOT EXISTS` silently accept it. Snapshot updated additively.
- No API, resolver, or engine code changes — the resolver's probe already emits the served shape.

## Backward Compatibility

Additive index only. No table, column, API route, event, DI key, or type changes. Rollback: drop the index — behavior returns to the Phase 4 state (gated, reshaped, cached probe). The migration is online (`CONCURRENTLY`); on very large instances the build takes a while but does not block token writes.

## Testing

- The Phase 4 unit suites already pin the probe's predicate shape (`tenant_id = ? / IS NULL`) and count probes on both engines; an index changes no observable SQL, so they pass unchanged.
- Integration: `packages/core/src/modules/query_index/__integration__/TC-QIDX-4731-token-presence.spec.ts` — two isolated custom-entity scopes receive explicit token fixtures; records-API search proves the token-backed route in one scope, then proves the plain-column fallback in the other after that scope's tokens are deleted. Distinct scopes keep both availability answers deterministic without waiting for the process TTL cache.
- Perf evidence for the PR: `EXPLAIN` of the probe's miss case on a large-table instance, before/after the index.

## Non-goals

- No change to what the availability answer means or to any routing decision.
- No summary/marker table (analyzed above; revisit only if the index's disk/write cost proves problematic in practice).
- No changes to token content, caps, or growth behavior (#4685's domain).

## Changelog

- 2026-08-01 — Stabilized the routing integration test with two independently cached entity scopes and explicit token fixtures; this removes the false assumption that custom document-storage writes schedule token indexing and avoids timeout-based cache expiry.
- 2026-08-01 — Re-review hardening: made the concurrent index migration retry-safe after an interrupted build and made the integration test establish its token-backed routing precondition before testing fallback.
- 2026-07-31 — Initial version. Supersedes the same-day `search-token-presence-marker` draft: the marker table was implemented, then replaced by this index once the maintainer asked whether a third table was avoidable — the Phase 4 predicate reshape had made a purpose-ordered index sufficient, with zero drift risk and zero maintenance code.
