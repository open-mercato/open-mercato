# Search Presenter i18n

**Status:** ready for implementation
**Owner:** search / core
**Date:** 2026-05-20 (decisions resolved 2026-06-08)
**Tracking issue:** [open-mercato/open-mercato#327](https://github.com/open-mercato/open-mercato/issues/327)

## TLDR

**Key Points:**
- Global search (Cmd+K) presenters render English `title`/`subtitle`/`badge`/link-label strings for users on any locale because either (a) the presenter strings are hard-coded English literals in `search.ts`, or (b) translations are computed by the indexing worker at index time and frozen into Meilisearch / pgvector storage.
- Fix the freezing path by recomputing presenters at search time with the request's locale, and migrate the remaining hard-coded literals to i18n keys with safe fallbacks.

**Scope:**
- `presenter.title`, `presenter.subtitle`, `presenter.badge` and `link.label` across every `search.ts` (10 modules).
- The runtime gate `needsSearchResultEnrichment` in `packages/search/src/lib/search-result-enrichment.ts` that currently short-circuits enrichment when a stored presenter exists.
- The entity-type group headings rendered by `formatEntityId()` — duplicated across `GlobalSearchDialog.tsx`, `HybridSearchTable.tsx`, and `TopbarSearchInline.tsx` — translated via a **client-side i18n map** (`search.entityType.<module>.<entity>`) with the humanized string as fallback.
- **Real `en`/`pl`/`es`/`de` copy** for every new key, landed in this PR (not English-only fallbacks).

**Out of scope:**
- The vector embedding `text:` source used by `buildSource` — re-embedding on locale switch is unbounded cost; embedding text stays canonical English.
- `SearchResultPresenter` contract shape changes. Keyed-payload presenters (`{ key, fallback, params }`) are documented as a follow-up; this spec keeps the contract as plain strings.

## Resolved Decisions (2026-06-08)

The original Open Questions are resolved as follows (block removed per spec convention):

- **Q1 → embedding `text:` stays English.** The issue body scopes to display; `text:` is the embedding source, not on the display path. Re-embedding per locale is unbounded cost.
- **Q2 → `formatEntityId()` is in scope now.** Translated via a client-side i18n map across all three components that render it (not just the dialog). See [Entity-type group headings](#entity-type-group-headings).
- **Q3 → recompute every matched result on every request.** No locale-fingerprint fast-path in this spec; add it later only if profiling shows request-time recompute is too expensive.
- **Architectural fork → request-time recompute** (not keyed-payload). Keyed-payload remains a documented follow-up (see [Alternatives Considered](#alternatives-considered)).

## Problem Statement

`GlobalSearchDialog` (`packages/search/src/modules/search/frontend/components/GlobalSearchDialog.tsx`) renders the `presenter` payload returned by `/api/search/global` verbatim — there is no `useT()` resolution at display time. The values it receives come from one of three paths:

1. **Fulltext** (Meilisearch) — `presenter` was stored at index time by `SearchIndexer` (`packages/search/src/indexer/search-indexer.ts:222, 522`). The worker computed `buildSource.presenter` and `formatResult` in its own locale (typically the bootstrap `defaultLocale = 'en'`).
2. **Vector** (pgvector) — `presenter.title`/`subtitle` stored in `result_title`/`result_subtitle` columns at index time (`packages/search/src/vector/services/vector-index.service.ts:724`), same freezing problem.
3. **Tokens** — no stored presenter; `presenterEnricher` computes one at search time using the **request's** locale.

`SearchService.search()` then runs `presenterEnricher` (`packages/search/src/service.ts:144`), but `presenter-enricher.ts:207` only enriches results that match `needsSearchResultEnrichment()` (`packages/search/src/lib/search-result-enrichment.ts:11-17`) — missing title, encrypted value, or no url+links. Everything else is returned as-stored. So fulltext and vector ship the worker's locale; tokens ship the requester's locale. Same query, different locales per strategy. Bug.

Beyond the bug, four modules never adopted `resolveTranslations()` at all and ship hard-coded English literals (see [Audit](#audit) below).

## Audit

10 `search.ts` files reviewed. Counts below cover only the display path (presenters + link labels). Indexed `text:` lines (embedding source) are out of scope.

| Module | i18n adoption | Frozen-locale bug | Hard-coded literals to remove |
|---|---|---|---|
| `packages/core/src/modules/catalog/search.ts` | partial — `translate()` for badges and statuses | Yes | None |
| `packages/core/src/modules/sales/search.ts` | most complete — `translate()` for 18 document/line/adjustment badges | Yes | None |
| `packages/core/src/modules/staff/search.ts` | badges only | Yes | None |
| `packages/core/src/modules/planner/search.ts` | badges only | Yes | None |
| `packages/core/src/modules/resources/search.ts` | badges only | Yes | None |
| `packages/core/src/modules/customer_accounts/search.ts` | badges only | Yes | None |
| `packages/core/src/modules/customers/search.ts` | **none** | N/A | Many (see below) |
| `packages/core/src/modules/messages/search.ts` | **none** | N/A | `badge: 'Message'` at `:43` |
| `packages/checkout/src/modules/checkout/search.ts` | **none** | N/A | `subtitle: 'Link Template'` at `:39, :44` |
| `packages/core/src/modules/inbox_ops/search.ts` | **none** | N/A | `title: '… || Inbox Proposal'` (`:42, :57`); subtitle template `Confidence: … - Status: … - Category: …` (`:43, :58`) |

### Customers — literal inventory

`packages/core/src/modules/customers/search.ts`:

**Presenter badges**
- `:514` — `badge: … ? 'Person' : undefined`
- `:565` — `badge: … ? 'Company' : undefined`
- `:893, :920` — `badge: 'Deal'`
- `:991` — `badge: 'Activity'`

**Link labels**
- `:640` — `'Open person'`
- `:678, :768, :936` — `'Edit'`
- `:730` — `'Open company'`
- `:847` — `'View customer'` (also: fallback to related customer's `display_name`)
- `:851, :1007` — `'Open deal'`
- `:1075` — `'Open todo'`

**Title fallbacks** (shown when the record has no display name)
- `:494` — `'Person'`
- `:536` — `'Company'`
- `:890, :917` — `'Deal'`
- `:1057` — `'Customer task'`

## Proposed Solution

Move presenter rendering from index time to **request time**, so the locale is always the requester's. Keep `SearchResultPresenter` as plain strings — no contract change in this spec.

Two changes:

1. **Flip the enrichment gate.** `needsSearchResultEnrichment()` should return `true` for any result whose entity has a registered `formatResult` (or `buildSource.presenter`) in a `SearchModuleConfig`, regardless of whether a stored presenter is present. The stored presenter remains the fallback used when re-rendering fails or when no config exists. Tokens-only entities are unaffected.
2. **Migrate the four un-translated modules.** customers, messages, checkout, inbox_ops — add `import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'`, lift each hard-coded literal to a translation key (`<module>.search.badge.*`, `<module>.search.link.*`, `<module>.search.fallback.*`), and add entries to each module's `i18n/{en,pl,es,de}.json`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Recompute at request time (server-side) instead of storing translation keys in the index | Smallest delta. `SearchResultPresenter` is a public type (`packages/shared/src/modules/search.ts:19`) listed under BC contract surfaces; an additive `{key, fallback, params}` shape is feasible but pushes a schema migration onto the fulltext + vector stores and requires reindex. Server-side recompute reuses the existing `presenterEnricher` plumbing. |
| `buildSource.text` (embedding source) labels stay English | Re-embedding on locale switch is unbounded cost. Vector semantic search is driven by record values, not label prefixes. Multilingual embedding models tolerate this. |
| Token-strategy fallback unchanged | Tokens already re-render per request — no behavior change. |
| Keep stored presenter as the last-resort fallback if `formatResult` throws | Avoids regressing back to "result with no title" if a downstream config has a bug. |
| Module i18n namespace is `<module>.search.{badge,link,fallback}.<id>` | Matches existing convention in `catalog`, `sales`, `staff`, `planner`, `resources`, `customer_accounts`. |

### Entity-type group headings

Search results in the UI are grouped under a heading derived from `entityId` by `formatEntityId()` (e.g. `customers:customer_person_profile` → `"Customers · Customer Person Profile"`). This helper is **duplicated in three components**: `GlobalSearchDialog.tsx:143`, `HybridSearchTable.tsx:171`, and `TopbarSearchInline.tsx:139`. It is purely client-side and untranslated.

Approach: **client-side i18n map**, not server-side presenter enrichment. Entity types are a static taxonomy (not record-derived data), so resolving them in the browser is cheaper and needs no per-result server work or `SearchResultPresenter` contract change.

- Each call site resolves `t(`search.entityType.${module}.${entity}`, formatEntityId(entityId))` — a single clean localized label per entity type (e.g. "Customer", "Order", "Product") that replaces the "Module · Entity" string.
- The existing `formatEntityId()` humanized output remains the **fallback**, so third-party / unindexed entity types degrade gracefully.
- `useT()` is added to the two components that don't already have it (`GlobalSearchDialog` already does).
- Keys live in the **search module's** i18n (`search.entityType.*`) because the taxonomy spans modules. ~45 keys for the currently-indexed entity types (enumerated from the 10 `search.ts` configs); `lucide:link` is excluded (icon-map artifact, not an indexed entity).

### Alternatives Considered

| Alternative | Why Rejected (for this spec) |
|-------------|-------------|
| **Keyed presenter payload** — extend `SearchResultPresenter` to allow `title \| { key, fallback, params }`; resolve in `presenterEnricher` or in the dialog. | Larger contract change (touches the type, indexer serialization, vector store column shape, and the dialog). Migration story across existing indexed data is non-trivial. Reasonable as a follow-up after profiling shows request-time recompute is too expensive. |
| **Client-side `useT()` for presenter strings** (title/subtitle/badge/link.label) | These are record-derived; the dialog has no stable key to resolve without the keyed payload above. (Distinct from the entity-type headings, where the key *is* derivable from `entityId` — that path does use client-side `useT()`; see [Entity-type group headings](#entity-type-group-headings).) |
| **Server-side `entityLabel` on `SearchResultPresenter`** (resolve headings in the enricher) | Additive contract change + per-result server work for a value that depends only on the static entity-type taxonomy. Client-side resolution is cheaper and needs no contract change. |
| **Translate `buildSource.text` labels too** | Requires re-embedding on every locale (or one canonical reindex per locale). Not justified by the issue body, which scopes to display. |
| **Reindex once per supported locale** | Storage and worker cost multiplies by N locales; complicates change detection (`checksumSource` would need locale awareness). |

## Architecture

### Request flow (after change)

```
GlobalSearchDialog                                  /api/search/global
     │                                                       │
     │ fetchGlobalSearchResults(q)                           │
     │──────────────────────────────────────────────────────▶│
     │                                                       │
     │                                          SearchService.search()
     │                                                       │
     │                                          strategies.search() ──▶ fulltext / vector / tokens
     │                                                       │
     │                                          presenterEnricher(results, tenantId, orgId)
     │                                                       │
     │                                          for each result whose entity has a `formatResult`:
     │                                            ─ load doc from entity_indexes
     │                                            ─ await resolveTranslations()      ◀── request locale
     │                                            ─ buildSource(ctx) / formatResult(ctx)
     │                                            ─ replace result.presenter
     │                                                       │
     │ ◀──────────────────────────────────────────────────  results (presenter localized)
     │
     │ render presenter.title / subtitle / badge / link.label verbatim
```

### Touchpoints

| Layer | File | Change |
|---|---|---|
| Enrichment gate | `packages/search/src/lib/search-result-enrichment.ts` | Accept an optional `entityHasConfig` predicate; return `true` when the entity has a `formatResult`/`buildSource` regardless of stored presenter |
| Enricher | `packages/search/src/lib/presenter-enricher.ts` | Pass `entityConfigMap` lookup into the gate; ensure per-request `resolveTranslations()` is called once and reused via `SearchBuildContext` (cache on the closure) |
| Per-module `search.ts` (untranslated) | `customers`, `messages`, `checkout`, `inbox_ops` | Add `resolveTranslations()`, replace literals with `t(key, fallback)` |
| Per-module `i18n/{en,pl,es,de}.json` | All migrated modules | Add `<module>.search.*` keys with real copy |
| Entity-type heading components | `GlobalSearchDialog.tsx`, `HybridSearchTable.tsx`, `TopbarSearchInline.tsx` | Resolve heading via `t(`search.entityType.${module}.${entity}`, formatEntityId(...))`; add `useT()` where missing |
| Search module i18n | `packages/search/src/modules/search/i18n/{en,pl,es,de}.json` | Add ~45 `search.entityType.*` keys with real copy |

`SearchService.search()`, the indexer write path, and the storage schemas are unchanged. `GlobalSearchDialog`'s presenter rendering is unchanged; only its entity-type heading is now resolved via `useT()`.

### Performance considerations

Recomputing on every request adds work for fulltext + vector hits that previously short-circuited. Two amortizations:

1. **Doc batching** is already in place (`presenter-enricher.ts:42` `fetchDocsBatch`). The added cost is only the `buildSource`/`formatResult` invocations and any `queryEngine` hydration inside them.
2. **`resolveTranslations()` per request** loads the merged dictionary once. Subsequent calls within the same request reuse it via closure.

If profiling shows `buildSource`-driven hydration (the customers module loads the parent customer entity via `queryEngine`) is the bottleneck, a `formatResult`-only fast path (skip `buildSource` for already-stored presenters) is a follow-up optimization.

## Data Models

No schema changes. `SearchResultPresenter` (`packages/shared/src/modules/search.ts:19`) stays as plain strings. `entity_indexes`, Meilisearch documents, and `vector_search_records` storage shapes are unchanged.

## API Contracts

No external API change. `/api/search/global` continues to return `{ results: SearchResult[] }`. The only observable difference: `presenter.title`/`subtitle`/`badge` and `link.label` reflect the request's locale.

## Internationalization (i18n)

### New keys per migrated module

```jsonc
// packages/core/src/modules/customers/i18n/en.json (new entries)
{
  "customers.search.badge.person": "Person",
  "customers.search.badge.company": "Company",
  "customers.search.badge.deal": "Deal",
  "customers.search.badge.activity": "Activity",
  "customers.search.link.openPerson": "Open person",
  "customers.search.link.openCompany": "Open company",
  "customers.search.link.openDeal": "Open deal",
  "customers.search.link.openTodo": "Open todo",
  "customers.search.link.viewCustomer": "View customer",
  "customers.search.link.edit": "Edit",
  "customers.search.fallback.person": "Person",
  "customers.search.fallback.company": "Company",
  "customers.search.fallback.deal": "Deal",
  "customers.search.fallback.customerTask": "Customer task"
}
```

```jsonc
// packages/core/src/modules/messages/i18n/en.json
{
  "messages.search.badge.message": "Message"
}

// packages/checkout/src/modules/checkout/i18n/en.json
{
  "checkout.search.subtitle.linkTemplate": "Link Template"
}

// packages/core/src/modules/inbox_ops/i18n/en.json
{
  "inbox_ops.search.fallback.title": "Inbox Proposal",
  "inbox_ops.search.subtitle.template": "Confidence: {{confidence}} · Status: {{status}}",
  "inbox_ops.search.subtitle.templateWithCategory": "Confidence: {{confidence}} · Status: {{status}} · Category: {{category}}"
}
```

Mirror in `pl.json`, `es.json`, `de.json` for each module with **real translated copy** (not empty / English-fallback). The pl/es/de values land in this PR.

### Entity-type headings — `search.entityType.*`

In the search module's i18n (`packages/search/src/modules/search/i18n/{en,pl,es,de}.json`), one key per indexed entity type, keyed `search.entityType.<module>.<entity>`. The full list (~45 keys) is enumerated from the 10 `search.ts` configs; `lucide:link` is excluded. Example:

```jsonc
// packages/search/src/modules/search/i18n/en.json (excerpt)
{
  "search.entityType.customers.customer_person_profile": "Customer",
  "search.entityType.customers.customer_company_profile": "Company",
  "search.entityType.customers.customer_deal": "Deal",
  "search.entityType.sales.sales_order": "Order",
  "search.entityType.sales.sales_invoice": "Invoice",
  "search.entityType.catalog.catalog_product": "Product"
  // … one entry per indexed entity type
}
```

`en`/`pl`/`es`/`de` all land with real copy. The client-side fallback to `formatEntityId()` covers any entity type without a key (third-party modules).

### Existing keys (already in place — no change needed)

`catalog.search.badge.*`, `sales.search.badge.*`, `staff.search.badge.*`, `planner.search.badge.*`, `resources.search.badge.*`, `customer_accounts.search.badge.*`.

## UI/UX

`GlobalSearchDialog` presenter rendering is unchanged. Visually, badges and link labels switch to the requester's locale across all strategies (today they only switch for token-strategy results). Additionally, the entity-type group headings (rendered in the dialog, the hybrid table, and the topbar inline results) switch from the humanized English string to a localized label per the requester's locale.

## Migration & Compatibility

- **No data migration.** Stored presenters become "fallback if recompute fails." No reindex required.
- **No public API change.** `/api/search/global` response shape unchanged.
- **BC of `SearchResultPresenter`** — preserved. Third-party modules that ship a `search.ts` with their own `formatResult` will automatically benefit from request-time recomputation without code change.
- **Behaviour change for fulltext + vector** — title/subtitle/badge values shift from worker-locale to request-locale. Operators on `en` see no visible difference. Operators on `pl`/`de`/`es` see the labels they expect.

## Implementation Plan

### Phase 1: Runtime gate

1. Add `hasPresenterConfig(entityId)` lookup to `presenter-enricher.ts` (consults the existing `entityConfigMap`).
2. Update `needsSearchResultEnrichment()` (or its caller in `presenter-enricher.ts:207`) to include results where `hasPresenterConfig(entityId)` is true, regardless of stored presenter state.
3. Cache `resolveTranslations()` inside the enricher closure for the duration of a single search request.
4. Verify that the `SearchBuildContext` already passes through `queryEngine`/`organizationId`/`tenantId` (it does — `packages/search/src/lib/presenter-enricher.ts:132`).

### Phase 2: Migrate `messages` and `checkout` (smallest deltas)

1. `packages/core/src/modules/messages/search.ts`: import `resolveTranslations`, replace `badge: 'Message'` with `t('messages.search.badge.message', 'Message')`.
2. `packages/checkout/src/modules/checkout/search.ts`: same pattern for `subtitle: 'Link Template'` (two occurrences).
3. Add `i18n/en.json` keys for each, plus real `pl`/`es`/`de` copy.

### Phase 3: Migrate `inbox_ops`

1. Replace `'Inbox Proposal'` fallback title with `t('inbox_ops.search.fallback.title', 'Inbox Proposal')`.
2. Move the `Confidence: … - Status: …` subtitle template into i18n with interpolation params.
3. Add i18n entries.

### Phase 4: Migrate `customers` (largest surface)

1. Centralize `t()` calls at the top of each `buildSource`/`formatResult` (one `await resolveTranslations()` per call).
2. Replace all literals enumerated in [Customers — literal inventory](#customers--literal-inventory) with `t(key, fallback)`.
3. Add `customers.search.*` i18n entries to all four locale files with real copy.
4. Verify the `pickLabel(presenter.title) ?? 'Open person'` fallback path now uses `t('customers.search.link.openPerson', 'Open person')` instead.

### Phase 5: Entity-type group headings

1. Enumerate the ~45 indexed entity types from the 10 `search.ts` configs (exclude `lucide:link`).
2. Add `search.entityType.<module>.<entity>` keys to `packages/search/src/modules/search/i18n/{en,pl,es,de}.json` with real copy.
3. In `GlobalSearchDialog.tsx`, `HybridSearchTable.tsx`, and `TopbarSearchInline.tsx`, resolve the heading via `t(`search.entityType.${module}.${entity}`, formatEntityId(entityId))`. Add `useT()` to the two components missing it. Extract the shared resolution helper rather than duplicating the logic three times.

### Phase 6: Verification

1. Run `yarn test` — unit tests for `presenter-enricher.ts` covering the new gate behavior (stored presenter present, formatResult re-runs, request locale propagated).
2. Run `yarn i18n:check-hardcoded` and `yarn i18n:check-values` to confirm no remaining hardcoded search strings and that pl/es/de keys are populated.
3. Manual smoke: switch operator locale to `pl` / `de`, search via Cmd+K, confirm presenter strings **and** entity-type group headings change for customers, messages, checkout, inbox_ops results across fulltext + vector + tokens strategies.
4. Reindex is not required, but a manual `yarn mercato search reindex --tenant <id>` confirms no regression in stored data.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/search/src/lib/search-result-enrichment.ts` | Modify | Accept entity-config-aware gate; treat configured entities as always-enrich |
| `packages/search/src/lib/presenter-enricher.ts` | Modify | Pass entity-config map into gate; cache `resolveTranslations()` per request |
| `packages/search/src/__tests__/presenter-enricher.test.ts` | Modify or create | Unit tests for the new gate |
| `packages/core/src/modules/customers/search.ts` | Modify | Replace ~15 hard-coded literals with `t(key, fallback)` |
| `packages/core/src/modules/customers/i18n/{en,pl,es,de}.json` | Modify | Add `customers.search.*` keys with real copy |
| `packages/core/src/modules/messages/search.ts` | Modify | Translate `badge: 'Message'` |
| `packages/core/src/modules/messages/i18n/{en,pl,es,de}.json` | Modify | Add `messages.search.badge.message` with real copy |
| `packages/checkout/src/modules/checkout/search.ts` | Modify | Translate `subtitle: 'Link Template'` |
| `packages/checkout/src/modules/checkout/i18n/{en,pl,es,de}.json` | Create or modify | Add `checkout.search.subtitle.linkTemplate` with real copy |
| `packages/core/src/modules/inbox_ops/search.ts` | Modify | Translate title fallback and subtitle template |
| `packages/core/src/modules/inbox_ops/i18n/{en,pl,es,de}.json` | Create or modify | Add `inbox_ops.search.*` keys with real copy |
| `packages/search/src/modules/search/frontend/components/GlobalSearchDialog.tsx` | Modify | Resolve entity-type heading via `t(search.entityType.*)` |
| `packages/search/src/modules/search/frontend/components/HybridSearchTable.tsx` | Modify | Same heading resolution; add `useT()` |
| `packages/search/src/modules/search/frontend/components/TopbarSearchInline.tsx` | Modify | Same heading resolution; add `useT()` |
| `packages/search/src/modules/search/i18n/{en,pl,es,de}.json` | Create or modify | Add ~45 `search.entityType.*` keys with real copy |

### Testing Strategy

- **Unit**: `presenter-enricher.test.ts` — verify that results with a stored presenter and a registered `formatResult` are re-enriched; that results without a registered config retain the stored presenter (fallback); that `resolveTranslations()` is called with the request's locale; that `formatResult` throwing does not break the response (stored presenter is returned).
- **Integration**: `packages/search/src/modules/search/api/__tests__/global-search.routes.test.ts` (new or extended) — submit a search with `Accept-Language: pl-PL`, confirm presenters in the response are translated for fulltext + vector + tokens hits.
- **Unit (headings)**: cover the shared heading-resolution helper — known entity type resolves to its `search.entityType.*` value; unknown entity type falls back to `formatEntityId()`.
- **Manual smoke** (per `.ai/qa/AGENTS.md`): exercise Cmd+K against seeded customers/sales/catalog data in each supported locale; confirm both presenter strings and entity-type headings localize across the dialog, hybrid table, and topbar inline.

## Risks & Impact Review

### Data Integrity Failures

#### Re-render throws on previously-fine result

- **Scenario**: A future change in a module's `buildSource`/`formatResult` raises; the new gate now re-runs that path on every search request, surfacing the bug for every result instead of only for newly-indexed records.
- **Severity**: Medium
- **Affected area**: `/api/search/global`, Cmd+K dialog
- **Mitigation**: Wrap each `formatResult`/`buildSource` invocation in try/catch (the existing code already does this — `presenter-enricher.ts:147, :155`). On failure, fall back to the stored presenter, log via `logWarning`. Add a dev-only assertion so test runs catch the regression.
- **Residual risk**: A logging gap in production environments where `DEBUG_SEARCH_ENRICHER` is not set — acceptable; the stored presenter still shows.

### Cascading Failures & Side Effects

#### Performance regression on result-heavy searches

- **Scenario**: A power user issues a search that returns 50 results from fulltext + vector; every result now triggers `formatResult`, and `customers/search.ts`'s `buildSource` hydrates the related customer entity via `queryEngine` per result. Latency increases.
- **Severity**: Medium
- **Affected area**: `/api/search/global` p95
- **Mitigation**: Doc fetch is already batched (`fetchDocsBatch`, BATCH_SIZE=500). `buildSource` related-entity hydration is already cached per-call via the module's `entityIdCache`/`profileEntityCache` (`customers/search.ts:37-38`). For modules where `formatResult` does not need `queryEngine` (most cases), prefer `formatResult` over `buildSource` in the recompute path — `formatResult` is the leaner of the two and is the documented "search-time" entry point per `packages/search/AGENTS.md` ("formatResult ... resolved at search time"). The enricher already prefers `buildSource` first; flip the order so `formatResult` runs first when both are defined.
- **Residual risk**: The customers module still needs related-entity hydration for accurate display. Acceptable — equivalent cost is already paid for token-strategy results today.

### Tenant & Data Isolation Risks

- The fix does not change scoping. `tenantId` + `organizationId` continue to be passed through `SearchBuildContext`. No new tenant boundaries are introduced.

### Migration & Deployment Risks

#### Operators on non-default locales see a behavior change

- **Scenario**: After deploy, a customer running on `pl` sees badges/labels switch from English to Polish (or stay in English where translation files are not yet populated).
- **Severity**: Low
- **Affected area**: Cmd+K UX
- **Mitigation**: This is the desired behavior. Translations land with English fallback through `t(key, fallback)` — missing locale keys gracefully degrade to the fallback string.
- **Residual risk**: None.

#### Stored presenters from old indexing are still in the index

- **Scenario**: Existing Meilisearch / pgvector data has English presenters. They are bypassed by the new enrichment path, but they remain in storage.
- **Severity**: Low
- **Affected area**: Storage; no user impact
- **Mitigation**: None required. They serve as the last-resort fallback. Optional cleanup via `yarn mercato search reindex` if desired.
- **Residual risk**: None.

### Operational Risks

- The added per-request work is bounded (≤ `limit` results × per-result hydration). No new background jobs. No new external dependencies. Existing logging via `logWarning` covers enricher failures.

## Final Compliance Report — 2026-05-20

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/search/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | i18n: `useT()` client-side, `resolveTranslations()` server-side | Compliant | All migrated modules use `resolveTranslations()` server-side; dialog continues to render server-resolved strings |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | All identified literals migrate to `t(key, fallback)` |
| root AGENTS.md | No `any` types | Compliant | Spec change is internal to enricher; types preserved |
| packages/search/AGENTS.md | MUST define `formatResult` for tokens-strategy entities | Compliant | Unchanged; this spec leverages it |
| packages/search/AGENTS.md | MUST NOT include encrypted/sensitive fields in `buildSource` text | Compliant | Out of scope |
| packages/shared/AGENTS.md | Use shared `resolveTranslations()` | Compliant | All migrated modules import from `@open-mercato/shared/lib/i18n/server` |
| BACKWARD_COMPATIBILITY.md | `SearchResultPresenter` type is a stable contract | Compliant | No shape change |
| `.ai/specs/AGENTS.md` | Required sections present | Compliant | TLDR, Overview (TLDR + Problem Statement), Proposed Solution, Architecture, Data Models, API Contracts, Risks, Final Compliance, Changelog |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No changes to either |
| API contracts match UI/UX section | Pass | Dialog reads response shape unchanged |
| Risks cover all write operations | N/A | No writes |
| Cache strategy covers all read APIs | Pass | Per-request `resolveTranslations()` cache documented |
| Phasing matches file manifest | Pass | Phases 1-4 each map to manifest entries |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant** — ready for implementation. Q1–Q3 and the architectural fork resolved 2026-06-08 (see [Resolved Decisions](#resolved-decisions-2026-06-08)).

## Changelog

### 2026-06-08

- Resolved Open Questions Q1–Q3 and the recompute-vs-keyed-payload fork; removed the Open Questions block per spec convention. Status → ready for implementation.
- **Q1**: embedding `text:` stays English. **Q3**: recompute every matched result per request (fingerprint fast-path deferred). **Fork**: request-time recompute.
- **Q2 expanded into scope**: entity-type group headings (`formatEntityId`, duplicated across `GlobalSearchDialog`, `HybridSearchTable`, `TopbarSearchInline`) now translated via a client-side `search.entityType.*` i18n map with humanized fallback. Added [Entity-type group headings](#entity-type-group-headings), a new implementation phase, and manifest entries for the 3 components + the search module i18n files.
- Copy policy changed: real `en`/`pl`/`es`/`de` values for all new keys land in this PR (previously deferred as empty fallbacks).

### 2026-05-20

- Initial draft. Audit completed across 10 `search.ts` files. Recommends request-time recompute over keyed-payload contract change for the smallest delta. Vector embedding `text:` labels remain English (out of scope per issue body).
