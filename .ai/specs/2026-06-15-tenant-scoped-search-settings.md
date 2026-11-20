# Tenant-Scoped Search Settings, Env-Derived Defaults, and Verified Provider Availability

- **Status:** Partially implemented; remaining runtime-isolation work specified below
- **Scope:** OSS
- **Author:** spec-writing (auto)
- **Date:** 2026-06-15
- **Related:** `.ai/specs/implemented/SPEC-041-2026-02-24-search-organization-scoping.md` (scopes search **results**, not **settings**); [`2026-11-16-privacy-data-class-contract.md`](GDPR/2026-11-16-privacy-data-class-contract.md), “Tenant privacy settings” (R3-3)

## TLDR

Search settings now have tenant-scoped storage and settings API reads/writes, but live vector workers, query routes, the embeddings reindex route and the vector subscribers still resolve the instance configuration or auto-index flag, and several mutate one process-wide `vectorEmbeddingService`. A save or concurrent operation for Tenant A can therefore select Tenant B's embedding provider/model even though the settings rows are isolated. A cached provider probe and save-time availability guard also exist; some runtime paths still use presence-only detection.

**Proposed remaining work:** pass the trusted tenant into every settings consumer, use a configuration snapshot and operation-scoped embedding service for each worker/query/save, and complete probe wiring. Preserve the existing nullable `module_configs` scope columns, scoped/global/env fallback, public service signatures and settings responses. This also preserves the storage prerequisite consumed by R3-3; it adds no second settings table or migration.

## Locked Decisions (Open Questions gate, 2026-06-15)

| # | Question | Decision |
|---|----------|----------|
| Q1 | How to introduce tenant scoping? | **Scope `ModuleConfig` generally** — already delivered optional `tenant_id`/`organization_id` to `module_configs` + `ModuleConfigService`; scoped lookup with global fallback; migrate search keys to scoped reads/writes. Reusable by all modules. |
| Q2 | What does an unset tenant inherit? | **Env-derived defaults only** — an unset tenant inherits read-only defaults computed from env vars; existing global rows remain as the instance default/backfill. No new superadmin instance-default editing surface. |
| Q3 | How is provider availability verified? | **Active probe, cached** — existing `embeddingProviderProbe.checkAvailability(providerId, options?)` verifies Ollama reachability and uses key presence for other providers; short-TTL cached, fail-closed; UI disables unreachable providers. |

## Problem Statement

### P1 — Cross-tenant settings overwrite (data-isolation defect)

The original global-row defect is partly fixed in this checkout. `ModuleConfig` already has nullable `tenant_id` and `organization_id`, `module_configs_global_unique`, `module_configs_scoped_unique` and `module_configs_module_name_tenant_idx`. `ModuleConfigService` already accepts optional `ConfigScope`, returns `source: 'tenant' | 'instance'` and uses scope-aware `v2` cache keys. Search settings helpers and API writes already pass `auth.tenantId` as scope, but neither write route requires that value to be non-empty: a tenantless principal (`auth.tenantId` null) reaches `ModuleConfigService.setValue` with a null tenant, which writes the instance-default row every unset tenant inherits (`api/embeddings/route.ts:194-195,329-332`, `api/settings/global-search/route.ts:58-59,81-82`).

The remaining live call sites are the complete first-party set of unscoped `resolveEmbeddingConfig` / `resolveAutoIndexingEnabled` reads and `vectorEmbeddingService.updateConfig` writes (every non-test caller in `packages/`; all are in `packages/search/src/modules/search/`):

| Consumer | Current gap | Required scope |
|---|---|---|
| `workers/vector-index.worker.ts:228` and `:344` | Batch and single-record paths call `resolveEmbeddingConfig(ctx, { defaultValue: null })` and mutate the shared service | Each job's validated tenant; apply it to `resolveAutoIndexingEnabled` (`:329`) too |
| `api/search/route.ts:104` | Query reads instance configuration and calls `updateConfig` on shared DI service | Tenant derived from resolved request/auth scope |
| `api/search/global/route.ts:108-111` | Cmd+K has the same unscoped read/mutation despite scoped strategy selection | Same trusted request tenant |
| `api/embeddings/route.ts:341-345` | A tenant-scoped save calls process-wide `vectorEmbeddingService.updateConfig` | Save only that tenant's row; no shared service mutation |
| `api/embeddings/reindex/route.ts:106-109` | Before enqueuing (`useQueue: true`), the route reads the instance configuration and calls `updateConfig` on the shared service; embedding itself happens later in the worker | Drop the read and the shared write; the enqueued jobs already carry `auth.tenantId`, and the worker resolves that tenant's snapshot |
| `subscribers/vector_purge.ts:41-44` | Purge reads the instance configuration and calls `updateConfig` on the shared service although purging embeds nothing | Drop the read and the shared write; the purge stays scoped to the payload's validated `tenantId` |
| `subscribers/vector_upsert.ts:47` and `subscribers/vector_delete.ts:47` | `resolveAutoIndexingEnabled(ctx, { defaultValue: true })` reads the instance flag although the record's `tenantId` is already resolved; a tenant that enabled auto-indexing under an instance-disabled default is never vector-indexed, and the reverse indexes a tenant that disabled it | `{ scope: { tenantId } }` from the resolved record scope |
| `api/embeddings/route.ts:194-195` and `api/settings/global-search/route.ts:58-59` | Writes check only `auth.sub`; a null `auth.tenantId` writes the instance-default row | Refuse a tenantless write before any `setValue` |

The source guard in **Test Plan** is the authoritative inventory: it fails on any first-party unscoped settings read or shared-service `updateConfig` outside this table's required replacements.

These are source observations on 2026-11-16, not a claim that runtime tests have passed. Existing scoped settings storage alone cannot make interleaved jobs/queries safe. The implemented result-scope spec remains authoritative for organization filtering; selecting the correct embedding configuration never widens result visibility.

### P2 — Provider availability is only partly wired

`isProviderConfigured` (`packages/search/src/modules/search/lib/embedding-config.ts:86`) gates every non-Ollama provider on env-var presence but returns `true` for Ollama unconditionally:

```text
case 'ollama':
  return true
```

`EmbeddingService.available` (`packages/search/src/vector/services/embedding.ts:82`) and `VectorSearchStrategy.isAvailable` (`packages/search/src/strategies/vector.strategy.ts:61`) propagate this, and the Ollama client is created against `OLLAMA_BASE_URL ?? 'http://localhost:11434'` with no health check (`embedding.ts:158`). The existing `lib/provider-probe.ts` already implements cached reachability, and the embeddings API already uses its result and a 409 save guard. Reuse those contracts rather than claim that no verification exists. Remaining runtime availability and DI branches must agree with that probe; a present-but-invalid key remains available for key-based providers under the deliberately limited presence gate.

## Goals / Non-Goals

**Goals**
- Each tenant has its own search settings; one tenant's change never affects another.
- Unset tenants resolve to env-derived defaults; existing global rows continue to act as the instance default during and after migration.
- Ollama availability reflects real reachability; other providers retain the explicit key-presence limit. Reuse the cached fail-closed probe in the UI, save guard and operation-scoped runtime services.
- Keep `ModuleConfig` / `ModuleConfigService` / search API surfaces backward-compatible (additive only).

**Non-Goals**
- Per-tenant **secrets** (API keys remain env-level/instance-level; this spec scopes *selection and toggles*, not credential storage).
- Adding new vector stores or embedding providers.
- Changing search **result** scoping (already covered by `implemented/SPEC-041-2026-02-24-search-organization-scoping.md`).
- A superadmin instance-default editing UI (explicitly out by Q2).

## Proposed Solution

Complete the existing tenant-scoped configuration by carrying it through each runtime operation, with the compatibility baseline and remaining work below.

## Architecture

### Resolution flow

```
Request (authenticated: tenantId, organizationId, features)
        │
        ▼
Search settings API (embeddings / global-search / auto-index)
        │  scope = { tenantId } from auth context (NEVER client-supplied)
        ▼
ModuleConfigService.getValue(moduleId, name, { scope }) / setValue(moduleId, name, value, scope)
        │
        ├─ scoped row  (module_configs WHERE tenant_id = :tenantId)      ← tenant override
        ├─ global row  (module_configs WHERE tenant_id IS NULL)          ← instance default (legacy rows)
        └─ env-derived default (caller-provided)                          ← final fallback
        │
        ▼
resolved value + `source: 'tenant' | 'instance' | 'env'`

Provider availability (env/instance level, tenant-independent):
EmbeddingProviderProbe.checkAvailability(providerId) → { available, reason? }
        └─ cached (cache strategy, short TTL), fail-closed, timeout-bounded
```

### 1. Generalised tenant scoping for `ModuleConfig` (Q1)

The following tenant-grain storage design is already present and stays the compatibility baseline; characterize it before changing consumers. Do not generate a duplicate migration or remove/recreate its indexes.

- Entity already has `organization_id uuid null` and `tenant_id uuid null`.
- The existing **two partial unique indexes** avoid the Postgres "NULLs are distinct" pitfall:
  - `module_configs_global_unique` — `UNIQUE (module_id, name) WHERE tenant_id IS NULL` (preserves today's invariant for global/instance rows).
  - `module_configs_scoped_unique` — `UNIQUE (module_id, name, tenant_id) WHERE tenant_id IS NOT NULL`.
- `organization_id` is stored for completeness; **search settings resolve at tenant grain** (`organizationId` is `null` for these rows). The uniqueness, read path and cache are tenant-grain; accepting an `organizationId` field does not promise independent organization overrides.

`ModuleConfigService` (existing signatures plus the C1-owned future optional write-version argument; subset shown):

```ts
type ConfigScope = { tenantId?: string | null; organizationId?: string | null }

getRecord(moduleId, name, scope?: ConfigScope): Promise<ModuleConfigRecord | null>
getValue<T>(moduleId, name, options?: { defaultValue?: T | null; scope?: ConfigScope }): Promise<T | null>
setValue(moduleId, name, value, scope?: ConfigScope, options?: { expectedUpdatedAt?: string | null }): Promise<ModuleConfigRecord | null>
invalidate(moduleId, name?, scope?: ConfigScope): Promise<void>
```

- **Resolution order** in `getRecord` when `scope.tenantId` is present: scoped row → global row (`tenant_id IS NULL`) → not found. The returned record carries an internal `source` marker so callers can expose it.
- **`setValue` with a scope** writes/updates only the scoped row (`tenant_id = scope.tenantId`); it never touches the global row. **`setValue` without a scope** keeps today's behavior (global row), so existing non-search callers are unchanged.
- **Cache key** is already scope-aware: `module-config:v2:${moduleId}:${name}:${tenantId ?? 'global'}`. `invalidate` clears the specific scope key; module-tag invalidation is unchanged.

The planned optional fifth `setValue` argument is owned by [`2026-11-16-privacy-data-class-contract.md`](GDPR/2026-11-16-privacy-data-class-contract.md), “Tenant privacy settings”. Preserve that additive argument when both changes land together. Existing callers that omit scope retain their instance-global behavior.

**R3-3 — Tenant privacy settings live in `module_configs`.** The contract spec owns `privacySettingsService.get(scope, name)`, its `retention.<area>.<setting>` declarations and settings CLI. Its adapter deliberately accepts only `source: tenant` and discards instance fallback before applying a declared default/unset. Search's scoped → instance → env fallback remains specific to search; do not apply it to privacy retention ages. No privacy table, renamed config type or organization override is introduced here.

### 2. Tenant-scoped search settings + env-derived defaults (Q2)

Thread the authenticated `tenantId` into the three search settings flows:

- `resolveEmbeddingConfig(resolver, { scope, defaultValue })` and `saveEmbeddingConfig(resolver, config, { scope })` pass the scope through to `ModuleConfigService`. When neither a tenant nor an instance row exists, the resolver computes the **env-derived default**: `DEFAULT_EMBEDDING_CONFIG` (`packages/search/src/vector/types.ts`) narrowed to the first env-configured provider via `getConfiguredProviders()`.
- `resolveGlobalSearchStrategies` / `saveGlobalSearchStrategies` and the auto-index flag flow take the same scope treatment.
- Reads return a `source: 'tenant' | 'instance' | 'env'` discriminator so the UI can show whether the tenant is using its own config or inheriting.
- **Isolation invariant:** the API derives `tenantId` from the auth context only. A client-supplied tenant is ignored. The existing features continue to gate writes (`search.embeddings.manage` for embeddings and auto-index, `search.manage` for global search); a tenant admin can only ever read/write its own scoped row (or read the inherited default).
- **Tenantless writes refuse.** `POST /api/search/embeddings` and `POST /api/search/settings/global-search` return `403` with the translated `search.api.errors.tenantRequired` error when `auth.tenantId` is empty, before any `setValue`. Under Q2 the instance default is env-derived plus legacy global rows, with no editing surface; a superadmin with no tenant selected therefore cannot write the row every unset tenant inherits. Tenantless GETs keep reading the instance/env default.
- **Migration semantics:** existing global rows (`tenant_id IS NULL`) remain untouched and act as the instance default. The first tenant save creates a tenant-scoped row; until then the tenant transparently inherits. No data backfill is required, and no tenant inherits another tenant's choices.

### 2a. Runtime configuration isolation

Every vector operation resolves one immutable `EmbeddingProviderConfig` snapshot before preflight/embedding. Batch and single-record worker paths use the validated job tenant (including `vector-index.worker.ts:228` and `:344`); `api/search/route.ts:104` and `api/search/global/route.ts:108` use the trusted resolved request tenant. Thread that same scope into auto-index checks and strategy reads, including the worker (`:329`) and the `vector_upsert` / `vector_delete` subscribers, which pass the record's resolved `tenantId`. The embeddings reindex route and the `vector_purge` subscriber resolve no embedding configuration at all: reindex only enqueues tenant-scoped jobs, and purge deletes without embedding. Every vector query, job and mutation requires a trusted non-null tenant UUID before resolving a model, invoking a provider, opening the vector driver or enqueuing vector work. A tenant-capable record or job without tenant scope refuses. A registered tenantless catalogue entity with no tenant or organization columns may use the supported token/fulltext paths only. The vector dispatcher skips that entity on mixed-strategy query/index paths and refuses an explicitly vector-only request; it never falls back to another tenant or to an installation vector index. Existing tenantless settings GETs still pass explicit `scope: { tenantId: null }` from authenticated context to read instance/environment defaults. They do not authorize an operation against vector storage.

Use an operation child container with its own `vectorEmbeddingService` initialized to the snapshot and a strategy/indexer resolved within that scope. Provider clients may be reused only by the full effective provider/model/dimension/base-URL configuration identity; no mutable config or tenant-selected state is shared between operations. Preflight, availability, document embeddings and query embeddings must all use the same snapshot and service. Dispose the operation scope after the work; a settings save affects subsequent operations for that tenant and cannot rewrite an already-running operation.

Eliminate **all first-party process-wide** `vectorEmbeddingService.updateConfig` mutations, including workers, both query routes, `api/embeddings/route.ts:341-345`, `api/embeddings/reindex/route.ts:106-109` and `subscribers/vector_purge.ts:41-44`. The save writes/invalidates only its tenant's setting and returns the existing response. Keep the public `EmbeddingService.updateConfig` method and DI key available for compatibility with independently owned service instances; a scoped runtime change does not remove a stable API. `SEARCH_DISABLE_SINGLETON_CACHE=1` is not the fix: correctness must hold with normal singleton driver/client reuse enabled.

**Model changeover within a tenant.** Bind each embedding snapshot to an immutable generation identifying its effective provider, model, dimensions and endpoint. Bind the current tenant generation and nullable generation on stored vectors in additive search-owned storage. Update the tenant's generation atomically with a selection change, including a switched inherited configuration. Queries must resolve and filter by the current generation, and final upserts must compare the snapshot generation against the current tenant generation atomically with the write. A losing writer does no upsert and schedules or leaves eligible work for the current generation. A reindex locks/pins its tenant generation, completes only for that generation, and cannot republish stale output or mark a later generation done. Runtime changes of inherited settings require reconciliation before affected tenants resume vector work. Rows without provenance remain in storage and are ineligible until reindexed unless migration can independently prove their exact generation. Existing fulltext and token paths retain their normal fallback while vector results rebuild. A driver unable to honor these guarantees can retain its old API but provides no transition-time vector results until an explicitly paused, drained and verified tenant reindex; any later model change repeats that gate. No maintenance step purges another tenant's rows.

The shared vector store's existing dimension/model compatibility check remains. Unsupported configurations refuse or request the existing reindex path for that tenant; tenant scoping does not introduce per-tenant vector tables or authorize a cross-tenant purge. Interleaving a save with another tenant's query or worker must not change its configuration snapshot or indexed results.

### 3. Verified, cached provider availability (Q3)

Reuse the existing `EmbeddingProviderProbe` from `lib/provider-probe.ts`, DI key `embeddingProviderProbe`, exposing `checkAvailability(providerId, options?: { force?: boolean; baseUrl?: string }): Promise<ProviderAvailability>`. Preserve optional `diagnostic`/`models` members and the existing localized API response:

- **Ollama:** GET `${OLLAMA_BASE_URL ?? 'http://localhost:11434'}/api/tags` with a bounded timeout (≈1500 ms, `AbortController`). Available only on a successful response; `models` is taken from the tags payload. Unreachable → `{ available: false, reason: 'Not reachable at <baseUrl>' }`.
- **Key-based providers (openai, google, mistral, cohere, bedrock):** keep env-key presence as the baseline gate (cheap, no surprise network/billing calls). Optionally a lightweight, opt-in validation can be layered later; presence remains the default availability signal but reported via the probe so all providers share one code path.
- **Caching & safety:** default-endpoint results cached via the DI cache strategy under a global (tenant-independent) key with a short TTL (≈30 s); an explicit candidate `baseUrl` bypasses that shared cache as the current probe does; probe is `try/catch` fail-closed (any error → unavailable) and never throws into request handling. A manual "Refresh" bypasses the cache.
- Keep synchronous `isProviderConfigured` callable with its existing boolean signature; its credential-presence result cannot establish Ollama reachability. Async operation preflight and availability consumers call the existing probe using the operation snapshot; never silently change the helper into a Promise or assign another tenant's provider config to a shared service. Register the probe in both normal and singleton-disabled DI branches.
- **Save-time guard:** `POST /api/search/embeddings` rejects selecting a provider whose probe reports unavailable (`409 { error, reason }`), so the UI and API agree and a dead provider can never be persisted.

## Data Models

`module_configs` (already implemented — preserve the current columns/indexes):

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | unchanged |
| `module_id` | text | unchanged |
| `name` | text | unchanged |
| `value_json` | json null | unchanged |
| `organization_id` | uuid **null** | existing — scope (unused by search; tenant grain only) |
| `tenant_id` | uuid **null** | existing — scope; `NULL` = global/instance default |
| `created_at` / `updated_at` | timestamptz | unchanged |

Existing indexes: `module_configs_global_unique` (`WHERE tenant_id IS NULL`), `module_configs_scoped_unique` (`WHERE tenant_id IS NOT NULL`) and `module_configs_module_name_tenant_idx` on `(module_id, name, tenant_id)`. The config settings work adds no `module_configs` schema or index swap. Preserve the R3-3 storage prerequisite. The generation transition below adds search-owned runtime storage only.

**Search-owned generation storage.** The pgvector driver’s existing SQL migration registry adds nullable `vector_search.embedding_generation` and a search-owned `vector_tenant_generations` table keyed by a non-null tenant UUID with a current generation UUID, effective configuration identity and status. The identity covers the owner's uncached settings revision and source, normalized effective provider/model/dimensions/endpoint identity and a pinned deployment default revision where inherited environment defaults apply. Store no API key or clear sensitive endpoint credentials. Give the new runtime table and vector column their search-owned catalogue and privacy inventory declarations. Existing rows start with null provenance and stay excluded from generation-aware vector lookup until the tenant completes a verified reindex. No speculative backfill or table rewrite is required.

**Settings and vector commit fence.** Serialize relevant tenant/global owner settings writes, generation reconciliation and final vector writes or completion checks through a single search-owned installation advisory fence on the target database. Keep external embedding calls outside the fence. At every repair, commit or query admission, read the current effective settings revision and active generation through their owners. A settings commit followed by a process crash before generation publication leaves a revision mismatch, which refuses vector reads and writes for affected tenants until the generation is explicitly reconciled. Reconciliation publishes a fresh UUID and a pending reindex under the fence. The previous generation cannot become current again even after a configuration changes back. Effective changes written through separately supported owner paths must participate in the fence or force a paused rollout and verified reconciliation. For inherited environment defaults, publish a fresh installation-pinned default revision with traffic and vector workers paused, then reconcile affected tenants before resuming. Mixed-default replicas refuse affected vector requests and writes. Every vector final write and reindex completion verifies its captured generation against the fresh owner state inside the same fence as the write. Vector reads verify the captured generation immediately before publishing results. Token and fulltext fallback remains available throughout.

`EmbeddingProviderConfig` (`packages/search/src/vector/types.ts`) is unchanged on the wire; preserve the existing sibling `source` response field rather than adding it to the config.

## API Contracts

All routes are tenant-scoped via the auth context; `tenantId` is never read from the request body/query.

| Endpoint | Method | Permission | Change |
|----------|--------|------------|--------|
| `/api/search/embeddings` | GET | `search.embeddings.view` | Returns the tenant-resolved config + `source`; provider list carries `available` + `reason` from the probe. |
| `/api/search/embeddings` | POST | `search.embeddings.manage` | Writes only the tenant-scoped row; **rejects** an unavailable provider with a structured reason; refuses a tenantless caller with `403`. |
| `/api/search/settings/global-search` | GET / POST | `search.view` / `search.manage` | Tenant-scoped read/write; GET adds `source`; POST refuses a tenantless caller with `403`. |
| `/api/search/settings` | GET | `search.view` | Per-strategy `available` reflects the probe (vector availability is real, not assumed). |
| auto-index flag (within `/api/search/embeddings` POST) | POST | `search.embeddings.manage` | Tenant-scoped. |

Response additions are backward-compatible (new fields only). The tenantless-write `403` is the one new refusal; it closes a write path to the instance-default row and is documented in UPGRADE_NOTES. Zod validators live in the search module; provider id remains a closed enum.

## UI

`SearchSettingsPageClient.tsx` / `VectorSearchSection.tsx` / `GlobalSearchSection.tsx`:

- Provider cards render from probe results: an unavailable provider (e.g. Ollama with nothing listening) is **disabled** (not selectable) with a reason surfaced via tooltip/helper text, instead of an unconditional "Active" checkmark.
- The configuration panel indicates whether the tenant is using its **own** settings or **inheriting** the instance/env default (`source`), with an affordance to start overriding.
- A "Refresh" control re-probes (cache bypass).
- Design System compliance: availability/status uses semantic status tokens (`{property}-status-{status}-{role}`), never hardcoded `text-red-*` / `bg-green-*`; no arbitrary text sizes; lucide-react icons; dialogs keep `Cmd/Ctrl+Enter` submit and `Escape` cancel; icon-only buttons carry `aria-label`. Boy Scout rule applies to any touched lines.

## Migration & Backward Compatibility

Contract surfaces consumed (per `BACKWARD_COMPATIBILITY.md`): existing **DB schema** (`module_configs`), **DI/types** (`ModuleConfigService`, `EmbeddingService`), **API routes** (search settings). Remaining changes preserve their shapes:

- **Schema:** keep existing `module_configs` columns, scope indexes and snapshots. Add the search-owned pgvector driver migration and its runtime table declaration. Migrate before generation-aware readers and writers activate. Pause and drain vector workers for the transition, reconcile effective generations and reindex by tenant before enabling that tenant’s generation-aware results. Keep fallback available and never guess provenance for legacy rows. On rollback, pause affected vector work until older workers cannot expose mixed generations. Existing global rows remain instance defaults for search; the R3-3 privacy adapter discards them.
- **`ModuleConfigService`:** preserve existing optional scope, `v2` cache keys and no-scope behavior. Retain the C1-owned optional `expectedUpdatedAt` extension if it lands first; do not claim another cache-version or signature migration here.
- **Search APIs:** preserve existing request/response shapes, source metadata and tenant-scoped settings writes. A tenantless principal can no longer write the instance-default row through either settings POST (`403`); operators set instance defaults through env vars, as Q2 already states. The remaining bug fix makes workers and queries honor that same configuration; document the runtime-isolation correction in UPGRADE_NOTES.
- **Provider/runtime availability:** reuse the existing async probe and 409 response while keeping synchronous credential helper signatures. Remove first-party shared-service mutations without removing `EmbeddingService.updateConfig` or renaming `vectorEmbeddingService`. Document that each tenant now controls its own runtime configuration and in-flight operations retain their snapshot.

No event IDs, widget spot IDs, ACL feature IDs, import paths, or CLI commands change.

## Risks & Impact Review

| # | Risk | Severity | Area | Mitigation | Residual |
|---|------|----------|------|------------|----------|
| R1 | Postgres treats NULLs as distinct → duplicate global rows | High | DB | Partial unique indexes split global vs scoped | Low |
| R2 | A settings read leaks another tenant's row | High | Tenant isolation | Resolution order is scoped→global→env; writes always scoped to auth tenant and refused for a tenantless caller; integration test asserts A↛B | Low |
| R3 | `ModuleConfigService` change breaks existing callers | Medium | Core contract | `scope` optional; no-scope path unchanged; unit test covers default path | Low |
| R4 | Probe latency blocks settings page / search | Medium | UX/perf | Bounded timeout, short-TTL cache, async, fail-closed | Low |
| R5 | Stale cache after a scoped write | Medium | Cache | `v2` key namespace + scope-aware invalidate on write | Low |
| R6 | Operators relying on always-available Ollama see it disabled | Low | Behavior | Documented in UPGRADE_NOTES; reason string explains how to fix reachability | Low |
| R7 | Env-key providers still report available with an invalid key | Low | Provider check | Out of scope here; presence-gate retained, optional deep validation noted as follow-up | Accepted |

## Phasing

The four phases preserve existing storage first, then close runtime isolation, complete provider wiring and validate the UI/docs.

## Implementation Plan

### Phase 1 — Characterize the existing `ModuleConfig` tenant contract
- 1.1 Verify the current scope columns, both partial unique indexes and `module_configs_module_name_tenant_idx`; reuse existing migrations rather than generate another one.
- 1.2 Preserve optional `ConfigScope`, scoped/global resolution, scoped writes, source and `v2` keys; compose with C1's R3-3 extension without redefining privacy settings.
- 1.3 Reuse/extend characterization tests for scoped→global→null, write isolation, no-scope behavior and scoped invalidation; pin that privacy discards instance fallback in its owning tests.

### Phase 2 — Tenant-scoped search settings + env-derived defaults
- 2.1 Complete scope propagation at both worker `resolveEmbeddingConfig` calls (`:228`, `:344`), both query routes (`api/search/route.ts:104`, `api/search/global/route.ts:108`), the worker auto-index read (`:329`) and the `vector_upsert` / `vector_delete` auto-index reads (`:47`), using validated job, resolved record or resolved auth scope. Require that scope at vector admission before provider, driver or enqueue work. Keep already-scoped settings APIs intact, and add the tenantless-write `403` to both settings POSTs.
- 2.1a Build operation-scoped embedding service/strategy/indexer snapshots. Remove every first-party shared-service `updateConfig`, including the embeddings save at `:341-345`, the embeddings reindex route (`api/embeddings/reindex/route.ts:106-109`, which only enqueues) and `subscribers/vector_purge.ts:41-44` (purge needs no embedding), while preserving its public method and DI key for isolated callers.
- 2.1b Deliver additive pgvector storage, owner catalogue declarations, authoritative revision reads and the shared commit fence before enabling generation-aware results. Keep the old driver interface behind the paused/reindex path when the driver lacks generation support.
- 2.2 Preserve env-derived defaults and the existing `source` discriminator; verify worker/query snapshots use the same effective fallback as the settings GET.
- 2.3 Integration tests in `packages/search/src/modules/search/__integration__`: interleave A/B saves, both worker paths and both query endpoints with deterministic per-config embeddings; prove immutable in-flight snapshots, tenant auto-index/strategy behavior and inherited defaults. Fixtures and teardown belong to each test; no demo tenants/provider calls.

### Phase 3 — Verified provider availability
- 3.1 Reuse `EmbeddingProviderProbe` (Ollama reachability via `/api/tags`, key-presence for the rest), cached + fail-closed; DI registration.
- 3.2 Complete async operation-scoped availability/preflight wiring to the existing probe in both DI branches, preserving the synchronous helper and the existing 409 save guard. Candidate URLs do not poison the default-endpoint cache.
- 3.3 Unit tests: reachable/unreachable/timeout for Ollama; availability propagation; save guard.

### Phase 4 — UI + docs
- 4.1 Provider cards reflect real availability (disable + reason); surface `source`/inheritance + Refresh; DS-compliant.
- 4.2 Integration test: selecting an unreachable provider is blocked in UI and rejected by API. The test user holds `search.embeddings.view` and `search.embeddings.manage`.
- 4.3 Update `packages/search/AGENTS.md` (the per-tenant claim is now accurate), `packages/core/AGENTS.md` (`ModuleConfigService` scope option), and UPGRADE_NOTES.

## Test Plan / Integration Coverage

- **Unit (core):** `ModuleConfigService` scoped resolution, scoped-write isolation, BC no-scope path, cache `v2` keying/invalidation, partial-unique behavior.
- **Unit (search):** env-derived defaults; existing probe (Ollama reachable/unreachable/timeout, candidate-URL cache isolation, key-based presence); both DI branches; operation snapshot stability and every scoped call site; POST 409 guard. A source guard rejects first-party mutations of a process-shared `vectorEmbeddingService` and any first-party `resolveEmbeddingConfig` / `resolveAutoIndexingEnabled` call without a `scope` (no unscoped call is allowlisted; tenantless settings readers pass explicit null only for settings resolution); it is the authoritative inventory of runtime readers; isolated external-instance compatibility remains characterized. Test the actual indexer, vector subscribers/worker and both search routes with a registered tenantless catalogue entity and a tenant-capable entity whose job omits its tenant. For the catalogue, applicable token/fulltext paths still work and the vector provider/driver/queue receive no calls. The malformed tenant job and an explicit tenantless vector-only operation refuse before any vector work. An authenticated tenantless settings GET can still read instance/environment defaults.
- **Integration (search, per-module):**
  - Tenant A sets embedding provider/model → Tenant B GET still returns env/instance default (`source: 'env'|'instance'`), never A's value.
  - Tenant A sets Cmd+K strategies → does not change Tenant B.
  - A tenantless principal (superadmin with no tenant selected) POSTs to `/api/search/embeddings` and `/api/search/settings/global-search` → `403`; the instance-default rows are unchanged. Fixtures grant `search.embeddings.view` / `search.embeddings.manage` for the embeddings route and `search.view` / `search.manage` for global search.
  - Unreachable Ollama → provider disabled in UI and POST rejected with reason.
  - `TC-SEARCH-SETTINGS-ISOLATION-001`: create two owned tenants/orgs/records and different same-dimension provider/model fixtures, inject deterministic embeddings through real DI in API/worker processes, pause A's batch and single-record worker operations after resolution, run B's save and workers, then release A. Inspect stored vectors/config selection; each uses its own snapshot. Repeat with A/B reversed and auto-index disabled only for one tenant. Add an auto-index event case: with the instance flag off and tenant A's on (and the reverse for B), a record create/update/delete in each tenant reaches `vector_upsert` / `vector_delete` and enqueues only for the tenant whose own flag is on. Add a reindex/purge interleave: tenant A's `POST /api/search/embeddings/reindex` with `purgeFirst` runs while B's worker operation is paused after resolution; B's snapshot and vectors are unchanged and A's jobs embed under A's snapshot.
  - `TC-SEARCH-SETTINGS-ISOLATION-002`: overlap `/api/search/search` and `/api/search/search/global` for A/B with embeddings settings saves; assert captured embedding config and visible results stay with the authenticated tenant, client-supplied tenants do not override it, inherited source remains correct, and an in-flight operation ignores later saves. Keep singleton reuse enabled. Capture translated errors/progress in the Settings > Search UI.
- Each concurrency test owns all config/map/index/provider fixtures, barriers and process overrides; release blocked operations, stop owned workers, restore DI/environment and remove records, tenant settings, vectors, organizations and tenants in `finally`. Assert actual calls/results after the barriers, never a vacuous empty index.
- Integration tests are self-contained (API-created fixtures, cleaned up in teardown), per `.ai/qa/AGENTS.md` and the per-module colocation rule.

- Within one tenant, pause an old-generation worker after embedding, change to a different same-dimension provider/model and finish the reindex. Release the older worker and assert it cannot overwrite the new vector, affect the new generation's completion, or reappear in queries. Cover historical null generation, inherited changes, cross-tenant isolation, and a driver without generation support. Exercise a crash after settings commit but before generation publication, a configuration changed back to its old values and rolling workers with different defaults. All affected vector paths must refuse stale generations until reconciliation and reindex.

For work proposed under #8593, the GDPR hand-off remains subject to the program DEC-2 written upstream carrier approval. The independent search-settings work retains its own approval route.

## Final Compliance Report

| Rule | Status |
|------|--------|
| Tenant/organization scoping enforced; no cross-tenant exposure | ✅ Core fix |
| Singular naming (entities/events/features) | ✅ No new plural identifiers |
| FK IDs only across modules; no cross-module ORM | ✅ `tenant_id` scalar columns only |
| Contract compatibility per `BACKWARD_COMPATIBILITY.md` | ✅ Existing scope/source/indexes preserved; C1 owns the optional write-version extension |
| Canonical primitives (`makeCrudRoute`/`apiCall`/DI cache/`ModuleConfigService`) | ✅ Reuses existing service + cache |
| Zod validation for API inputs | ✅ Existing search validators extended |
| Encryption maps for sensitive columns | N/A — no new PII columns (secrets stay env-level) |
| Design System tokens / shared primitives | ✅ Required in Phase 4 |
| Config storage and R3-3 prerequisite preserved | Compliant design. No duplicate config migration. Phase 2 adds search-owned generation state and a nullable vector provenance column through driver migrations. |
| Integration coverage for affected API + UI paths | ✅ Test Plan above |

## Changelog

- 2026-11-20 — Specify tenant-safe embedding settings, generation-fenced vector writes and queries, and explicit tenantless catalogue scope.

- 2026-06-15 — Specified scoped `ModuleConfig`, environment defaults and an active cached provider probe. Source contracts: `packages/core/src/modules/configs/*` and `packages/search/src/{modules/search,vector,strategies}/*`.
