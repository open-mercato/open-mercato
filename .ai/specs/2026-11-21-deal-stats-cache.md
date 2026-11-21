# Cache Deal Closure Stats

Issue: #3666

## TLDR

Reuse the CRUD cache to avoid rerunning organization-wide counts when an authorized caller reads a closed deal's stats. Cap each cache entry at 60 seconds and evict affected entries through existing collection tags.

## Problem

The deal closure view reads `GET /api/customers/deals/{id}/stats`. The route runs a weekly outcome count on each successful read and a second count for quarter ranking on eligible won deals. The work grows with the organization's deal volume.

## Approach

Resolve the target and authorize the request before consulting a tenant- and organization-scoped cache entry. Continue to compute the same response from the database on a miss.

The role list in #3143 and deal aggregates in #5785 already use this pattern. This design extends the opt-in CRUD caching in [CRUD API performance quick wins](./2026-05-24-crud-api-performance-quick-wins.md) to the single-deal stats route, which still performs the counts on every successful request. [Redis cache-aside documentation](https://redis.io/docs/latest/develop/use-cases/cache-aside/) describes the same combination of expiration and invalidation on writes.

## Architecture

- Preserve the dispatcher's feature check, the route's request-scoped authorization and deal lookup, and its closed-outcome check. A warm entry still requires a successful authorized deal read.
- Gate cache access on `isCrudCacheEnabled()`. Resolve the service with `resolveCrudCache()` and run reads and writes inside `runWithCacheTenant()`. Use the persisted deal's tenant and organization and bypass cache if its tenant is unavailable.
- Use a versioned route key with the tenant, organization, deal ID, and a digest of the caller's effective organization scope. Canonicalize scope ID arrays before hashing. Include the same ISO-week and quarter start timestamps used by the database queries so the cache changes periods at the same instant as the queries.
- Validate cached data with the existing response schema. On a valid hit, return the stored payload after the deal lookup. This skips one weekly count, the conditional ranking count, and any associated pipeline or loss-reason lookups. A miss or cache failure runs the current queries and returns their result.
- Store successful responses for 60 seconds with scoped `customers.deal`, `customers.pipeline`, and `dictionaries.entry` collection tags. Deal writes invalidate the entire organization slice because other deals can affect both aggregates. The route resolves the loss reason from the shared `DictionaryEntry` entity, whose write commands invalidate `dictionaries.entry`. The CRM legacy dictionary entity has a separate tag.

## Compatibility and consistency

The existing GET URL, authentication requirements, status codes, response fields, and calculation rules are preserved. Turning off `ENABLE_CRUD_API_CACHE` restores the existing uncached path. A miss racing with a committed write can repopulate stale data during the cache-aside window. The TTL also bounds entries missed by invalidation. The database remains authoritative.

## Acceptance criteria

- When the flag is off, the request completes without resolving or calling the cache.
- When the flag is on, repeated authorized reads of the same deal and period return the same payload and skip the counts on a hit. An unavailable cache or invalid entry still returns a fresh successful result.
- When any tenant, organization, deal, effective scope, week, or quarter axis changes, the previous entry cannot satisfy the request. A denied or unclosed deal fails before cache access.
- When another deal in the same organization is closed through the normal API, the warmed entry is invalidated and the next read reflects the updated weekly count and rank. The integration test first demonstrates a cache hit with the real cache enabled.

## Implementation Plan

### Phase 1: Cache closed-deal stats

1.1 Add route unit tests for flag gating, key isolation and period boundaries, collection tags, hit behavior, and failure fallback. Implement the cache lookup and store through the existing helpers.

1.2 Add a self-contained integration test using closed-deal fixtures. Warm the stats entry, change a test fixture directly in the database to confirm a repeat read hits the cache, then close a higher-value deal through the API and verify the first deal's count and rank refresh.

1.3 Run the focused unit and integration tests, regenerate route artifacts, and run the configured validation gate.

## Final compliance report

The route uses the existing scoped cache, tenant and organization checks, and encryption-aware entity reads. The proposed change introduces no additional HTTP paths, UI surfaces, schema changes, or runtime dependencies.

## Changelog

- 2026-11-21 — Specified the opt-in deal-closure stats cache and its invalidation coverage.
