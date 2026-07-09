# Tenant-Scoped Search Settings, Env-Derived Defaults, and Verified Provider Availability

- **Status:** Draft (pending implementation)
- **Scope:** OSS
- **Author:** spec-writing (auto)
- **Date:** 2026-06-15
- **Related:** `.ai/specs/implemented/SPEC-041-2026-02-24-search-organization-scoping.md` (scopes search **results**, not **settings**), `.ai/runs/2026-04-23-disable-vector-search-indexing-by-default.md`

## TLDR

Vector and fulltext search **settings** are stored in the global `module_configs` table with no tenant scoping, so when any tenant admin saves the embedding provider, the Cmd+K strategy set, or the auto-indexing flag, the single global row is overwritten for **every** tenant on the instance. On a multi-tenant demo instance this means one tenant's onboarding silently rewrites another's search configuration. Separately, the Ollama provider is reported as "available" unconditionally (`isProviderConfigured('ollama')` returns `true` with no reachability check), so operators can select a provider that is not actually running and only discover the failure at embedding time.

This spec makes search settings **tenant-scoped** by adding optional `tenant_id`/`organization_id` scoping to the shared `ModuleConfig` infrastructure (additive, BC-safe), resolves unset settings from **env-derived defaults** (with existing global rows acting as the instance default), and replaces presence-only provider detection with a **real, cached availability probe** that fails closed and disables un-reachable providers in the UI.

## Locked Decisions (Open Questions gate, 2026-06-15)

| # | Question | Decision |
|---|----------|----------|
| Q1 | How to introduce tenant scoping? | **Scope `ModuleConfig` generally** — add optional `tenant_id`/`organization_id` to `module_configs` + `ModuleConfigService`; scoped lookup with global fallback; migrate search keys to scoped reads/writes. Reusable by all modules. |
| Q2 | What does an unset tenant inherit? | **Env-derived defaults only** — an unset tenant inherits read-only defaults computed from env vars; existing global rows remain as the instance default/backfill. No new superadmin instance-default editing surface. |
| Q3 | How is provider availability verified? | **Active probe, cached** — per-provider `isAvailable()` health probe (e.g. Ollama reachability), short-TTL cached, fail-closed; UI disables unreachable providers. |

## Problem Statement

### P1 — Cross-tenant settings overwrite (data-isolation defect)

`ModuleConfig` (`packages/core/src/modules/configs/data/entities.ts`) is global:

```text
@Entity({ tableName: 'module_configs' })
@Unique({ name: 'module_configs_module_name_unique', properties: ['moduleId', 'name'] })
```

`ModuleConfigService` (`packages/core/src/modules/configs/lib/module-config-service.ts`) reads and writes purely by `(moduleId, name)`:

- `getRecord` → `repo.findOne({ moduleId, name })` (no scope) — `module-config-service.ts:112`
- `setValue` → `repo.findOne({ moduleId, name })` then create/update one row — `module-config-service.ts:136`

The search module persists three settings through this service, all unscoped:

| Setting | Key (`moduleId`/`name`) | Read/Write site |
|---------|-------------------------|-----------------|
| Embedding provider/model | `vector` / `embedding_config` | `packages/search/src/modules/search/lib/embedding-config.ts:136,153` (`resolveEmbeddingConfig` / `saveEmbeddingConfig`), API `packages/search/src/modules/search/api/embeddings/route.ts` |
| Global (Cmd+K) strategies | `search` / `global_search_strategies` | `packages/search/src/modules/search/lib/global-search-config.ts`, API `packages/search/src/modules/search/api/settings/global-search/route.ts:40,78` |
| Vector auto-indexing flag | `vector` / `SEARCH_AUTO_INDEX_CONFIG_KEY` | `packages/search/src/modules/search/api/embeddings/route.ts:189` |

Result: a `search.manage` admin in Tenant A writes the global row and changes Tenant B's search behavior. Note that `packages/search/AGENTS.md` already **claims** "Set global search dialog strategies **per-tenant**" — the documentation describes behavior the implementation does not provide. This spec makes the documented contract true.

### P2 — Provider availability is not verified

`isProviderConfigured` (`packages/search/src/modules/search/lib/embedding-config.ts:86`) gates every non-Ollama provider on env-var presence but returns `true` for Ollama unconditionally:

```text
case 'ollama':
  return true
```

`EmbeddingService.available` (`packages/search/src/vector/services/embedding.ts:82`) and `VectorSearchStrategy.isAvailable` (`packages/search/src/strategies/vector.strategy.ts:61`) propagate this, and the Ollama client is created against `OLLAMA_BASE_URL ?? 'http://localhost:11434'` with no health check (`embedding.ts:158`). The UI (`packages/search/src/modules/search/frontend/components/sections/VectorSearchSection.tsx`) therefore shows Ollama as selectable even when nothing is listening, and failures surface only when an embedding call is attempted. Env-key presence for the other providers is also weak: a present-but-invalid key still reports "available".

## Goals / Non-Goals

**Goals**
- Each tenant has its own search settings; one tenant's change never affects another.
- Unset tenants resolve to env-derived defaults; existing global rows continue to act as the instance default during and after migration.
- Provider availability reflects real reachability/validity, is cached, fails closed, and disables unavailable providers in the UI and at save time.
- Keep `ModuleConfig` / `ModuleConfigService` / search API surfaces backward-compatible (additive only).

**Non-Goals**
- Per-tenant **secrets** (API keys remain env-level/instance-level; this spec scopes *selection and toggles*, not credential storage).
- Adding new vector stores or embedding providers.
- Changing search **result** scoping (already covered by SPEC-041).
- A superadmin instance-default editing UI (explicitly out by Q2).

## Proposed Solution

### Architecture overview

```
Request (authenticated: tenantId, organizationId, features)
        │
        ▼
Search settings API (embeddings / global-search / auto-index)
        │  scope = { tenantId } from auth context (NEVER client-supplied)
        ▼
ModuleConfigService.getValue/setValue(moduleId, name, { scope })
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

Add nullable scope columns to `module_configs` and make `ModuleConfigService` scope-aware while preserving the existing unscoped call path.

- Entity gains `organization_id uuid null` and `tenant_id uuid null`.
- The single global unique constraint is replaced by **two partial unique indexes** to avoid the Postgres "NULLs are distinct" pitfall:
  - `module_configs_global_unique` — `UNIQUE (module_id, name) WHERE tenant_id IS NULL` (preserves today's invariant for global/instance rows).
  - `module_configs_scoped_unique` — `UNIQUE (module_id, name, tenant_id) WHERE tenant_id IS NOT NULL`.
- `organization_id` is stored for completeness; **search settings resolve at tenant grain** (`organizationId` is `null` for these rows). The service supports org-grain for future callers but search does not use it.

`ModuleConfigService` (additive signature change):

```ts
type ConfigScope = { tenantId?: string | null; organizationId?: string | null }

getRecord(moduleId, name, scope?: ConfigScope): Promise<ModuleConfigRecord | null>
getValue<T>(moduleId, name, options?: { defaultValue?: T | null; scope?: ConfigScope }): Promise<T | null>
setValue(moduleId, name, value, scope?: ConfigScope): Promise<ModuleConfigRecord | null>
invalidate(moduleId, name?, scope?: ConfigScope): Promise<void>
```

- **Resolution order** in `getRecord` when `scope.tenantId` is present: scoped row → global row (`tenant_id IS NULL`) → not found. The returned record carries an internal `source` marker so callers can expose it.
- **`setValue` with a scope** writes/updates only the scoped row (`tenant_id = scope.tenantId`); it never touches the global row. **`setValue` without a scope** keeps today's behavior (global row), so existing non-search callers are unchanged.
- **Cache key** becomes scope-aware and the version is bumped: `module-config:v2:${moduleId}:${name}:${tenantId ?? 'global'}`. `invalidate` clears the specific scope key; module-tag invalidation is unchanged.

This is fully additive: every current caller that omits `scope` behaves exactly as before.

### 2. Tenant-scoped search settings + env-derived defaults (Q2)

Thread the authenticated `tenantId` into the three search settings flows:

- `resolveEmbeddingConfig(resolver, { scope, defaultValue })` and `saveEmbeddingConfig(resolver, config, { scope })` pass the scope through to `ModuleConfigService`. When neither a tenant nor an instance row exists, the resolver computes the **env-derived default**: `DEFAULT_EMBEDDING_CONFIG` (`packages/search/src/vector/types.ts`) narrowed to the first env-configured provider via `getConfiguredProviders()`.
- `resolveGlobalSearchStrategies` / `saveGlobalSearchStrategies` and the auto-index flag flow take the same scope treatment.
- Reads return a `source: 'tenant' | 'instance' | 'env'` discriminator so the UI can show whether the tenant is using its own config or inheriting.
- **Isolation invariant:** the API derives `tenantId` from the auth context only. A client-supplied tenant is ignored. `search.manage` continues to gate writes; a tenant admin can only ever read/write its own scoped row (or read the inherited default).
- **Migration semantics:** existing global rows (`tenant_id IS NULL`) remain untouched and act as the instance default. The first tenant save creates a tenant-scoped row; until then the tenant transparently inherits. No data backfill is required, and no tenant inherits another tenant's choices.

### 3. Verified, cached provider availability (Q3)

Introduce an `EmbeddingProviderProbe` (DI-registered in the search module) exposing `checkAvailability(providerId): Promise<{ available: boolean; reason?: string; models?: number }>`:

- **Ollama:** GET `${OLLAMA_BASE_URL ?? 'http://localhost:11434'}/api/tags` with a bounded timeout (≈1500 ms, `AbortController`). Available only on a successful response; `models` is taken from the tags payload. Unreachable → `{ available: false, reason: 'Not reachable at <baseUrl>' }`.
- **Key-based providers (openai, google, mistral, cohere, bedrock):** keep env-key presence as the baseline gate (cheap, no surprise network/billing calls). Optionally a lightweight, opt-in validation can be layered later; presence remains the default availability signal but reported via the probe so all providers share one code path.
- **Caching & safety:** results cached via the DI cache strategy under a global (tenant-independent) key with a short TTL (≈30 s); probe is `try/catch` fail-closed (any error → unavailable) and never throws into request handling. A manual "Refresh" bypasses the cache.
- `isProviderConfigured('ollama')` no longer returns `true` unconditionally; `EmbeddingService.available` and `VectorSearchStrategy.isAvailable` consult the probe so search availability and the providers list agree.
- **Save-time guard:** `POST /api/search/embeddings` rejects selecting a provider whose probe reports unavailable (`409`/`422` with `reason`), so the UI and API agree and a dead provider can never be persisted.

## Data Models

`module_configs` (changed — additive columns + index swap):

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | unchanged |
| `module_id` | text | unchanged |
| `name` | text | unchanged |
| `value_json` | json null | unchanged |
| `organization_id` | uuid **null** | **new** — scope (unused by search; tenant grain only) |
| `tenant_id` | uuid **null** | **new** — scope; `NULL` = global/instance default |
| `created_at` / `updated_at` | timestamptz | unchanged |

Indexes: drop `module_configs_module_name_unique`; add partial `module_configs_global_unique` (`WHERE tenant_id IS NULL`) and `module_configs_scoped_unique` (`WHERE tenant_id IS NOT NULL`). Add a non-unique lookup index on `(module_id, name, tenant_id)`.

No new entities. `EmbeddingProviderConfig` (`packages/search/src/vector/types.ts`) is unchanged on the wire; responses gain a sibling `source` field, not a config field.

## API Contracts

All routes are tenant-scoped via the auth context; `tenantId` is never read from the request body/query.

| Endpoint | Method | Permission | Change |
|----------|--------|------------|--------|
| `/api/search/embeddings` | GET | `search.view` | Returns the tenant-resolved config + `source`; provider list carries `available` + `reason` from the probe. |
| `/api/search/embeddings` | POST | `search.manage` | Writes only the tenant-scoped row; **rejects** an unavailable provider with a structured reason. |
| `/api/search/settings/global-search` | GET / POST | `search.view` / `search.manage` | Tenant-scoped read/write; GET adds `source`. |
| `/api/search/settings` | GET | `search.view` | Per-strategy `available` reflects the probe (vector availability is real, not assumed). |
| auto-index flag (within `/api/search/embeddings` POST) | POST | `search.manage` | Tenant-scoped. |

Response additions are backward-compatible (new fields only). Zod validators live in the search module; provider id remains a closed enum.

## UI

`SearchSettingsPageClient.tsx` / `VectorSearchSection.tsx` / `GlobalSearchSection.tsx`:

- Provider cards render from probe results: an unavailable provider (e.g. Ollama with nothing listening) is **disabled** (not selectable) with a reason surfaced via tooltip/helper text, instead of an unconditional "Active" checkmark.
- The configuration panel indicates whether the tenant is using its **own** settings or **inheriting** the instance/env default (`source`), with an affordance to start overriding.
- A "Refresh" control re-probes (cache bypass).
- Design System compliance: availability/status uses semantic status tokens (`{property}-status-{status}-{role}`), never hardcoded `text-red-*` / `bg-green-*`; no arbitrary text sizes; lucide-react icons; dialogs keep `Cmd/Ctrl+Enter` submit and `Escape` cancel; icon-only buttons carry `aria-label`. Boy Scout rule applies to any touched lines.

## Migration & Backward Compatibility

Contract surfaces touched (per `BACKWARD_COMPATIBILITY.md`): **DB schema** (`module_configs`), **DI/types** (`ModuleConfigService`), **API routes** (search settings). All changes are additive:

- **Schema:** new nullable columns + partial unique indexes via a `configs`-module migration; update `migrations/.snapshot-open-mercato.json` in the same change. Existing rows keep `tenant_id = NULL` and remain valid (now interpreted as the instance default). No backfill.
- **`ModuleConfigService`:** `scope` is an optional parameter; the no-scope path is byte-for-byte the prior behavior. Cache version bump (`v1`→`v2`) avoids stale cross-version reads.
- **Search APIs:** only add response fields and tenant scoping of writes; request shapes are unchanged. The previously-global behavior is replaced by per-tenant behavior — this is the intended bug fix, documented in UPGRADE_NOTES with the cross-tenant-overwrite rationale.
- **Provider availability:** `isProviderConfigured('ollama')` changes from always-true to probe-backed. Documented as a behavior fix; environments that relied on the false-positive must ensure Ollama is actually reachable (which was already required for it to function).

No event IDs, widget spot IDs, ACL feature IDs, import paths, or CLI commands change.

## Risks & Impact Review

| # | Risk | Severity | Area | Mitigation | Residual |
|---|------|----------|------|------------|----------|
| R1 | Postgres treats NULLs as distinct → duplicate global rows | High | DB | Partial unique indexes split global vs scoped | Low |
| R2 | A settings read leaks another tenant's row | High | Tenant isolation | Resolution order is scoped→global→env; writes always scoped to auth tenant; integration test asserts A↛B | Low |
| R3 | `ModuleConfigService` change breaks existing callers | Medium | Core contract | `scope` optional; no-scope path unchanged; unit test covers default path | Low |
| R4 | Probe latency blocks settings page / search | Medium | UX/perf | Bounded timeout, short-TTL cache, async, fail-closed | Low |
| R5 | Stale cache after version bump or scope write | Medium | Cache | `v2` key namespace + scope-aware invalidate on write | Low |
| R6 | Operators relying on always-available Ollama see it disabled | Low | Behavior | Documented in UPGRADE_NOTES; reason string explains how to fix reachability | Low |
| R7 | Env-key providers still report available with an invalid key | Low | Provider check | Out of scope here; presence-gate retained, optional deep validation noted as follow-up | Accepted |

## Phasing

### Phase 1 — Generalised `ModuleConfig` tenant scoping (core)
- 1.1 Add `tenant_id`/`organization_id` columns + partial unique indexes to `module_configs`; migration + snapshot.
- 1.2 Make `ModuleConfigService` scope-aware (resolution order, scoped writes, `v2` cache keys) with the no-scope path preserved.
- 1.3 Unit tests: scoped→global→null resolution, scoped write isolation, BC default path, cache keying/invalidation.

### Phase 2 — Tenant-scoped search settings + env-derived defaults
- 2.1 Thread auth `tenantId` into `resolveEmbeddingConfig`/`saveEmbeddingConfig`, global-search strategies, and the auto-index flag.
- 2.2 Compute env-derived defaults and add the `source` discriminator to GET responses.
- 2.3 Integration tests (per-module, `packages/search/src/modules/search/__integration__`): Tenant A save does not change Tenant B; unset tenant inherits env/instance default.

### Phase 3 — Verified provider availability
- 3.1 Add `EmbeddingProviderProbe` (Ollama reachability via `/api/tags`, key-presence for the rest), cached + fail-closed; DI registration.
- 3.2 Wire `isProviderConfigured`/`EmbeddingService.available`/`VectorSearchStrategy.isAvailable` to the probe; add save-time rejection of unavailable providers.
- 3.3 Unit tests: reachable/unreachable/timeout for Ollama; availability propagation; save guard.

### Phase 4 — UI + docs
- 4.1 Provider cards reflect real availability (disable + reason); surface `source`/inheritance + Refresh; DS-compliant.
- 4.2 Integration test: selecting an unreachable provider is blocked in UI and rejected by API.
- 4.3 Update `packages/search/AGENTS.md` (the per-tenant claim is now accurate), `packages/core/AGENTS.md` (`ModuleConfigService` scope option), and UPGRADE_NOTES.

## Test Plan / Integration Coverage

- **Unit (core):** `ModuleConfigService` scoped resolution, scoped-write isolation, BC no-scope path, cache `v2` keying/invalidation, partial-unique behavior.
- **Unit (search):** env-derived default computation; provider probe (Ollama reachable/unreachable/timeout, key-based presence); availability propagation; POST save guard.
- **Integration (search, per-module):**
  - Tenant A sets embedding provider/model → Tenant B GET still returns env/instance default (`source: 'env'|'instance'`), never A's value.
  - Tenant A sets Cmd+K strategies → does not change Tenant B.
  - Unreachable Ollama → provider disabled in UI and POST rejected with reason.
- Integration tests are self-contained (API-created fixtures, cleaned up in teardown), per `.ai/qa/AGENTS.md` and the per-module colocation rule.

## Final Compliance Report

| Rule | Status |
|------|--------|
| Tenant/organization scoping enforced; no cross-tenant exposure | ✅ Core fix |
| Singular naming (entities/events/features) | ✅ No new plural identifiers |
| FK IDs only across modules; no cross-module ORM | ✅ `tenant_id` scalar columns only |
| Additive contract changes per `BACKWARD_COMPATIBILITY.md` | ✅ Optional scope, new response fields, partial indexes |
| Canonical primitives (`makeCrudRoute`/`apiCall`/DI cache/`ModuleConfigService`) | ✅ Reuses existing service + cache |
| Zod validation for API inputs | ✅ Existing search validators extended |
| Encryption maps for sensitive columns | N/A — no new PII columns (secrets stay env-level) |
| Design System tokens / shared primitives | ✅ Required in Phase 4 |
| Migration + snapshot included | ✅ Phase 1 |
| Integration coverage for affected API + UI paths | ✅ Test Plan above |

## Changelog

- 2026-06-15 — Initial draft. Locked Q1 (scope `ModuleConfig` generally), Q2 (env-derived defaults), Q3 (active cached provider probe). Grounded in `packages/core/src/modules/configs/*` and `packages/search/src/{modules/search,vector,strategies}/*`.
