# Elasticsearch Fulltext Driver (provider package)

- **Status:** Draft (pending review; Q7 open)
- **Scope:** OSS
- **Author:** agentic (research + spec), on behalf of a contributor
- **Date:** 2026-11-27
- **Tracking issue:** [#10986](https://github.com/open-mercato/open-mercato/issues/10986)
- **Related:**
  - `.ai/specs/2026-07-24-search-architecture-clarification-and-evolution.md` § A.5 (pluggability today) and § B.2 (Phase 2 — wider backend pluggability): the direction this spec executes
  - `.ai/specs/2026-08-28-tenant-global-entity-types-in-the-search-index.md` (documents with `organizationId: null`), `.ai/specs/implemented/SPEC-041-2026-02-24-search-organization-scoping.md` (organization filters on results)
  - Code: `packages/search/src/fulltext/{types.ts,drivers/index.ts,drivers/meilisearch/index.ts}`, `packages/search/src/di.ts`, `packages/search/src/strategies/fulltext.strategy.ts`, `packages/search/src/lib/field-policy.ts`
  - Operator surfaces: `packages/search/src/modules/search/api/settings/fulltext/route.ts`, `packages/search/src/modules/search/api/openapi.ts`, `packages/search/src/modules/search/frontend/components/sections/FulltextSearchSection.tsx`, `packages/search/src/modules/search/frontend/components/SearchSettingsPageClient.tsx`, `packages/search/src/modules/search/cli.ts`
  - Precedents: `packages/gateway-stripe/src/modules/gateway_stripe/di.ts` (provider package registering adapters into a shared registry from a module `di.ts`), `packages/search/src/modules/search/api/settings/vector-store/route.ts` (driver-neutral settings response with `drivers[].envVars[]`), `packages/web-research-exa` (provider package scaffold)
  - Docs: `apps/docs/docs/framework/database/hybrid-search.mdx`, `apps/mercato/.env.example`, `packages/create-app/template/.env.example`, `packages/search/AGENTS.md`

## TLDR

**Key Points:**
- Add an Elasticsearch implementation of `FullTextSearchDriver` as a dedicated workspace package `@open-mercato/fulltext-elasticsearch` (`packages/fulltext-elasticsearch`), so deployments whose mandated search cluster is Elasticsearch can run the `fulltext` strategy without Meilisearch.
- Give `@open-mercato/search` a small, additive fulltext driver registry so a provider package can contribute a driver and an operator can select it by env (`FULLTEXT_DRIVER=elasticsearch`). With no Elasticsearch package enabled, behaviour is byte-identical to today.
- Make the operator surfaces that hard-code Meilisearch (fulltext settings API, Settings → Search fulltext section, `yarn mercato search status`, env examples, docs) report whichever driver is active. All response changes are additive; the Meilisearch-specific fields stay.

**Scope:**
- Phase 1 — registry + selection in `packages/search`; the built-in Meilisearch driver is registered through the same registry; `createFulltextDriver()` resolves the driver from the registry.
- Phase 2 — `packages/fulltext-elasticsearch`: driver implementing every method the Meilisearch driver implements (search, index, delete, bulkIndex, purge, clearIndex, recreateIndex, getDocuments, listDocumentIds, getIndexStats, getEntityCounts, isHealthy), one index per tenant, the same tenant/organization filters, field-policy and encryption-map handling, index prefix and request timeout; self-registration through a module `di.ts`; app + create-app template wiring.
- Phase 3 — driver-neutral operator surfaces (settings API + OpenAPI, Settings section, CLI status, i18n, docs, env examples, `packages/search/AGENTS.md`).

**Non-goals (MVP):**
- No OpenSearch, Algolia or Typesense driver. The registry makes each a sibling package later; OpenSearch needs its own client (`@opensearch-project/opensearch`) because the two clients diverged after 7.10.
- No change to the Meilisearch driver's behaviour, the tokens/vector strategies, queue names (`fulltext-indexing`), event IDs, or DI keys (`searchService`, `searchStrategies`, `searchIndexer`, `fulltextIndexQueue`) — FROZEN/STABLE per the 2026-07-24 spec.
- No relevance tuning beyond parity with the Meilisearch defaults (typo tolerance, prefix match on the last word, all string fields searchable).
- No always-on Elasticsearch service in CI; no `docker-compose.yml` service.
- No cursor-based `listDocumentIds` contract change (see Risk "max_result_window").

**Concerns:**
- Elasticsearch reserves `_id`, `_index`, `_source` and other underscore-prefixed names as document metadata. The Meilisearch document shape (`_id`, `_entityId`, …) cannot be reused verbatim; the Elasticsearch document nests Open Mercato metadata under a `meta` object (see Data Models).
- BM25 scores are unbounded; Meilisearch returns a 0..1 ranking score the `ResultMerger` weights (`fulltext: 1.2`). The driver normalises by the response's `max_score`.
- The `@elastic/elasticsearch` 9.x client needs Node >= 22 (repo baseline is 24: fine) and must stay in the provider package, never in `packages/search`.
- `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` semantics (per-request encryption-map resolver, no memoisation) are a tenant-isolation surface and must be preserved exactly.

## Open Questions *(remove before finalizing)*

- **Q7 — Scope split (raised by the fresh-context checklist review, § 1).** Phase 3 (driver-neutral settings API / Settings section / CLI status) functions without Elasticsearch, and the Elasticsearch driver searches without Phase 3. The reviewer's verdict is SPLIT: keep registry + package here, move Phase 3 to a sibling spec. **Recommendation: KEEP, with Phase 3 trimmed to what the Elasticsearch deliverable needs for correctness** — with the driver active, today's settings response reports `driver: null, configured: false` and the Settings card says "None / Not configured" while search works, so shipping the package without the neutral surfaces ships a misleading operator UI. The pure clean-ups the reviewer identified as independent (the stale `query --strategy` help text, the Boy Scout icon/`fetch` fixes on untouched lines) are dropped from scope or done only on lines Phase 3 touches anyway. Decision owner: spec author; maintainers may overrule on #10986.

---

## Overview

Open Mercato's `fulltext` search strategy (`FullTextSearchStrategy`, priority 30) wraps a pluggable `FullTextSearchDriver`. Today exactly one driver exists, Meilisearch, and `createFulltextDriver()` builds it when `MEILISEARCH_HOST` is set. Operators whose infrastructure mandates Elasticsearch (Elastic Cloud, an existing on-prem cluster, a company standard) cannot use fulltext search at all; they fall back to the Postgres `search_tokens` strategy and lose typo tolerance and ranked results in Cmd+K / global search.

This spec adds that driver as a provider package and the minimal seam core needs to select it. Target audience: operators and integrators deploying against Elasticsearch; secondary: maintainers, who get the registry the 2026-07-24 spec planned for Phase 2, so the next driver is a package and a one-line `modules.ts` entry.

> **Market Reference:** Medusa v2's Search Module (`@medusajs/medusa/search`) keeps index lifecycle, event routing and reindex batching in the module and delegates engine calls to provider modules registered in config (`providers: [{ resolve, id }]`, `default_provider`, `index_prefix`). **Adopted:** the module/provider split with a shared `index_prefix` and an explicit default-provider setting (`FULLTEXT_DRIVER`), and the rule that the module, not the provider, owns indexing events and queues (already true here: `SearchIndexer` + `fulltext-indexing` queue stay untouched). **Rejected:** Medusa's per-index provider selection and versioned physical indexes — Open Mercato has one fulltext index per tenant shared by all entities, and `recreateIndex` already covers rebuilds; per-entity provider routing would complicate `ResultMerger` for no demand. Backstage's `plugin-search-backend-module-elasticsearch` was also reviewed: it confirms the choice of index-per-logical-scope plus a translator from an engine-neutral query to the engine DSL.

## Problem Statement

1. `createFulltextDriver()` is a closed `if (meilisearchHost)` branch. `FullTextSearchDriverId` already names `'elasticsearch'`, but nothing can produce one. The only way to plug a driver today is `addSearchStrategy(container, new FullTextSearchStrategy(driver))` from app code, which (a) cannot be selected by env, (b) registers a second strategy with id `fulltext` if `MEILISEARCH_HOST` is also set, and (c) bypasses the memoisation and encryption-map rules in `packages/search/src/di.ts`.
2. Operator surfaces are driver-specific: `GET /api/search/settings/fulltext` returns `driver: 'meilisearch' | null` and only Meilisearch env vars; `FulltextSearchSection` hard-codes the "Meilisearch" label, hints and quick-start link; `yarn mercato search status` lists only Meilisearch variables for the fulltext store; `yarn mercato search query --strategy` help says `meilisearch,vector,tokens` (stale: the strategy id is `fulltext`).
3. The 2026-07-24 spec records this as planned, demand-gated work: "Additional fulltext drivers … each ships as a dedicated provider package … `createFulltextDriver()` becomes a registry keyed by `FullTextSearchDriverId` selected via env". Issue #10986 is the demand.

## Proposed Solution

1. **Fulltext driver registry in `@open-mercato/search`** (`packages/search/src/fulltext/drivers/registry.ts`). A process-level map of `FulltextDriverFactory` objects keyed by `FullTextSearchDriverId`, stored on `globalThis` under a `Symbol.for` key so it survives Turbopack/tsx module duplication (same reasoning as the gateway adapter registry and the search module singletons). The built-in Meilisearch driver registers itself through it. `createFulltextDriver(options)` resolves which factory to use (see Selection) and calls `factory.create(config)` with the same `encryptionMapResolver` / `fieldPolicyResolver` / `defaultLimit` it passes today.
2. **Provider package `packages/fulltext-elasticsearch`** (`@open-mercato/fulltext-elasticsearch`). Build/test scaffold files (`build.mjs`, `watch.mjs`, `tsconfig.json`, `jest.config.cjs`, `package.json` exports) are copied from `packages/web-research-exa`; the module layout (`src/modules/<id>/{index.ts,di.ts,i18n/}` with a `defineProcessDiRegistrar` registrar) is copied from `packages/gateway-stripe`. `web-research-exa` itself registers through a `package.json` manifest key, which this spec does not adopt (see Alternatives). Enabled by `{ id: 'fulltext_elasticsearch', from: '@open-mercato/fulltext-elasticsearch' }` in `src/modules.ts` (app + create-app template). The driver ports the Meilisearch driver method by method with Elasticsearch equivalents (see Architecture → Driver behaviour).
3. **Driver-neutral operator surfaces.** Each factory exposes `describe()` → `{ id, label, docsUrl, envVars[] }`. The settings route adds `activeDriver` and `drivers[]` (shape mirrors the vector-store settings route), the Settings section renders from them, `search status` prints the active driver's variables. Existing fields are kept unchanged; `driver` is marked deprecated.

### Selection

`resolveFulltextDriverId(env)`:

| `FULLTEXT_DRIVER` | Registered + configured factories | Result |
|---|---|---|
| set to a registered id | that factory `isConfigured()` | that factory |
| set to a registered id | that factory not configured | an **unavailable stand-in driver** (id `unavailable`): the fulltext strategy exists but `isHealthy()` is `false`, so `fulltext-index.worker.ts` throws and the queue retries instead of completing jobs without indexing, searches skip it, and Settings → Search shows the reason; `reportSearchError('FulltextDriver', …, 'search.fulltext_driver_unconfigured')` once per process |
| set to an unknown id | any | the same unavailable stand-in; `reportSearchError('FulltextDriver', …, 'search.fulltext_driver_unknown')` once per process. Silent absence (no strategy) is reserved for the intentional case: nothing selected and nothing configured |
| unset | none configured | `null` (today's behaviour) |
| unset | exactly one configured | that factory (with only Meilisearch registered this is byte-identical to today's `MEILISEARCH_HOST` auto-detect) |
| unset | more than one configured | `meilisearch` if configured, else the first registered in registration order; a warning names `FULLTEXT_DRIVER` |

`isConfigured()` for Meilisearch is `Boolean(MEILISEARCH_HOST)` — the same condition `createFulltextDriver` uses today; for Elasticsearch `Boolean(ELASTICSEARCH_URL)`. Note that the legacy settings field `configured` requires host **and** API key (`route.ts`); that stricter computation is kept verbatim for the legacy field, while `drivers[].configured` reports `isConfigured()`. The two can differ for Meilisearch without an API key; the UI reads `drivers[]`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Provider package, not a folder in `packages/search` | Root `AGENTS.md`: every external integration provider lives in its own workspace package; 2026-07-24 § B.2 says the same for fulltext drivers; keeps `@elastic/elasticsearch` out of every install |
| Process-level registry, populated from the module `di.ts` through the DI lifecycle (`defineProcessDiRegistrar` + `registerProcessActivation` for the process root, direct `register` for legacy containers — the exact `gateway-stripe` pattern); **no import-time registration** | Zero generator/template changes; same mechanism as gateway adapters and webhook handlers; the container discards stale generations before publishing activations, so a disabled or replaced provider never survives a reload. Order is guaranteed by the container: `buildLegacyRequestContainer` runs module registrars before core `bootstrap()` (which calls `registerSearchModule`), and the process root runs activations before any scoped `searchStrategies` resolve (lazy `registerScopedSearchModule`). Phase 1 step 6 covers both paths with tests |
| `FULLTEXT_DRIVER` explicit override, auto-detect when unset | No existing deployment changes behaviour on upgrade; a single configured driver "just works"; ambiguity is logged, not guessed silently |
| One Elasticsearch index per tenant (`${prefix}_${tenant}`) | Same isolation boundary and admin semantics (`clearIndex`, `recreateIndex`, `getIndexStats`) as Meilisearch, so `SearchIndexer`, the reindex API and the Settings page need no new branches; a filter bug cannot cross tenants |
| Metadata under a `meta` object, not `_`-prefixed top-level fields | `_id` and other `_`-prefixed names are reserved Elasticsearch metadata; `meta.presenter` / `meta.links` are stored with `enabled: false` so they are never tokenised |
| Scores normalised to `_score / max_score` (relative to the page's top hit) | `ResultMerger` weights `fulltext: 1.2` against `vector` / `tokens`; raw BM25 would dominate the merge. Meilisearch's score is absolute; the relative form is accepted for MVP (Risk register) |
| Native `purge` via `_delete_by_query` | Avoids the `listDocumentIds` enumerate-and-delete fallback and its offset limits |
| `listDocumentIds` walks a point-in-time with `search_after` behind the offset/limit contract | The interface promises uncapped enumeration for reconciliation/retention (`types.ts`); `from/size` is capped by `index.max_result_window`, and raising the window only moves the ceiling. A sequential-cursor cache makes the strategy's page loop O(n) |
| Driver-neutral settings response copies the vector-store shape | One mental model for operators and one UI pattern (`drivers[].envVars[]`) already in the module |
| Selection is resolved once per process generation and reported from the live instance | `di.ts` memoises the driver; settings API, CLI and Settings UI read `activeDriver` from the fulltext strategy's `driver.id` on a request container, never from a fresh `resolveFulltextDriverSelection()`, so the registry and the serving instance cannot disagree. `unregister` exists for tests and hot reloads only; changing `FULLTEXT_DRIVER` or enabling a provider needs a restart, as every other env-driven setting does |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| App-level `addSearchStrategy(container, new FullTextSearchStrategy(esDriver))` | Works as a stop-gap, but not env-selectable, collides with Meilisearch on the `fulltext` id, skips the encryption-map / memoisation rules. Documented in the docs page as the interim path for apps pinned to a release without this spec |
| Driver inside `packages/search/src/fulltext/drivers/elasticsearch` | Violates the provider-package rule; adds the client dependency to every install |
| Manifest discovery (`openMercato.fulltextDriver` in `package.json`) + generated registry, like `web-research-adapters.generated.ts` | Heavier: CLI generator, `dynamicLoader`, `apps/mercato/src/di.ts`, create-app template and tests; revisit if a third driver appears and `modules.ts` entries become a burden |
| One shared index with a `meta.tenant_id` filter | Fewer indices on clusters with thousands of tenants, but a filter bug becomes a cross-tenant leak and `clearIndex` / `recreateIndex` / stats lose their per-tenant meaning |
| `client.helpers.bulk` for `bulkIndex` | Marked experimental, retries and drops silently via `onDrop`; the plain `bulk` API surfaces per-item errors so the queue worker's existing retry policy applies |

## User Stories / Use Cases
- **An operator** wants to **run fulltext search against the company's Elasticsearch cluster** so that **Cmd+K and global search get typo tolerance and ranking without deploying Meilisearch**.
- **An operator** wants to **see in Settings → Search which fulltext driver is active and which variables are missing** so that **misconfiguration is diagnosed without reading code**.
- **A maintainer** wants to **add the next fulltext driver as a package** so that **core stays free of engine SDKs**.
- **An existing Meilisearch deployment** wants to **upgrade without changing anything** so that **the release is safe**.

## Architecture

```
app src/modules.ts ── enables { id: 'fulltext_elasticsearch', from: '@open-mercato/fulltext-elasticsearch' }
   └─ module di.ts ──────── defineProcessDiRegistrar(registerProcessActivation(…)) / legacy register
                             └─ registerFulltextDriverFactory(elasticsearchDriverFactory)
packages/search  fulltext/drivers/index.ts ── registers meilisearchDriverFactory (built in)
packages/search  di.ts ── createFulltextDriver({ fieldPolicyResolver, encryptionMapResolver })
   └─ registry.resolve(FULLTEXT_DRIVER ?? auto-detect) ── factory.create(config) ── FullTextSearchDriver
FullTextSearchStrategy(driver) ── SearchService / SearchIndexer / fulltext-index worker   (unchanged)
GET /api/search/settings/fulltext ── listFulltextDriverFactories() ── describe() / isConfigured()
                                  └─ request container ── searchStrategies[fulltext].isAvailable() (active driver only)
```

### Registry contract (`packages/search/src/fulltext/drivers/registry.ts`)

```ts
export type FulltextDriverEnvVar = {
  name: string
  required: boolean
  secret?: boolean          // settings API reports only `set`, never the value
  hintKey: string           // i18n key, resolved by the settings route with resolveTranslations()
  hint: string              // English fallback
  defaultValue?: string
  /** URL-typed variables: the settings API strips userinfo (`user:pass@`) before echoing `value`. */
  kind?: 'url' | 'string'
}
export type FulltextDriverDescriptor = {
  id: FullTextSearchDriverId
  label: string
  docsUrl?: string
  envVars: FulltextDriverEnvVar[]
}
export type FulltextDriverFactory = {
  id: FullTextSearchDriverId
  describe(): FulltextDriverDescriptor
  isConfigured(env?: NodeJS.ProcessEnv): boolean
  create(config: FullTextSearchDriverConfig): FullTextSearchDriver
}
export function registerFulltextDriverFactory(factory: FulltextDriverFactory): () => void   // idempotent per id; returns unregister
export function getFulltextDriverFactory(id: string): FulltextDriverFactory | null
export function listFulltextDriverFactories(): FulltextDriverFactory[]                     // registration order
export function resolveFulltextDriverId(env?: NodeJS.ProcessEnv): FullTextSearchDriverId | null
```

`createFulltextDriver(options)` keeps its signature; `FulltextDriverFactoryOptions` keeps its existing `meilisearch` and `algolia` keys unchanged (type is a contract surface) and gains an optional `driver?: FullTextSearchDriverId` override (tests, CLI). `defaultLimit` (20) is passed through to every factory and used as the `search` / `listDocumentIds` default size, as the Meilisearch driver does today. `createFulltextDriver({ meilisearch: { host } })` keeps selecting and configuring Meilisearch without any environment variable (today's programmatic path); provider factories are configured from the environment only — `create(config)` receives the resolvers and `defaultLimit`, and a provider that needs programmatic overrides exposes its own `createXDriver(options)` export, as Meilisearch does. Exports are added to `packages/search/src/fulltext/index.ts` and `src/index.ts` (additive).

### Provider package layout (`packages/fulltext-elasticsearch`)

```
package.json            name @open-mercato/fulltext-elasticsearch; deps: @elastic/elasticsearch ^9.5; peer: @open-mercato/search, @open-mercato/shared
build.mjs / watch.mjs / tsconfig.json / jest.config.cjs      (copied from packages/web-research-exa; moduleNameMapper → ../search/src, ../shared/src)
src/index.ts            exports createElasticsearchDriver, elasticsearchDriverFactory, ElasticsearchDriverOptions
src/driver/index.ts     createElasticsearchDriver(options): FullTextSearchDriver
src/driver/client.ts    lazy Client; auth (api key | basic); timeout; TLS
src/driver/index-name.ts  buildIndexName(prefix, tenantId); mappings + settings
src/driver/documents.ts prepareDocument (field policy + encryption map parity); fromHit
src/driver/queries.ts   buildQuery(text, options) → bool query; organization/entity filters
src/factory.ts          elasticsearchDriverFactory: { id: 'elasticsearch', describe, isConfigured, create }
src/modules/fulltext_elasticsearch/index.ts   module metadata (id, title, version)
src/modules/fulltext_elasticsearch/di.ts      defineProcessDiRegistrar((c) => registerProcessActivation(c, activate), { legacy: register }) → registerFulltextDriverFactory(...)
src/__tests__/*.test.ts                        unit (mocked Client); integration gated on ELASTICSEARCH_URL
```

### Driver behaviour (parity table with `packages/search/src/fulltext/drivers/meilisearch/index.ts`)

| Method | Meilisearch today | Elasticsearch driver |
|---|---|---|
| `isHealthy()` | `false` when host unset; `client.health()` | `false` when `ELASTICSEARCH_URL` unset; `client.ping()` with request timeout; any error → `false` (never throws) |
| `ensureReady()` | no-op (lazy client) | no-op (lazy client) |
| index creation | `createIndex` + `updateSettings` once per index, concurrent-safe via `initializingIndexes` map | `indices.exists` → `indices.create({ mappings, settings })`; ignore `resource_already_exists_exception`; same memo + in-flight promise map |
| `index(doc)` | `addDocuments([doc], { primaryKey: '_id' })` | `client.index({ index, id: recordId, document, refresh })` |
| `bulkIndex(docs)` | group by tenant; one `addDocuments` per tenant | group by tenant; `client.bulk` calls of at most `ELASTICSEARCH_BULK_CHUNK_SIZE` documents (default 500) or ~5 MB serialised, whichever comes first, so a large queue batch never exceeds the cluster's `http.max_content_length` (100 MB default); if `response.errors`, throw an aggregated error naming the first failed id (fail-loud, queue retries) |
| `delete(recordId, tenantId)` | ignore `index_not_found` | `client.delete({ index, id, refresh })`; ignore 404 (`index_not_found_exception` / document missing) |
| `purge(entityId, tenantId, orgId?)` | `deleteDocuments({ filter })` | `deleteByQuery({ query: { bool: { filter: [term meta.entity_id, term meta.organization_id?] } }, conflicts: 'proceed', refresh: <boolean> })`; ignore 404. The response is validated: any entry in `failures[]` throws; `version_conflicts > 0` re-runs the delete (up to 3 passes) and throws if conflicts remain, so the scoped reindex in `search-indexer.ts` never proceeds on a partial purge. `_delete_by_query` accepts only boolean `refresh`, so `ELASTICSEARCH_REFRESH=wait_for` is translated to `true` here |
| `clearIndex(tenantId)` | `deleteAllDocuments()` | `deleteByQuery({ match_all })` with the same response validation and refresh translation as `purge`; ignore 404 |
| `recreateIndex(tenantId)` | `deleteIndex` + ensure | `indices.delete` (ignore 404) + ensure |
| `search(query, options)` | `index.search` with filter string, `showRankingScore` | `client.search({ index, size, from, query: bool{ should: [match(all_text, fuzziness AUTO), match_phrase_prefix(all_text, boost 2)], minimum_should_match 1, filter: [...] }, track_scores: true })`; `index_not_found_exception` → `[]`; score = `_score / max_score` (`0.5` when `max_score` is null) |
| organization filtering | `_organizationId = "x"` takes precedence over `organizationIds`; `IN [...]`; sentinel filter when the list is `[]` and no single id is set | Same precedence: a non-empty `organizationId` → `term meta.organization_id`, otherwise `organizationIds` → `terms`; an empty list with no single id → **return `[]` without a request** (the strategy already short-circuits that case). Documents with `organization_id: null` are excluded whenever an organization filter is present (parity) |
| `getDocuments(ids, tenantId)` | `getDocuments({ filter: _id IN [...] })` | `client.mget({ index, ids, _source: ['meta'] })`; map keyed `${entityId}:${recordId}`; errors → empty map (parity) |
| `listDocumentIds(entityId, tenantId, { offset, limit, organizationId })` | `getDocuments({ filter, fields: ['_id'], limit, offset })` | Uncapped enumeration behind the offset/limit signature: a point-in-time (`openPointInTime`, `keep_alive` 1m) + `search_after` walk sorted by `meta.record_id` with `_source: false`, `track_total_hits: false`. The driver keeps one sequential cursor per `(entityId, tenantId, organizationId)`: a call whose `offset` equals the previous `offset + limit` continues from the stored `search_after` values; any other offset restarts the walk from the beginning and skips forward. The PIT is closed when a page comes back short or the cursor is replaced. `FullTextSearchStrategy.listAllDocumentIds` pages sequentially, so reconciliation is O(n) with no `max_result_window` dependency; `index_not_found_exception` → `[]` |
| `getIndexStats(tenantId)` | `index.getStats()` | `indices.stats({ index })` → `numberOfDocuments = _all.primaries.docs.count`, `isIndexing: false`, `fieldDistribution: {}` (no cheap Elasticsearch equivalent; documented); 404 → `null` |
| `getEntityCounts(tenantId)` | facet `_entityId` | `terms` aggregation on `meta.entity_id` (`size: 1000`) with `size: 0`; 404 → `null` |

Document preparation reuses `extractSearchableFields` from `@open-mercato/search/lib/field-policy` and the exact `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` branch of the Meilisearch driver (presenter title/subtitle blanked, link labels replaced by `Open` / `View`) — ported, not re-implemented.

### Commands & Events
None added. The driver is consumed by `FullTextSearchStrategy`; indexing is still driven by `search.index_record` / `search.delete_record` through the `fulltext-indexing` queue and `fulltext-index.worker.ts`.

## Data Models

No database entities, no migrations.

**Elasticsearch document** (one per indexed record, `_id` = `recordId`):

```json
{
  "meta": {
    "record_id": "…", "entity_id": "customers:customer_person_profile",
    "organization_id": "… | null", "indexed_at": "2026-11-27T10:00:00.000Z",
    "presenter": { "...": "stored only" }, "url": "…", "links": [ { "...": "stored only" } ]
  },
  "all_text": ["Ada", "ada@example.com", "…"]
}
```

`all_text` is an explicit array of strings built from the output of `extractSearchableFields` (the same field-policy / encryption-map filtered map the Meilisearch driver spreads into its document): string values as-is, numbers and booleans stringified, dates as ISO strings, objects and arrays flattened to their string leaves. Field names are not indexed, so no two entities can ever produce a mapping conflict, no searchable field can collide with `meta`, and date-looking strings are never auto-typed. This mirrors Meilisearch's `searchableAttributes: ['*']` relevance model (every field weighted equally).

**Index mapping** (`${prefix}_${suffix}`, prefix default `om`). Tenant ids are UUIDs (`tenants.id`), so the suffix is the lower-cased UUID, which cannot collide. Any id that is not a UUID is replaced by the first 24 hex characters of its SHA-256 so case-folding and character stripping can never map two tenants to one index (unit test: `Tenant-A` vs `tenant-a` → distinct indices). Names follow the Elasticsearch index-name rules (lower-case, no `\\/*?"<>| ,#`, not starting with `-_+`). The mapping is **static** (`dynamic: false`): fields outside it are stored in `_source` but never mapped.

| Field | Type | Notes |
|---|---|---|
| `meta.record_id`, `meta.entity_id`, `meta.organization_id`, `meta.url` | `keyword` | filters, sort tiebreaker |
| `meta.indexed_at` | `date` | |
| `meta.presenter`, `meta.links` | `object`, `enabled: false` | stored in `_source`, never indexed |
| `all_text` | `text`, analyzer `standard` | the only searched field |

Settings: `number_of_shards: 1`, `number_of_replicas` from `ELASTICSEARCH_NUMBER_OF_REPLICAS` (default `1`). No dynamic templates, keyword sub-fields, field-count or result-window knobs.

## API Contracts

### `GET /api/search/settings/fulltext` (existing; additive change)
- `metadata`: `GET: { requireAuth: true, requireFeatures: ['search.view'] }` (unchanged)
- Response (new fields in bold; existing fields unchanged):

```ts
{
  driver: 'meilisearch' | null,            // @deprecated: 'meilisearch' only when Meilisearch is the active driver; use activeDriver
  configured: boolean,                     // @deprecated: unchanged computation (MEILISEARCH_HOST && MEILISEARCH_API_KEY); use drivers[].configured
  envVars: { MEILISEARCH_HOST, MEILISEARCH_API_KEY },                       // unchanged
  optionalEnvVars: { MEILISEARCH_INDEX_PREFIX, SEARCH_EXCLUDE_ENCRYPTED_FIELDS },  // unchanged
  **activeDriver**: { id: string, label: string, docsUrl: string | null } | null,
  **selection**: { source: 'env' | 'auto' | 'none', envVar: 'FULLTEXT_DRIVER' },
  **drivers**: Array<{
    id: string, label: string, docsUrl: string | null,
    configured: boolean, active: boolean,
    available: boolean | null,             // isAvailable() probe of the active driver only; null otherwise
    unavailableReason: string | null,
    envVars: Array<{ name: string, required: boolean, secret: boolean, set: boolean, hint: string /* translated via hintKey */, value?: string /* never for secret; url kind passes through sanitizeUrlForDisplay (per node) */, defaultValue?: string }>
  }>
}
```
- `openApi`: `fulltextSettingsResponseSchema` extended with the new fields; `driver` keeps `z.enum(['meilisearch']).nullable()` and `configured` keeps its computation, both with a deprecation note; description changed from "Returns Meilisearch configuration status" to driver-neutral wording.
- Consequence to document in `UPGRADE_NOTES.md`: the legacy pair keeps reflecting the Meilisearch variables only, regardless of which driver is active — with Elasticsearch active and Meilisearch unset it reads `driver: null, configured: false`; with both configured it reads `driver: 'meilisearch', configured: true`. Active-engine status is expressed exclusively through `activeDriver` / `selection` / `drivers[]`. `SearchSettingsPageClient` / `FulltextSearchSection` stop gating the status card on the legacy pair and use `activeDriver` + `drivers[].configured` instead (Phase 3 step 3).
- Values of variables flagged `secret` are never returned (only `set`), matching today's `MEILISEARCH_API_KEY` handling.

No other routes change. `POST /api/search/reindex` and `GET /api/search/settings` already go through `FullTextSearchStrategy` and need no edits.

## Internationalization (i18n)
- `search.settings.fulltext.driverLabel.meilisearch`, `.elasticsearch` (labels come from `describe()`; the UI translates by id with the descriptor label as fallback)
- `fulltext_elasticsearch.hints.url`, `.apiKey`, `.username`, `.password`, `.indexPrefix`, `.requestTimeoutMs`, `.tlsRejectUnauthorized` — shipped in `packages/fulltext-elasticsearch/src/modules/fulltext_elasticsearch/i18n/*.json` (module dictionaries merge flat), so core carries no Elasticsearch strings; the descriptor's `hintKey` points at them
- `search.settings.fulltext.selection.env`, `.auto`, `.none` ("Selected by FULLTEXT_DRIVER" / "Auto-detected" / "No driver configured")
- `search.settings.fulltext.learnMore` becomes driver-neutral ("Learn more: {label} setup"); `search.settings.fulltext.howToDescription` drops the Meilisearch mention
- CLI strings are console output and stay untranslated (existing convention in `cli.ts`)
- Core keys added to `packages/search/src/modules/search/i18n/{en,pl,…}.json`, driver keys to the provider package; `yarn i18n:check-sync` must pass for both

## UI/UX

Settings → Search → "Full-Text Search" section (`FulltextSearchSection.tsx`, existing `"use client"` island):
- Header card: "Current driver: {activeDriver.label}" + ready / not-configured status (as today), plus a one-line selection hint from `selection.source`.
- Environment variables: rendered from `drivers[].envVars` of the active driver (or, when none is active, every registered driver in collapsible groups, like the vector-store section), required and optional split by `required`. Rows keep the existing layout.
- Setup box: link to `activeDriver.docsUrl`.
- **Boy Scout:** the inline `<svg>` check/cross icons in the touched rows are replaced with `lucide-react` `Check` / `X` (`size-3`); `SearchSettingsPageClient.tsx` line 323's raw `fetch('/api/search/settings/fulltext')` is migrated to `apiCall`. No new client files, no new dialogs.

### Frontend Architecture Contract (delta)

| File | Reason for `"use client"` | Change |
|---|---|---|
| `FulltextSearchSection.tsx` | existing stateful section (reindex actions, confirm dialog) | render from `drivers[]`; icon swap; no new deps |
| `SearchSettingsPageClient.tsx` | existing page client (polls stats) | typed response widened; raw `fetch` → `apiCall` |

Budgets: 0 new `"use client"` files; no new heavy deps; the section stays under its current size. Evidence: `yarn check:client-boundaries` + the Playwright settings-page test below.

## Configuration

| Variable | Package | Default | Notes |
|---|---|---|---|
| `FULLTEXT_DRIVER` | search | unset (auto-detect) | `meilisearch` \| `elasticsearch` \| any registered id |
| `ELASTICSEARCH_URL` | fulltext-elasticsearch | — | required; comma-separated list allowed (client `nodes`) |
| `ELASTICSEARCH_API_KEY` | fulltext-elasticsearch | — | secret; preferred auth |
| `ELASTICSEARCH_USERNAME` / `ELASTICSEARCH_PASSWORD` | fulltext-elasticsearch | — | basic auth when no API key; password secret |
| `ELASTICSEARCH_INDEX_PREFIX` | fulltext-elasticsearch | `om` | |
| `ELASTICSEARCH_REQUEST_TIMEOUT_MS` | fulltext-elasticsearch | `30000` | via `resolveTimeoutMs` like Meilisearch |
| `ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED` | fulltext-elasticsearch | `true` | `false` only for self-signed dev clusters |
| `ELASTICSEARCH_REFRESH` | fulltext-elasticsearch | `false` | `wait_for` for tests/dev; never `true` in production |
| `ELASTICSEARCH_NUMBER_OF_REPLICAS` | fulltext-elasticsearch | `1` | `0` for single-node dev |
| `ELASTICSEARCH_BULK_CHUNK_SIZE` | fulltext-elasticsearch | `500` | documents per `bulk` request |

Documented in `apps/mercato/.env.example` and `packages/create-app/template/.env.example` (same task, `yarn template:sync:fix`), `apps/docs/docs/framework/database/hybrid-search.mdx` and `packages/search/AGENTS.md` env table.

## Migration & Compatibility

- No database migration. No data backfill: a new driver starts with empty indices; the operator runs the existing fulltext reindex (`POST /api/search/reindex` or Settings → Search) after switching. Switching drivers does not delete the previous engine's data.
- **FROZEN/STABLE surfaces untouched:** `SearchStrategyId`, `SearchStrategy`, `FullTextSearchDriver`, `FullTextSearchDriverId`, event IDs, queue names, DI keys, CLI command names and flags (`test-meilisearch` stays), feature IDs.
- **Additive:** registry exports, `FulltextDriverFactoryOptions.driver`, settings response fields, env variables, i18n keys, the new package and module id.
- **Deprecated, kept:** settings response fields `driver` and `configured` (`@deprecated` in the zod description; computation unchanged; bridge ≥ 1 minor; `UPGRADE_NOTES.md` entry documenting the `driver: null, configured: false` reading when a non-Meilisearch driver is active; removal follows the deprecation protocol in `BACKWARD_COMPATIBILITY.md`).
- Standalone apps on an older core keep the interim `addSearchStrategy` path (documented).

## Implementation Plan

### Phase 1 — Registry + selection in `@open-mercato/search` (PR 1)
1. Add `fulltext/drivers/registry.ts` with the contract above; `globalThis` storage under `Symbol.for('@open-mercato/search/fulltext-driver-registry')`.
2. Wrap the Meilisearch driver in `meilisearchDriverFactory` (`describe()` lists `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`, `MEILISEARCH_INDEX_PREFIX`, `MEILISEARCH_REQUEST_TIMEOUT_MS`) and register it at module load in `fulltext/drivers/index.ts`.
3. Rewrite `createFulltextDriver` to resolve through `resolveFulltextDriverSelection` + factory; keep `FulltextDriverFactoryOptions.meilisearch` overrides working; return the unavailable stand-in driver for an explicit but unknown/unconfigured selection.
4. Export the registry from `fulltext/index.ts` and `src/index.ts`.
5. Unit tests: registry (register / idempotent re-register / unregister / list order / survives a second module instance via `globalThis`); `createFulltextDriver` selection matrix (five rows of the Selection table, including the `di-singletons.test.ts`-style assertion that the existing memoisation and the `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` no-memo branch are unchanged).
6. Order tests: a fake factory registered the way a module `di.ts` does, then `registerSearchModule` on a container → the strategy uses it (legacy path: module registrars run before core `bootstrap()` in `buildLegacyRequestContainer`); `registerScopedSearchModule` on a root, registration afterwards, first scoped resolve → the strategy uses it (process-root path: activations run before any scope resolves). Real-bootstrap evidence comes from the Phase 3 integration test that boots the app with the module enabled.
7. Env + docs: `FULLTEXT_DRIVER` in both `.env.example` files, `hybrid-search.mdx` "Selecting a fulltext driver" + "Adding a fulltext driver" subsections, `packages/search/AGENTS.md` env table and structure block.
8. `UPGRADE_NOTES.md`: additive note (`FULLTEXT_DRIVER`, `driver` field deprecation).

### Phase 2 — `@open-mercato/fulltext-elasticsearch` (PR 3; ships after Phase 3 so Settings → Search is already driver-neutral when the module can be enabled)
1. Scaffold the package from `packages/web-research-exa` (`package.json`, `build.mjs`, `watch.mjs`, `tsconfig.json`, `jest.config.cjs`); add `@elastic/elasticsearch`.
2. `driver/client.ts`: lazy `Client` from env/options (nodes, auth, `requestTimeout`, `tls.rejectUnauthorized`); client `redaction` option enabled so `ResponseError.meta` never carries `Authorization` or `user:pass@` URLs; thrown errors are re-wrapped with the URL's userinfo stripped; never logs credentials.
3. `driver/index-name.ts`: name builder + mapping/settings constants + `ensureIndex` with the in-flight map.
4. `driver/documents.ts`: `prepareDocument` (port of the Meilisearch branch incl. `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` sanitisation; `all_text` flattening) and `hitToResult` with score normalisation.
5. `driver/queries.ts`: `buildFilters` (organization / organizationIds / entityTypes parity, early `[]` on empty `organizationIds`), `buildSearchQuery` (fuzzy + phrase-prefix on `all_text`).
6. `driver/index.ts`: the twelve methods per the parity table.
7. `factory.ts` + module `fulltext_elasticsearch/{index.ts,di.ts}` (`defineProcessDiRegistrar` with `registerProcessActivation`, legacy `register` for request containers; no import-time side effects).
8. Unit tests with a mocked `Client` (see Testing Strategy); integration test skipped unless `ELASTICSEARCH_URL` is set, using `ELASTICSEARCH_REFRESH=wait_for` and a unique prefix per run, cleaning its indices in `finally`; API integration test asserting `GET /api/search/settings/fulltext` lists `elasticsearch` in `drivers[]` once the module is enabled (coverage for the surface this phase changes).
9. Wire `apps/mercato/package.json` + `src/modules.ts` and the create-app template equivalents (`yarn template:sync:fix`); `yarn generate`.
10. Docs: Elasticsearch section in `hybrid-search.mdx` (setup, variables, index layout, reindex after switch, known limits), package `README.md`, `.env.example` entries, `.ai/specs/README.md` row (already added with this spec).

### Phase 3 — Driver-neutral operator surfaces (PR 2; depends on Phase 1 only)
1. `api/settings/fulltext/route.ts`: build `activeDriver`, `selection`, `drivers[]` from the registry; probe `available` through `searchStrategies` on a request container (pattern: vector-store route); keep legacy fields.
2. `api/openapi.ts`: extend `fulltextSettingsResponseSchema`; neutral descriptions; mark `driver` deprecated.
3. `FulltextSearchSection.tsx` + `SearchSettingsPageClient.tsx`: render from `drivers[]`; Boy Scout fixes above.
4. `cli.ts`: `status` prints `FULLTEXT_DRIVER` and the active driver's env vars (secret → `(set)`/`(not set)`; `kind: 'url'` values pass through `sanitizeUrlForDisplay`); the `query` command's `--strategy` help text becomes `fulltext,vector,tokens` (one-line fix on a touched file).
7. `packages/search/src/lib/url-redaction.ts`: `sanitizeUrlForDisplay(value)` strips userinfo from every entry of a comma-separated URL list and is the single redaction path for the settings API, CLI status and the Elasticsearch driver's error wrapping; unit tests with credential-bearing single and multi-node values.
5. i18n keys in all locale files; `yarn i18n:check-sync`, `yarn i18n:check-usage`.
6. Integration tests: API test for `GET /api/search/settings/fulltext` asserting legacy fields are byte-compatible and new fields present; Playwright test that Settings → Search shows the active driver label and the missing-variable state.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/search/src/fulltext/drivers/registry.ts` | Create | Factory registry + `resolveFulltextDriverId` |
| `packages/search/src/fulltext/drivers/index.ts` | Modify | defines + registers `meilisearchDriverFactory` (wrapping the unchanged `createMeilisearchDriver`); `createFulltextDriver` via registry |
| `packages/search/src/fulltext/index.ts`, `packages/search/src/index.ts` | Modify | Additive exports |
| `packages/search/src/__tests__/fulltext-driver-registry.test.ts`, `fulltext-driver-selection.test.ts`, `fulltext-driver-registration-order.test.ts` | Create | Phase 1 tests |
| `packages/fulltext-elasticsearch/**` | Create | Provider package, module, tests, README |
| `packages/search/src/modules/search/api/settings/fulltext/route.ts`, `api/openapi.ts` | Modify | Driver-neutral response (additive) |
| `packages/search/src/modules/search/frontend/components/sections/FulltextSearchSection.tsx`, `SearchSettingsPageClient.tsx` | Modify | Render from descriptors; Boy Scout fixes |
| `packages/search/src/modules/search/cli.ts` | Modify | `status` output; `--strategy` help |
| `packages/search/src/lib/url-redaction.ts` | Create | Shared per-node URL userinfo stripping (settings API, CLI, driver errors) |
| `packages/search/src/modules/search/i18n/*.json` | Modify | Keys above |
| `apps/mercato/package.json`, `apps/mercato/src/modules.ts`, `packages/create-app/template/package.json.template`, `packages/create-app/template/src/modules.ts` | Modify | Depend on + enable the module |
| `apps/mercato/.env.example`, `packages/create-app/template/.env.example` | Modify | `FULLTEXT_DRIVER`, `ELASTICSEARCH_*` |
| `apps/docs/docs/framework/database/hybrid-search.mdx` | Modify | Selection, Elasticsearch section, adding a driver |
| `packages/search/AGENTS.md` | Modify | Env table, structure, "adding a fulltext driver" |
| `UPGRADE_NOTES.md` | Modify | Additive note + `driver` deprecation |
| `.ai/specs/README.md` | Modify | Index row |

### Testing Strategy
- **Unit (search):** registry semantics; selection matrix; memoisation unchanged; order test.
- **Unit (package, mocked `@elastic/elasticsearch` `Client`):** index-name sanitisation (upper-case tenant ids, forbidden characters); `ensureIndex` once per index under concurrency and after `recreateIndex`; `buildFilters` for `organizationId`, `organizationIds`, `[]` short-circuit, `entityTypes`; `prepareDocument` parity incl. the `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` branch and the reserved-name guard; score normalisation incl. `max_score: null`; `bulkIndex` groups by tenant and throws on `errors: true`; `delete` / `purge` / `clearIndex` / `listDocumentIds` / `getIndexStats` / `getEntityCounts` 404 handling; `isHealthy` false when unconfigured or ping throws; module `di.ts` registers id `elasticsearch`; credentials never appear in thrown error messages.
- **Integration (opt-in, `ELASTICSEARCH_URL`):** driver level — index two tenants, search with a typo and a prefix, verify tenant and organization isolation, `purge` by organization with the response validation path, `getEntityCounts`, `listDocumentIds` paging across more than one PIT page, `recreateIndex`; application level — boot the app with the module enabled, `POST /api/search/reindex`, drain the `fulltext-indexing` queue, then `GET /api/search/search` as a user with and without the entity's `aclFeatures` (hits only for the former), and the encryption-policy failure case (`SEARCH_EXCLUDE_ENCRYPTED_FIELDS=on` with the custom-field definitions unavailable → indexing refused, nothing reaches the cluster). This run is required evidence before the provider-package PR leaves draft.
- **Integration coverage required by `.ai/qa/AGENTS.md`:** Phase 3 — API `GET /api/search/settings/fulltext` (legacy fields byte-compatible, new fields present, 401 without auth) and UI Settings → Search fulltext section (active driver label, missing-variable rows). Phase 2 — API test that `drivers[]` includes `elasticsearch` with its env descriptors when the module is enabled. Phase 1 — none (no behaviour change; unit tests only). Fixtures are env-only; no seeded data needed.
- **Gates:** `yarn generate && yarn typecheck && yarn lint && yarn test && yarn build:packages`, `yarn i18n:check-sync`, `yarn template:sync`, `yarn check:client-boundaries`.

## Risks & Impact Review

### Data Integrity Failures
- A crash mid-`bulkIndex` leaves some documents indexed and others not; the queue job fails loudly and is retried, and indexing is idempotent (`_id` = record id, full document replace). No partial document state is possible.
- Concurrent `index` + `delete` for one record resolve by Elasticsearch version ordering per `_id`; the later write wins, same as Meilisearch task ordering.
- Deleted source records in flight: `delete` on a missing document is a no-op (404 ignored).

### Cascading Failures & Side Effects
- Consumers: `SearchService` (merge), `SearchIndexer`, the reindex API, Settings → Search. A down cluster makes `isHealthy()` false → `FullTextSearchStrategy.isAvailable()` false → `SearchService` falls back to `tokens`; the fulltext queue keeps jobs for retry. No events are emitted by the driver.
- No new cross-module dependency: the package depends on `@open-mercato/search` and `@open-mercato/shared` only.

### Tenant & Data Isolation Risks
- Boundary: index per tenant; organization filter as a `term`/`terms` filter inside `bool.filter`; `organizationIds: []` returns `[]` before any request. The registry and the client are process-global but hold no tenant data; the per-request `encryptionMapResolver` path is never memoised (unchanged logic in `di.ts`).
- Noisy neighbour: one index per tenant bounds mapping growth and deep-page cost per tenant; `total_fields.limit` guards runaway mappings.

### Migration & Deployment Risks
- Deploying the code is zero-downtime: additive, no schema change. **Switching the active driver is not**: the new engine starts empty, so fulltext search is unavailable (searches fall back to tokens, `isAvailable()` stays true but returns no fulltext hits) from the restart until the reindex completes; the existing full reindex also recreates the tenant index. Operators should run the reindex immediately after the switch, ideally off-peak; a pre-populate-then-cut-over procedure is out of scope for v1 and documented as such.
- No backfill; reindex uses the existing queue-based path and its progress UI.

### Operational Risks
- Detection: Settings → Search shows `available: false` + `unavailableReason`; `search status` prints the driver and variables; `reportSearchError` codes `search.fulltext_driver_unknown`, `search.fulltext_driver_unconfigured`.
- Blast radius: fulltext strategy only; tokens and vector unaffected.
- Storage: one index per tenant, `_source` stored; comparable to Meilisearch.

### Risk Register

#### Cross-tenant or cross-organization leak through a filter bug
- **Scenario**: an organization filter is dropped or mis-built and a user sees another organization's hits.
- **Severity**: Critical
- **Affected area**: global search, Cmd+K
- **Mitigation**: index per tenant (hard boundary); filters built in one function with unit tests for every `FullTextSearchQuery` shape; integration test asserting isolation; parity with the Meilisearch semantics that SPEC-041 already covers.
- **Residual risk**: organization filter semantics for `organization_id: null` documents follow the Meilisearch driver exactly; if the 2026-08-28 spec later changes them, both drivers change together.

#### Encrypted or sensitive values reach the cluster
- **Scenario**: `SEARCH_EXCLUDE_ENCRYPTED_FIELDS=true` but a presenter title or link label derived from an encrypted field is indexed.
- **Severity**: High
- **Affected area**: compliance
- **Mitigation**: `prepareDocument` is a port of the Meilisearch branch with the same unit tests (`index-doc-filter`, `plaintext-custom-field-boundaries` patterns); `meta.presenter`/`meta.links` are `enabled: false` so even stored values are never tokenised; the driver is never memoised when the resolver is per-request.
- **Residual risk**: operators who leave the flag off index decrypted values by design, as with Meilisearch today.

#### Mapping conflicts between entities
- **Scenario**: two entities map the same field name to different types, or a searchable field name collides with `meta`, causing `mapper_parsing_exception` on index.
- **Severity**: Medium
- **Affected area**: indexing of the affected entity
- **Mitigation**: field names are never mapped — searchable values go into the explicit `all_text` string array and the mapping is `dynamic: false`; only `meta.*` carries typed fields and it is written by the driver alone.
- **Residual risk**: none; per-field boosting is future work.

#### Score normalisation skews the merge
- **Scenario**: a single-hit response has `max_score == _score`, so every lone hit scores 1.0 and outranks vector/token results.
- **Severity**: Low
- **Affected area**: result ordering in hybrid mode
- **Mitigation**: `ResultMerger` weights are unchanged; the normalisation is documented as relative (Meilisearch's `_rankingScore` is absolute per hit, so this is a deliberate difference, not parity); min-max over the page or a BM25 saturation function is a tuning knob for a later spec.
- **Residual risk**: accepted for MVP.

#### Point-in-time cursors for `listDocumentIds`
- **Scenario**: a reconciliation walk is interrupted and its PIT stays open until `keep_alive` expires, or two walks over the same scope interleave and one restarts the other's cursor.
- **Severity**: Low
- **Affected area**: cluster resources (open PITs), reconciliation correctness
- **Mitigation**: `keep_alive` of 1 minute refreshed per page; cursors are per process and per scope and replaced, never shared; a restarted walk skips forward deterministically on the `meta.record_id` sort, so results stay complete, only slower.
- **Residual risk**: interleaved walks over one scope from one process are slower than necessary; accepted.

#### Near-real-time visibility
- **Scenario**: a record is indexed and searched within the refresh interval (1 s) and is not found.
- **Severity**: Low
- **Affected area**: tests, immediate post-save searches
- **Mitigation**: `ELASTICSEARCH_REFRESH=wait_for` for tests/dev; production accepts the 1 s delay (Meilisearch is also asynchronous).
- **Residual risk**: accepted.

#### Client / cluster major version mismatch
- **Scenario**: the 9.x client talks to an 8.x cluster and some requests fail.
- **Severity**: Medium
- **Affected area**: availability
- **Mitigation**: docs state the supported cluster line (9.x) and the compatibility header behaviour; `isHealthy()` surfaces failures; the client is a package dependency, so a pinned 8.x package line can be published if demand appears.
- **Residual risk**: 8.x clusters unsupported in v1.

#### Cluster unavailable or slow
- **Scenario**: the cluster is down or a request stalls.
- **Severity**: Medium
- **Affected area**: search latency, indexing queue
- **Mitigation**: request timeout (30 s default, env-tunable); `isHealthy()` → degrade to tokens; queue retries.
- **Residual risk**: a half-degraded cluster (ping OK, searches slow) is bounded by the timeout only.

## Final Compliance Report — 2026-11-27

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/search/AGENTS.md`
- `packages/core/AGENTS.md` (API routes, encryption references)
- `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md` (apiCall, DS rules via `.ai/ds-rules.md`)
- `packages/create-app/AGENTS.md` (template sync)
- `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Every external integration provider lives in its own workspace package | Compliant | `packages/fulltext-elasticsearch` |
| root AGENTS.md | Ask before adding production dependencies | Compliant | `@elastic/elasticsearch` confined to the provider package; raised in #10986 |
| root AGENTS.md | Never expose cross-tenant data | Compliant | index per tenant + organization filters; Risk register |
| root AGENTS.md | Never edit generated files; run `yarn generate` after module changes | Compliant | Phase 2 step 9 |
| root AGENTS.md | `.env.example` / template mirror (Template Sync Checklist) | Compliant | both files + `modules.ts` + `package.json.template` in the same PR |
| root AGENTS.md | No hard-coded user-facing strings | Compliant | i18n section; CLI console output follows the existing convention |
| root AGENTS.md (DS) | No inline `<svg>` in page-body UI; semantic status tokens; Boy Scout | Compliant | lucide `Check`/`X`; existing tokens kept |
| packages/ui/src/backend/AGENTS.md | All HTTP through `apiCall` | Compliant | raw `fetch` in `SearchSettingsPageClient.tsx` migrated |
| packages/core/AGENTS.md → API Routes | Route files export per-method `metadata` and `openApi` | Compliant | existing route; schema extended |
| packages/search/AGENTS.md | Ask before changing strategy defaults / driver assumptions | Compliant | defaults unchanged; asked in #10986 |
| packages/search/AGENTS.md | A driver that cannot serve its backend MUST report unhealthy rather than throw per record | Compliant | `isHealthy()` contract in the parity table |
| packages/search/AGENTS.md | Never include encrypted fields in indexed text | Compliant | `prepareDocument` port; `meta.presenter` not indexed |
| packages/core/AGENTS.md → Encryption | Sensitive columns declared in `encryption.ts` | N/A | no new entities or columns |
| packages/core/AGENTS.md → Commands/Undo | Mutations as commands with undo | N/A | no tenant-data mutations; index writes are the existing indexer's side effects |
| packages/cache/AGENTS.md | Cache via DI, tenant tags | N/A | no caching added; registry holds no tenant data |
| packages/events/AGENTS.md | Cross-module side effects via events | Compliant | no new events; existing `search.*` events unchanged |
| BACKWARD_COMPATIBILITY.md | Contract surfaces additive; deprecation protocol | Compliant | `driver` field kept + deprecated; everything else additive |
| .ai/qa/AGENTS.md | Integration coverage for affected API + UI paths ships in the same change | Compliant | Testing Strategy; Phase 3 step 6 |
| .ai/specs/AGENTS.md | Naming, required sections, README index row | Compliant | — |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | document/mapping vs driver methods; settings response vs descriptor |
| API contracts match UI/UX section | Pass | UI renders `activeDriver`, `selection`, `drivers[]` |
| Risks cover all write operations | Pass | index/bulk/delete/purge/clear/recreate |
| Commands defined for all mutations | N/A | no command-layer mutations |
| Cache strategy covers all read APIs | N/A | settings route is uncached today; unchanged |
| Phases independently deliverable | Pass (pending Q7) | PR order 1 → 3 → 2: Phase 1 alone changes no behaviour; Phase 3 depends on 1; Phase 2 depends on 1 and is shipped after 3 |

### Non-Compliant Items
None.

### Verdict
- **Fully compliant** on the rule matrix; **implementation gated** on Q7 (scope split) and on the maintainer answers requested in #10986 (engine target, registration mechanism, settings API extension, test infrastructure). The spec records the recommended answer for each; a different answer changes the Design Decisions table and the PR split, not the driver design.

## Changelog
### 2026-11-27
- Initial specification: registry + env selection in `@open-mercato/search`, `@open-mercato/fulltext-elasticsearch` provider package, driver-neutral operator surfaces. Skeleton questions Q1–Q6 resolved on the recommended options (Elasticsearch 9.x only; process-level registry; additive settings API; index per tenant; mocked unit tests + opt-in integration test).
- Codex review (13 findings, triaged on PR #10987): explicit invalid `FULLTEXT_DRIVER` now registers an unhealthy stand-in so queued jobs retry instead of being dropped; registration moves to the DI lifecycle (`registerProcessActivation` + legacy `register`, no import-time side effects); `_delete_by_query` responses validated with bounded conflict retries and boolean refresh translation; document model switched to an explicit `all_text` array with a static `dynamic: false` mapping (field-count and result-window knobs cut); `listDocumentIds` walks a point-in-time with `search_after` behind the offset contract; shared per-node URL redaction for API, CLI and errors; legacy settings pair stated as Meilisearch-only; selection immutable per process generation with status read from the live strategy; `organizationId` precedence parity; driver switch documented as fulltext-unavailable until reindex; application-path and encryption-failure integration coverage added.
- Fresh-context checklist review (§ 1 scope cohesion run by a separate agent): SPLIT verdict recorded as Q7; corrections applied — `query` (not `reindex`) `--strategy` help, legacy `configured`/`driver` computations kept verbatim and deprecated, unconfigured selected driver yields no strategy (today's behaviour), index-suffix collision rule, `algolia` factory key retained, bulk chunking, URL userinfo stripping + client redaction, `hintKey`/`hint` split, provider-package i18n, PR order 1 → 3 → 2 with per-phase integration coverage, relative score normalisation stated as a deliberate difference.
