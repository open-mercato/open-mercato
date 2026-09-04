# Adopt the read-through enricher cache for the WMS inventory enrichers

Tracking issue: #5780
Source doc: none — the issue body is the brief. The programme context is
`.ai/specs/2026-06-03-enterprise-performance-stability-hardening.md` (landing on
PR #5777, Recovery addendum → enricher execution findings), which is a research
and roadmap document covering fifteen tickets and carries no implementation
breakdown for this one.

## Goal

Stop the three WMS inventory enrichers from re-running their cross-module reads
on every catalog-product, catalog-variant, and sales-order list response, by
giving them the read-through cache the enricher runner already implements —
without letting any cached value outlive the write that invalidates it, and
without letting the cache serve stale **base** record fields.

## Scope

Measured motivation (2026-08-28 local production-topology benchmark, at the
20 journeys/s latency knee): `wms.catalog-product-inventory` produced 477
slow-enricher events at 864 ms mean and 1,962 ms max; `wms.sales-order-inventory`
produced 435 events at 892 ms mean and 1,938 ms max. They were the two leading
slow-enricher fingerprints in both the ramp and the stress run.

Per list call today:

- `wms.sales-order-inventory` (`packages/core/src/modules/wms/data/enrichers.ts:415`)
  resolves a feature toggle, reads order lines through the QueryEngine, then runs a
  `Promise.all` over reservations, balances, the primary warehouse and explicit
  assignments, then loads warehouses by id — roughly seven reads across three
  sequential rounds.
- `wms.catalog-product-inventory` (`:579`) reads catalog variants, then inventory
  profiles and balances — three reads across two rounds.
- `wms.catalog-variant-inventory` (`:653`) reads profiles and balances — two reads.

None of the three declares a `cache` block, so all of this repeats on every
request that passes the `wms.view` ACL gate.

### Correctness problem found during triage — why Phase 1 exists

The runner's existing read-through path (`packages/shared/src/lib/crud/enricher-runner.ts`)
caches and restores the **whole record array** (`currentItems = cached`) rather
than the fields the enricher contributed. Because `strategy: 'read-through'`
is currently declared by zero shipped enrichers, that has never been exercised in
production. Adopting it as-is would introduce two user-visible defects:

1. **Stale base records.** A cache hit replaces the freshly-read records with the
   snapshot taken at write time, so an edit to a product's name, price or status
   would not appear in the list for up to the TTL — a regression far wider than
   inventory staleness.
2. **Lost upstream enrichment.** Enrichers run as a chain over a shared
   `currentItems`. A cached array for enricher *N* also carries enricher *N−1*'s
   output as it stood at write time, silently overwriting whatever *N−1* just
   produced.

A third, narrower hazard: the cache key is `enricher + tenant + organization +
mode + sorted record ids` and carries no field-selection component, so two list
requests for the same records with different projections collide.

Caching the **additive delta** (the keys the enricher adds, merged onto the
freshly-read record) fixes all three at once: the delta is a pure function of the
enricher, the tenant/organization scope, and the record ids — exactly what the
existing key already encodes. This is the root-cause fix for the primitive, it is
confined to the runner's cache read/write path, and it is a prerequisite for any
enricher adopting the cache safely.

### Non-goals

- Parallelizing the enricher runner or introducing priority bands (tracked
  separately under #5779).
- Precomputing or denormalizing inventory summaries into a projection table.
- Any enricher outside the three WMS inventory enrichers.
- The slow-enricher logging throttle (already in flight on PR #5794).
- Setting `cacheableOnListHit: true` — it stays at its fail-closed default,
  because these are cross-module reads the CRUD list cache does not invalidate on.
- Making the currently-dead `cache.invalidateOn` field functional; invalidation is
  wired through events and command side effects instead.

## Implementation Plan

### Phase 1: Make the read-through enricher cache additive-delta safe

Cache only what the enricher contributed, and fail closed whenever a delta cannot
be computed safely.

- Store, per record id, the set of own enumerable keys the enricher **added** to
  the record; on a hit, merge that delta onto the freshly-read record.
- Skip the cache write entirely when the enricher **mutated a pre-existing key**
  (the delta would silently drop that mutation on a later hit) or when any record
  lacks a usable id.
- Treat a delta map that does not cover every record in the batch as a miss.
- No change to the `ResponseEnricher.cache` type, so no contract surface moves.

### Phase 2: Adopt the cache on the three WMS inventory enrichers

- Add shared tag constants so the write side and the read side cannot drift.
- Declare `cache: { strategy: 'read-through', ttl: 30_000, tags: [...] }` on all
  three enrichers: `wms:inventory` on all three (balances, reservations, profiles),
  plus `wms:warehouse` on the sales-order enricher (warehouse names, primary
  warehouse, explicit assignment).
- Per-warehouse tags are deliberately **not** used: `cache.tags` is a static array
  read from the enricher definition, so it cannot vary per call without changing
  the runner's tag contract. Collection-level tags over-invalidate slightly and
  never under-invalidate.

### Phase 3: Invalidate the tags from every WMS write surface

- One shared invalidation helper, mirroring the established precedent in
  `packages/core/src/modules/directory/subscribers/invalidateOrgScopeCache.ts`:
  resolve `cache` from the subscriber container and call `deleteByTags` inside
  `runWithCacheTenant(tenantId, …)` so the tenant-scoped tag prefixes match the
  ones the request-time write used. Failures are swallowed; the TTL is the backstop.
- Subscribe it to every write event that moves data the enrichers read. The event
  matcher is single-segment, so `wms.*` would not match `wms.inventory_balance.created`;
  each pattern is registered explicitly.
- The sales-order warehouse assignment commands emit **no** event
  (`packages/core/src/modules/wms/commands/sales-order-assignment.ts`), so they get
  a direct invalidation call in their side effects.

### Phase 4: Integration coverage and the full validation gate

## Risks

- **A missed invalidation path leaves stale inventory for up to the TTL.** This is
  the main risk the change carries. Mitigated by enumerating the write surfaces
  exhaustively from `wms/events.ts` and the command files, by choosing
  collection-level tags that over-invalidate rather than under-invalidate, and by
  the short 30 s TTL as an unconditional backstop.
- **The Phase 1 runner change touches shared code on every enriched response.**
  Mitigated by the fact that the modified path only executes for enrichers that
  declare `cache.strategy: 'read-through'` — before this PR, none; after it, three.
  Every other enricher keeps its exact current code path.
- **Cross-module staleness from catalog.** `wms.catalog-product-inventory` reads
  catalog variants, so a variant added to or removed from a product changes its
  enrichment. Handled by subscribing to the catalog variant events as well.

## Progress

### Phase 1: Make the read-through enricher cache additive-delta safe

- [x] 1.1 Cache additive enrichment deltas in the list path of the enricher runner — 8b820948d
- [x] 1.2 Cache additive enrichment deltas in the single-record path of the enricher runner — 8b820948d
- [x] 1.3 Unit-test the delta cache: hit, miss, non-additive fail-closed, partial-map miss — 8b820948d

### Phase 2: Adopt the cache on the three WMS inventory enrichers

- [x] 2.1 Add shared WMS enricher cache tag constants and declare the cache blocks — ad99b3331
- [x] 2.2 Unit-test that a second enrichment within the TTL performs no cross-module reads — ad99b3331

### Phase 3: Invalidate the tags from every WMS write surface

- [x] 3.1 Add the shared invalidation helper and the WMS/catalog event subscribers — ad99b3331
- [x] 3.2 Invalidate directly from the sales-order warehouse assignment commands — ad99b3331
- [x] 3.3 Unit-test the subscriber and the command-side invalidation — ad99b3331

### Phase 4: Integration coverage and the full validation gate

- [x] 4.1 Extend the catalog products list integration test for post-invalidation freshness — TC-WMS-STOCK-COL-004
- [x] 4.2 Run the full validation gate and fix any fallout — green
