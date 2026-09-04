# Search Architecture — Clarification and Future Evolution

- **Status:** Draft (pending review)
- **Scope:** OSS
- **Author:** agentic (research + spec)
- **Date:** 2026-07-24
- **Related:**
  - `.ai/specs/2026-06-15-tenant-scoped-search-settings.md` (scopes search **settings**)
  - `.ai/specs/implemented/SPEC-041-2026-02-24-search-organization-scoping.md` (scopes search **results**)
  - `.ai/specs/2026-05-20-search-presenter-i18n.md`
  - Docs: `apps/docs/docs/framework/database/hybrid-search.mdx`, `.../query-index.mdx`, `.../vector-search.mdx`
  - Code: `packages/search/**`, `packages/core/src/modules/query_index/**`, `packages/shared/src/{modules/search.ts,lib/search/**,lib/query/engine.ts}`
  - PRs: #4723 (gates the `search_tokens` probe on the hybrid-engine paths), #4685 (`search_tokens` unbounded growth), #4558 (ground-truth docs for hybrid routing)

## TLDR

Open Mercato's search is repeatedly misunderstood — even prior agent sessions got core facts wrong — because the public documentation frames it as three interchangeable query-time "strategies," which hides the reality: there are **three physically independent stores** (`search_tokens` in Postgres, a Meilisearch fulltext index, and a vector store) fed by **separate population pipelines**, and **no single reindex command rebuilds all of them**. The worst trap is that the CLI command literally named `yarn mercato search reindex` **does not populate Meilisearch** — it rebuilds `search_tokens` + the `entity_indexes` projection and emits vector events only. The public docs page still calls the fulltext strategy `MeilisearchStrategy` (a name that exists in **zero** source files; the code renamed it to `FullTextSearchStrategy` with a pluggable driver over a year of drift), uses `knex` in a DI example the code writes with Kysely, and omits five of the six `OM_SEARCH_*` tuning knobs.

This spec does two things:

1. **Clarification (Part A + Phase 0)** — pins down the *accurate* current architecture as ground truth (verified against code, not transcripts) and specifies the concrete, behavior-preserving documentation / CLI-help / env-table fixes that remove the specific traps.
2. **Evolution (Part B)** — lays out a staged roadmap for where search can go: unifying the **control plane** (one reindex/status surface over the three stores), adding **more pluggable backends** (fulltext + vector drivers), and an honest analysis of **consolidating to fewer stores** — with a recommendation to keep the multi-store data plane and instead invest in a unified control plane and truthful interfaces.

Part A is documentation-only (no runtime behavior change). Part B is a menu of options with tradeoffs; only Phase 0 is proposed for immediate implementation, the rest are gated on maintainer decision.

---

## Part A — Current Architecture (Ground Truth)

> Everything in this section was verified against source in this repo on 2026-07-24. Where the shipped docs disagree, **the code is authoritative** and the doc is listed in the "Confusion Inventory."

### A.1 Three stores, not three strategies

The mental model that causes bugs is "there are three strategies you can swap at query time." The load-bearing reality is that there are **three independent physical stores**, each with its **own owner, writer, and lifecycle**:

| Store | Physical backend | Owned by | Written by | Read by (strategy) |
|---|---|---|---|---|
| **`search_tokens`** | Postgres table (`search_tokens`) | **query_index** module (`packages/core/src/modules/query_index`) | The tokenizer during projection — `buildSearchTokenRows` / `replaceSearchTokensForRecord` / `replaceSearchTokensForBatch` (`query_index/lib/search-tokens.ts`) | `TokenSearchStrategy` (`packages/search/src/strategies/token.strategy.ts`), **and directly by list-API routes** |
| **Fulltext** | Meilisearch (external service) | **@open-mercato/search** | The fulltext driver behind `FullTextSearchStrategy`, driven by the `fulltext-indexing` queue/worker | `FullTextSearchStrategy` (`packages/search/src/strategies/fulltext.strategy.ts`) |
| **Vector** | pgvector / qdrant / chromadb (pluggable `VectorDriver`) | **@open-mercato/search** + query_index (emits vectorize events) | `VectorSearchStrategy.index` via the `vector-indexing` queue; embeddings from an `EmbeddingService` | `VectorSearchStrategy` (`packages/search/src/strategies/vector.strategy.ts`) |

The strategy layer (`SearchStrategyId = 'tokens' | 'vector' | 'fulltext'`, `packages/shared/src/modules/search.ts:13`) is the **query-time read interface** over these stores. `SearchService.search()` (`packages/search/src/service.ts:114`) runs the selected strategies in parallel (`Promise.allSettled`), merges with weighted Reciprocal Rank Fusion (`mergeAndRankResults`, weights `{ fulltext: 1.2, vector: 1.0, tokens: 0.8 }`), scopes by org, and enriches presenters. A strategy that fails or is unavailable is skipped, not fatal; if nothing is available it falls back to `tokens`.

**Critical invariant:** these three stores are populated by **different, independent pipelines**. Rebuilding one does **not** rebuild the others.

### A.2 Population pipelines

There are two axes: **incremental** (on every record write) and **bulk / reindex** (operator-triggered). They diverge by store.

**Incremental (on record write)** — emitter `query_index/subscribers/upsert_one.ts` (event `query_index.upsert_one`):
1. Synchronously updates the `entity_indexes` projection row (read-your-writes for list endpoints), deferring token work.
2. Deferred, fire-and-forget:
   - `reindexSearchTokensForRecord` → rebuilds **`search_tokens`** for that record.
   - emits `query_index.vectorize_one` → **vector** store.
   - emits `search.index_record` → picked up by `fulltext_upsert.ts` → enqueues onto `fulltext-indexing` → worker `indexRecordById` → `searchService.index` → fulltext driver → **Meilisearch** `addDocuments`.

   (Delete mirrors this: `delete_one.ts` emits `search.delete_record` → worker deletes from Meili; tokens/vector removed alongside.)

**Bulk / reindex** — three *different* entry points, each covering a *different* subset of stores:

| Entry point | Rebuilds | Populates Meilisearch? | Code |
|---|---|---|---|
| **CLI** `yarn mercato search reindex` | `entity_indexes` projection + **`search_tokens`** + emits **vector** events | **NO** | `packages/search/src/modules/search/cli.ts` → `reindexEntity({ emitVectorizeEvents: true })` |
| **Core API** `POST /api/query_index/reindex` (feature `query_index.reindex`) | Emits `query_index.reindex` persistent events → same `reindexEntity` path (projection + tokens + vector) | **NO** | `query_index/api/reindex.ts` |
| **Search API** `POST /api/search/reindex` (feature `search.reindex`) | Recreates the **Meilisearch** index and re-indexes all records into it (via `batch-index` jobs or direct `bulkIndex`) | **YES — this is the only fulltext bulk path** | `search/api/reindex/route.ts` → `searchIndexer.reindexEntityToFulltext` / `reindexAllToFulltext` |
| **Vector API** `POST /api/search/embeddings/reindex` (feature `search.manage`) | Vector store only | NO | `search/api/embeddings/**` |

Prerequisites for the fulltext path to actually drain: `QUEUE_STRATEGY=async` + a running `yarn mercato search worker fulltext-indexing` (in `local` mode jobs process from `.mercato/queue/`).

### A.3 Division of labor (who consumes which store)

- **Global search / Cmd+K palette** — `GET /api/search/global` uses the tenant's saved strategy set (default `['fulltext','vector','tokens']`; ignores URL `strategies`). `GET /api/search` accepts a `strategies` override. Fulltext (Meili) is the intended fuzzy/typo-tolerant backend; tokens participate as an always-available fallback.
- **AI assistant** — `search.hybrid_search` / `search.get_record_context` tools resolve the same `SearchService`.
- **DataTable list / column filters** — do **not** go through `SearchService`. List routes for customers, auth users, customer accounts, messages, checkout transactions, and inbox proposals query **`search_tokens` directly** (hash-token lookup) because searchable PII columns are **encrypted at rest**, so `ILIKE` on ciphertext can't match plaintext. The shared `findEntityIdsBySearchTokens` helper applies field and tenant/organization scope consistently. This is why tokens must always exist even when Meili is configured. With `OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS=true` (**the default since #5803**) the query engines route only *encrypted* base columns through tokens; plaintext base columns run exact SQL ILIKE — token matching is approximate (prefix-based, word-order independent, fragments under `OM_SEARCH_MIN_LEN` vanish), which over-matched short document numbers badly enough to return the *wrong* record (`?search=2026-08` answering with the `2026-01` row). Setting the var to `false` restores the legacy rewrite for every column.
- **Non-canonical creation events** — modules whose lifecycle event does not use the canonical `<module>.<entity>.created` entity name must add an explicit subscriber that emits `query_index.upsert_one`. Checkout transactions (`checkout.transaction.created`) and inbox proposals (`inbox_ops.proposal.created`) use this bridge so direct token lookups stay current.
- **Exact-match on encrypted PII** (`fieldPolicy.hashOnly`: email, phone, tax_id) — served by token-hash presence (list routes require **all** query tokens to match; `TokenSearchStrategy` uses a 50% `minMatchRatio`), plus a dedicated `emailHash` column for email exact lookups.

### A.4 Configuration surface

Six env vars (`packages/shared/src/lib/search/config.ts`) are **token/Postgres-only** — none affect fulltext or vector:

| Env var | Default | Controls |
|---|---|---|
| `OM_SEARCH_ENABLED` | `true` | Master kill-switch for token building + `TokenSearchStrategy`. |
| `OM_SEARCH_MIN_LEN` | `3` | Minimum token length; floor of prefix expansion. |
| `OM_SEARCH_ENABLE_PARTIAL` | `true` | Prefix/partial expansion in `expandToken`. **Drives `search_tokens` size** (indexing "john" stores hashes for `joh`,`john`; ~5–6× row blow-up). Meili is unaffected. |
| `OM_SEARCH_HASH_ALGO` | `sha256` | Token hash algorithm (`sha1`/`md5` accepted). |
| `OM_SEARCH_STORE_RAW_TOKENS` | `false` | Stores plaintext token alongside the hash — **security-sensitive** (plaintext of otherwise-hashed values). |
| `OM_SEARCH_FIELD_BLOCKLIST` | `[]` (+ built-in `password,token,secret,hash`) | Extra field names excluded from tokenization. |

Fulltext/vector are configured by a **disjoint** set: `MEILISEARCH_HOST` / `MEILISEARCH_API_KEY` / `MEILISEARCH_INDEX_PREFIX`, `SEARCH_EXCLUDE_ENCRYPTED_FIELDS`, embedding-provider vars (`OPENAI_API_KEY`, Ollama), and `QUEUE_STRATEGY` / `REDIS_URL`. (`OM_SEARCH_DEBUG` is read in query_index, not `config.ts`.)

### A.5 Pluggability today

- **Fulltext driver**: `FullTextSearchStrategy` wraps a single `FullTextSearchDriver`. `createFulltextDriver()` currently builds **only** a Meilisearch driver (Algolia/Elasticsearch/Typesense are commented-out TODOs). No Postgres fulltext driver exists — Postgres backs *tokens*, not *fulltext*.
- **Vector driver**: `VectorSearchStrategy` wraps a pluggable `VectorDriver` — `pgvector`, `chromadb`, `qdrant` implemented.
- **Custom strategies**: third parties can `addSearchStrategy(container, strategy)` at runtime; `SearchStrategyId` has a string escape hatch.

### A.6 Confusion Inventory (what to fix, and where)

| # | Fact | Current doc status | Fix (Phase 0) |
|---|---|---|---|
| 1 | Three independent stores; no single reindex rebuilds all | Not documented; docs imply coordinated strategies | New "Three stores, three pipelines" section in `hybrid-search.mdx` |
| 2 | `yarn mercato search reindex` rebuilds tokens + projection + fires vector events but **skips Meili** | Only a misleading help string ("Reindex vector embeddings for entities"); the trap is undocumented | Fix CLI `help` + `reindex-help`; document in `hybrid-search.mdx` |
| 3 | Meili is populated via `POST /api/search/reindex` + incremental `search.index_record` → `fulltext-indexing` worker | Endpoint documented; incremental chain only in code | New "Reindexing & keeping indexes fresh" section |
| 4 | `OM_SEARCH_ENABLE_PARTIAL` (Postgres-only prefix expansion; index-size blow-up) + the other four `OM_SEARCH_*` | Two listed in one env example, never explained; five missing from package docs | Add + explain in `hybrid-search.mdx`, `search/AGENTS.md`, `search/README.md` |
| 5 | Division of labor: Meili → Cmd+K/AI; tokens → DataTable filters + encrypted-PII exact match | Not documented | New "Division of labor" subsection |
| 6 | Fulltext strategy is `FullTextSearchStrategy` (id `fulltext`, pluggable driver); `MeilisearchStrategy` exists in no source file | **Stale** — `hybrid-search.mdx` uses `MeilisearchStrategy`, `skipMeilisearch`, `meilisearch` weight key, and `knex` throughout | Rewrite `hybrid-search.mdx` DI/example/weights; fix stale `meilisearch` comment in `shared/src/modules/search.ts:179` |

---

## Part B — Future Evolution

Three broad directions were raised: **(1)** several search backends, **(2)** combining search backends into one, **(3)** keeping the architecture but improving the CLI/admin/API interfaces (reindexing). They are not mutually exclusive. The analysis below argues the highest-leverage work is **(3) unify the control plane + truthful interfaces first**, then **(1) widen backend pluggability**, and treats **(2) consolidation** as a mostly-rejected direction with narrow exceptions.

### B.0 Phase 0 — Truthful interfaces & docs (proposed now, low risk)

Behavior-preserving. This is the "clear out confusion" deliverable and the prerequisite for everything else — you cannot safely evolve a system operators misunderstand.

1. **Rewrite `apps/docs/docs/framework/database/hybrid-search.mdx`** — fix stale naming (`MeilisearchStrategy` → `FullTextSearchStrategy` / id `fulltext`, `skipMeilisearch` → `skipFulltext`, weight key `meilisearch` → `fulltext`, `knex`/`Knex` → Kysely via `em.getKysely()`); add the three sections from A.6; document all six `OM_SEARCH_*` vars.
2. **Fix CLI help** in `packages/search/src/modules/search/cli.ts` — the `help` line and `reindex-help` block must state that `search reindex` rebuilds `search_tokens` + `entity_indexes` and enqueues **vector** embeddings, and does **not** populate the fulltext/Meilisearch index (use `POST /api/search/reindex` for that). String-only change.
3. **Add missing env rows** to `packages/search/AGENTS.md` and `packages/search/src/modules/search/README.md` (the five undocumented `OM_SEARCH_*` vars).
4. **Boy-Scout** the stale `strategyWeights` example comment in `packages/shared/src/modules/search.ts:179` (`meilisearch` → `fulltext`).

Acceptance: docs build passes; `yarn mercato search help` / `reindex-help` mention the fulltext endpoint; a new engineer can read `hybrid-search.mdx` and correctly predict which command populates which store.

### B.1 Phase 1 — Unified control plane (recommended next)

**Problem:** the *data plane* is legitimately three stores, but the *control plane* leaks that split onto operators as three reindex entry points with divergent coverage, three feature flags (`search.reindex`, `query_index.reindex`, `search.manage`), and no single "is my search healthy / how fresh is each store" view. This is the true root cause of the confusion — not the multi-store design itself.

Proposed surface (additive; existing endpoints/commands preserved and delegated to):

- **One CLI verb with an explicit target:**
  `yarn mercato search reindex --target tokens|fulltext|vector|all --tenant <id> [--entity <id>]`.
  Keep the current default behavior discoverable but make "all" a real option that fans out to all three pipelines. Deprecate the misleading bare `reindex` semantics via help text (not removal — see BC).
- **One status/coverage command + admin panel:** per store, per entity — row counts, last-reindex timestamp, queue depth/lag for `fulltext-indexing` and `vector-indexing`, Meili reachability, embedding-provider availability (reuse the `embeddingProviderProbe` from the tenant-scoped-settings spec). Surface drift ("`search_tokens` has 10k rows for `customers:person`, Meili has 4k — fulltext is behind").
- **One reindex orchestration service** in `@open-mercato/search` that the CLI, the core query_index reindex, and the search reindex endpoint all call, so "all" is a single idempotent, resumable operation with unified logging (`source: 'tokens'|'fulltext'|'vector'`) instead of three log dialects.
- **Admin "Reindex" action** in Settings → Search that triggers `all` (or a chosen target) with progress via the existing operation-progress top-bar (`packages/core/src/modules/progress`).

Value: removes the traps operationally (not just in docs), makes freshness observable, and gives one place to reason about search health. Risk: medium — touches CLI + API + a new service, but each store's underlying pipeline is unchanged.

### B.2 Phase 2 — Wider backend pluggability (opt-in, on demand)

The strategy/driver seams already exist; this phase fills them out only where there's real demand.

- **Additional fulltext drivers** behind `FullTextSearchDriver`: Typesense / Elasticsearch / OpenSearch / Algolia. Each ships as a **dedicated provider package** (`packages/fulltext-typesense`, …) per the monorepo rule that external integrations live in their own workspace, not in `packages/core`. `createFulltextDriver()` becomes a registry keyed by `FullTextSearchDriverId` selected via env.
- **Additional vector drivers**: the seam already supports pgvector/qdrant/chromadb; add others (Weaviate, Pinecone) the same way when needed.
- **A Postgres-native fulltext driver** (`tsvector`/`websearch_to_tsquery`) as a zero-external-dependency fuzzy option for small deployments that don't want to run Meilisearch — this is the one place "fewer moving parts" and "pluggable backends" overlap productively.

Value: deployment flexibility (managed-service or self-hosted), and a no-Meili fuzzy option. Risk: low-to-medium per driver (isolated packages), but each adds a test/CI surface and a relevance-tuning burden — do **not** add speculatively.

### B.3 Phase 3 — Consolidation analysis ("combine backends into one")

Tempting because three stores is operationally heavy. Evaluated and **mostly rejected**, because the three stores exist for genuinely different reasons, not by accident:

- **`search_tokens` cannot be dropped** while searchable PII is encrypted at rest: it is the only structure that supports exact/prefix match over encrypted columns (hash-token index) and it backs DataTable list filters directly, off the `SearchService` path. Collapsing it into Meili would require sending plaintext PII to an external service — a security regression the field-policy design explicitly prevents.
- **Vector is semantically distinct** (embeddings/ANN) and only on when an embedding provider is configured; it can't be served by a lexical index.
- **Meili is the fuzzy/typo-tolerant lexical index**; `search_tokens` is exact/prefix over hashes. They answer different queries.

Narrow, legitimate consolidations worth considering instead of a grand merge:
- **Postgres-only profile** for small/self-hosted installs: tokens (exact/prefix) + a `tsvector` fulltext driver (B.2) + pgvector — "one database, no external services," selected by config. This *reduces external dependencies* without collapsing the *logical* separation.
- **Single write fan-out API** so callers `index()` once and the service guarantees all enabled stores converge (already largely true via `searchService.index` fanning to all strategies) — make that the documented, only-blessed write path and remove the impression that stores must be maintained separately.

Recommendation: **do not merge the stores.** Invest B.1 (unified control plane) + optional B.2 (Postgres profile) to get most of the operational simplicity people actually want, without the security/relevance regressions a true merge would cause.

### B.4 Phase 4 — Unify the query-time availability decision (read path)

B.1 unifies the **write-side control plane** (reindex/status). This phase is its read-path twin: one place that answers *"is token search usable for (entity, tenantId, orgScope)?"* at query time, instead of every consumer hand-assembling the decision.

**Problem.** The decision `resolveSearchConfig().enabled && tableExists('search_tokens') && hasSearchTokens(entity, tenantId, orgScope)` is independently assembled at five call sites across two engines:

| Copy | Where | Probe gated on an actual `like`/`ilike` filter? |
|---|---|---|
| `HybridQueryEngine.query()` | `packages/core/src/modules/query_index/lib/engine.ts` (~L251–449) | Only after #4723 |
| `HybridQueryEngine.queryCustomEntity()` | same file (~L1639–1645) | Only after #4723 |
| Hybrid join path `applyJoinSearchFilterOp` | same file (~L731–760) | Yes (lazy, ad-hoc `joinSearchAvailability` memo map) |
| `BasicQueryEngine.query()` | `packages/shared/src/lib/query/engine.ts` (~L295–304) | **No — probes unconditionally** |
| Basic join path | same file (~L401) | Yes (its own ad-hoc memo map) |

Both engines additionally carry **private duplicate copies** of `tableExists`, `hasSearchTokens`, `applySearchTokens`, `logSearchDebug`, and `applyOrganizationScope` (plus `searchSourcesHaveTokens` in the hybrid engine), and the identical `search:init` / `search:disabled` / `search:no-search-tokens` debug block. The copies have already drifted: `BasicQueryEngine` memoizes `tableExists` (`tableCache`); `HybridQueryEngine` re-queries `information_schema` per call. #4723 documents why the un-gated probe is pathological on large `search_tokens` tables (seq-scan plan, p95 12.5 s on plain list loads) — but it is call-site discipline: it fixed the two hybrid paths and nothing prevents the next call site from being written un-gated, and the `BasicQueryEngine` copy (live — it is the delegate the hybrid falls back to, `query_index/di.ts`) still probes unconditionally.

**Design constraint.** Kysely `where((eb) => …)` callbacks are synchronous, so the availability answer must exist **before** builder code runs. Laziness therefore lives at query-orchestration level: resolve once per `query()` invocation, and only when the normalized filters actually contain a `like`/`ilike` op (the #4723 gate, made structural). The join paths are already async and probe lazily per joined entity; they keep that shape, backed by the resolver's memo instead of ad-hoc maps.

**Proposed shape** — a small resolver in `packages/shared/src/lib/search/availability.ts` (final naming at implementer's discretion), constructed by each engine and injected with the engine's `db` accessor, `SearchConfig`, org-scope applier, and debug logger:

```ts
const availability = createSearchTokenAvailability({ getDb, config, applyOrganizationScope, logDebug })
await availability.staticEnabled()                              // config.enabled && tableExists('search_tokens'); memoized
await availability.hasTokens(entity, tenantId, orgScope)        // memoized per (entity, tenantId, org-signature)
await availability.anySourceHasTokens(sources, tenantId, orgScope) // first-hit semantics of searchSourcesHaveTokens
```

Memoization is per engine instance; engines are constructed per request (`createRequestContainer`), so entries never outlive a request — the same staleness contract the ad-hoc join maps have today. `staticEnabled()` is the cheap eager half (still needed pre-gate by `shouldAttachCustomSources`); `hasTokens()` is the expensive half that only runs behind the search-filter gate.

**Deliverables:**

1. The resolver in `packages/shared/src/lib/search/availability.ts`, with per-instance memoization and debug hooks that preserve the existing `search:*` event names and payloads (`search:init`, `search:disabled`, `search:no-search-tokens`, `search:has-tokens-error`, `search:source-has-tokens` — operators grep these).
2. A shared `hasSearchFilter(filters)` predicate next to it, so the gate condition (`op === 'like' || op === 'ilike'`) is defined once instead of re-derived per call site.
3. `HybridQueryEngine` adoption: `query()`, `queryCustomEntity()`, and `applyJoinSearchFilterOp` consume the resolver; delete the private `hasSearchTokens`, `searchSourcesHaveTokens`, the `joinSearchAvailability` map, and the un-memoized search use of `tableExists`.
4. `BasicQueryEngine` adoption: same, plus gate its eager probe on `hasSearchFilter` — the **one intended behavior change** of this phase (extends #4723's argument to the base engine: without a search filter the probe's answer is never read).
5. Optional follow-up (may ship separately): move the module-private `SearchRuntime` / `SearchTokenSource` types to shared and have `BasicQueryEngine` adopt them instead of threading `searchActive`/`searchConfig` through per-helper opts objects.
6. Tests: #4723's four probe-count tests pass **unchanged**; add `BasicQueryEngine` parity cases (`eq` filter → 0 probes, `ilike` → probe runs) and a memoization case (two joins on the same entity → one probe).

**What this phase deliberately enables:** the durable probe fix from #4723's scope note (reshaping `tenant_id is not distinct from $x` into index-usable predicates, or a coverage-backed existence flag) lands in exactly one function — `hasTokens()` — instead of being re-derived per engine. That fix stays out of this phase's scope.

**Sequencing:** after #4723 merges (this phase edits the same lines and subsumes its gate structurally) and preferably after #4685 (same module, avoids conflicts). Before any durable probe-shape change.

### B.5 Decision matrix

| Direction | Effort | Risk | Operator value | Recommendation |
|---|---|---|---|---|
| B.0 Truthful docs/CLI/env | S | Very low | High (unblocks everything) | **Do now** |
| B.1 Unified control plane (reindex `--target all`, status, admin) | M | Medium | High | **Do next** |
| B.2 More fulltext/vector drivers + Postgres tsvector | M per driver | Low–Med | Medium (deployment flexibility) | On demand, provider packages |
| B.3 Merge stores into one | L | High | Low (security/relevance regressions) | **Reject**; do Postgres profile instead |
| B.4 Read-path availability resolver | S–M | Low–Med (read path of every list endpoint; mitigated by probe-count tests) | Medium (deletes ~5 duplicated decision sites; prevents #4723-class regressions structurally) | **Do after #4723/#4685 land** |

---

## Backward Compatibility

- **Encrypted list-search correction**: the shared token-lookup export, direct route unions, search-source entries, and non-canonical event bridges are additive. Existing routes, event IDs, entity IDs, and raw `ILIKE` predicates remain available; token matches are unioned into the existing result set.
- **Phase 0**: docs + one CLI help string (non-behavioral) + a stale code comment. No contract surface changes. `BACKWARD_COMPATIBILITY.md` unaffected.
- **Phase 1**: strictly additive — new CLI flags/commands, a new orchestration service, a new admin action. The three existing reindex entry points and their feature IDs (`search.reindex`, `query_index.reindex`, `search.manage`) are preserved and delegated to. Any change to the bare `reindex` default must follow the deprecation protocol (help-text `@deprecated`, bridge ≥1 minor, `UPGRADE_NOTES.md`).
- **Phase 2/3**: new drivers/packages are additive and env-gated; a Postgres-only profile is opt-in. `SearchStrategyId`, `SearchStrategy`, event IDs (`search.index_record`, `search.delete_record`, `query_index.*`), queue names (`fulltext-indexing`, `vector-indexing`), and DI keys (`searchService`, `searchIndexer`, `searchStrategies`) are FROZEN/STABLE surfaces — extend, never rename.
- **Phase 4**: no contract surfaces touched — every deleted/moved member is `private` (`hasSearchTokens`, `searchSourcesHaveTokens`, `tableExists`, `applySearchTokens`) or a module-private type (`SearchRuntime`, `SearchTokenSource`); the new shared module is an additive export; no DB schema, API route, event ID, or DI key changes. The only behavior change (gating `BasicQueryEngine`'s probe) is observable solely as absent SQL statements on queries that carry no search filter.

## Non-goals

- No change to how `SearchService.search()` merges/ranks (RRF) in this spec.
- No change to tenant-scoping of settings (owned by `2026-06-15-tenant-scoped-search-settings.md`) or results (SPEC-041).
- Phase 0 changes no runtime search behavior.
- Phase 4 adds no schema. Of the durable probe fixes discussed on #4723, two no-schema measures landed inside the resolver at the maintainer's direction (index-usable `= / IS NULL` tenant predicates replacing `IS NOT DISTINCT FROM`, and a process-level TTL presence cache, `OM_SEARCH_TOKEN_PRESENCE_CACHE_MS`); the durable worst-case fix is the probe-shaped index specced in `2026-07-31-search-token-probe-index.md` (the earlier "measure after #4685" gate was dropped once multi-million-row `search_tokens` was confirmed as production steady state, not a #4685 artifact).
- Direct token-lookup consumers require unit coverage for query tokenization/scoping, route-level union behavior, event-to-index lifecycle bridges, and self-contained API integration coverage for the affected list endpoints.

## Verification

- **Claims-vs-code**: every fact in Part A cites a source file and was verified on 2026-07-24; re-verify before implementing later phases (treat code as ground truth over any transcript).
- **Docs build**: `cd apps/docs && yarn build` (Docusaurus) — no broken MDX/links; sidebar entry resolves.
- **CLI help**: `yarn mercato search help` and `yarn mercato search reindex-help` read correctly and point to the fulltext reindex endpoint.
- **Phase 1+ (when implemented)**: integration coverage for every reindex target (tokens/fulltext/vector/all), the status command, and the admin action, per `.ai/qa/AGENTS.md`; self-contained fixtures with teardown.
- **Phase 4 (when implemented)**: `yarn workspace @open-mercato/shared test` + `yarn workspace @open-mercato/core test`; the four probe-count tests from #4723 pass without modification; new `BasicQueryEngine` parity and memoization tests as listed in B.4; no integration tests required (no API/DB/UI surface changes — same exemption #4723 claims).

## Changelog

- 2026-07-24 — Initial draft: current-architecture clarification (Part A) + evolution roadmap (Part B).
- 2026-07-31 — Added Phase 4 (B.4): unified read-path token-availability resolver shared by both query engines — makes the #4723 probe gate structural, extends it to `BasicQueryEngine`, and gives the future durable probe fix a single landing site. Renumbered the decision matrix to B.5 and added its row.
- 2026-07-31 — Implemented Phase 4: `createSearchTokenAvailability` + `hasSearchFilter`/`isSearchFilterOp` in `packages/shared/src/lib/search/availability.ts`; both engines adopted it (private `hasSearchTokens`/`searchSourcesHaveTokens`, `BasicQueryEngine.tableExists`/`tableCache`, and both ad-hoc join memo maps deleted). Folds in #4723's gate and tests rather than waiting on that PR (its four probe-count cases are ported verbatim and pass unchanged). One deviation from the plan: implemented before #4723/#4685 merge at the maintainer's direction — #4685 was verified non-overlapping (its `engine.ts` hunks touch only the auto-reindex scheduling region). Deliverable 5 (moving `SearchRuntime`/`SearchTokenSource` types to shared) deferred as specced.
- 2026-07-31 — Cheapened the probe itself (maintainer request on review): (1) tenant predicate reshaped from `IS NOT DISTINCT FROM` to `= / IS NULL` so `search_tokens_lookup_idx` stays usable as an access path; (2) process-level TTL cache for the presence answer (`OM_SEARCH_TOKEN_PRESENCE_CACHE_MS`, default 30 s, `0` disables; module-level on purpose — engines are per-request so instance memos never amortize; error-driven `false` never cached; size-capped at 10 k entries). Documented in both `.env.example` files (template-sync) and `packages/search/AGENTS.md`. Worst case is now one pathological probe per (entity, tenant, org) per process per TTL rather than per request; the guaranteed-O(1)-miss fix stays the schema-backed existence flag noted in Non-goals.
- 2026-07-31 — Made the probe's worst case cheap via `.ai/specs/2026-07-31-search-token-probe-index.md` after the maintainer confirmed large `search_tokens` is steady state (drops the measure-first gate): a `search_tokens_presence_idx (entity_type, tenant_id, organization_id)` prefix index serves the reshaped probe as a B-tree seek for hit AND miss. A `search_token_presence` marker table was implemented first and then replaced by the index at the maintainer's direction — zero drift risk and zero maintenance code beat the table's smaller disk footprint; the comparison is recorded in that spec.
