# Plan — Tenant-Scoped Search Settings (implementation)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 0 | 0.1 | Seed run folder (PLAN/HANDOFF/NOTIFY) | done | b960486b8 |
| 1 | 1.1 | `module_configs` scope columns + partial unique indexes (entity + migration + snapshot) | done | 5c33bf349 |
| 1 | 1.2 | `ModuleConfigService` scope-aware (resolution order, scoped writes, v2 cache keys) | todo | — |
| 1 | 1.3 | Unit tests: scoped→global→null resolution, scoped-write isolation, BC default path, cache keying | todo | — |
| 2 | 2.1 | Thread auth `tenantId` into embedding/global-search/auto-index resolve+save flows | todo | — |
| 2 | 2.2 | Env-derived defaults + `source` discriminator in GET responses | todo | — |
| 2 | 2.3 | Integration tests (search): Tenant A save ↛ Tenant B; unset inherits env/instance | todo | — |
| 3 | 3.1 | `EmbeddingProviderProbe` (Ollama `/api/tags` probe, key-presence others), cached + fail-closed + DI | todo | — |
| 3 | 3.2 | Wire `isProviderConfigured`/`EmbeddingService.available`/`VectorSearchStrategy.isAvailable` + POST save guard | todo | — |
| 3 | 3.3 | Unit tests: Ollama reachable/unreachable/timeout, availability propagation, save guard | todo | — |
| 4 | 4.1 | UI: provider cards reflect real availability (disable + reason), `source`/inheritance, Refresh (DS-compliant) | todo | — |
| 4 | 4.2 | Integration test: unreachable provider blocked in UI + rejected by API | todo | — |
| 4 | 4.3 | Docs: `packages/search/AGENTS.md`, `packages/core/AGENTS.md`, RELEASE_NOTES | todo | — |

Source spec: `.ai/specs/2026-06-15-tenant-scoped-search-settings.md` (PR #3093, tracking issue #3092)

## Goal

Make vector/fulltext search **settings** tenant-scoped (fix cross-tenant overwrite of the global `module_configs` row), inherit unset settings from env-derived defaults, and replace presence-only provider detection with a real, cached, fail-closed availability probe.

## Scope

- `packages/core/src/modules/configs/` — generalised tenant scoping for `ModuleConfig` / `ModuleConfigService` (additive, BC-safe).
- `packages/search/src/modules/search/` + `packages/search/src/vector` + `packages/search/src/strategies` — thread tenant scope through the three search settings flows, env-derived defaults, provider probe, UI.

## Non-goals

- Per-tenant secrets (API keys stay env/instance-level).
- New vector stores or embedding providers.
- Search **result** scoping (already SPEC-041).
- Superadmin instance-default editing UI.
- Deep key validation for env-key providers (R7 — follow-up).

## Risks (brief)

- R1 Postgres NULL-distinct → duplicate global rows. Mitigate with two partial unique indexes (global `WHERE tenant_id IS NULL`, scoped `WHERE tenant_id IS NOT NULL`).
- R2 Cross-tenant read leak. Resolution order scoped→global→env; writes always scoped to auth tenant; A↛B integration test.
- R3 `ModuleConfigService` signature change breaks ~51 existing callers. Mitigate: `scope` is optional; no-scope path byte-for-byte preserved; `restoreDefaults` untouched.
- R4 Probe latency blocks settings page. Bounded timeout (~1500ms), short-TTL cache (~30s), fail-closed.
- R5 Stale cache. `v2` key namespace + scope-aware invalidate.

## External References

- None (`--skill-url` not used).

## Implementation Plan

### Phase 0 — Seed

- 0.1 Add run folder (PLAN/HANDOFF/NOTIFY) and push so the run is resumable.

### Phase 1 — Generalised `ModuleConfig` tenant scoping (core)

- 1.1 Add nullable `tenant_id`/`organization_id` columns to the `ModuleConfig` entity; drop the single `module_configs_module_name_unique` constraint; add partial unique indexes `module_configs_global_unique` (`WHERE tenant_id IS NULL`) and `module_configs_scoped_unique` (`WHERE tenant_id IS NOT NULL`) plus a non-unique `(module_id, name, tenant_id)` lookup index. Author the scoped SQL migration and update `migrations/.snapshot-open-mercato.json`.
- 1.2 Make `ModuleConfigService` scope-aware: `ConfigScope` type; optional `scope` on `getRecord`/`getValue`/`setValue`/`invalidate`; resolution order scoped→global→null; scoped writes never touch the global row; `v2` scope-aware cache key; `source` marker on the record. Preserve the no-scope path and `restoreDefaults` exactly.
- 1.3 Unit tests for the above (resolution, isolation, BC path, cache keying/invalidation).

### Phase 2 — Tenant-scoped search settings + env-derived defaults

- 2.1 Thread the authenticated `tenantId` (from auth context only) into `resolveEmbeddingConfig`/`saveEmbeddingConfig`, `resolveGlobalSearchStrategies`/`saveGlobalSearchStrategies`, and the auto-index flag flow.
- 2.2 Compute env-derived defaults (narrow `DEFAULT_EMBEDDING_CONFIG` via `getConfiguredProviders()`); add `source: 'tenant' | 'instance' | 'env'` to GET responses.
- 2.3 Per-module integration tests under `packages/search/src/modules/search/__integration__`.

### Phase 3 — Verified provider availability

- 3.1 `EmbeddingProviderProbe` with `checkAvailability(providerId)`; Ollama `/api/tags` with `AbortController` timeout; key-presence for the rest; cached (global key, ~30s TTL) + fail-closed; DI registration.
- 3.2 Wire `isProviderConfigured`/`EmbeddingService.available`/`VectorSearchStrategy.isAvailable` to the probe; reject unavailable provider in `POST /api/search/embeddings`.
- 3.3 Unit tests for probe + propagation + save guard.

### Phase 4 — UI + docs

- 4.1 Provider cards reflect real availability (disable + reason), surface `source`/inheritance + Refresh control, DS-compliant.
- 4.2 Integration test: unreachable provider blocked in UI and rejected by API.
- 4.3 Update `packages/search/AGENTS.md`, `packages/core/AGENTS.md`, RELEASE_NOTES.

## Environment / fork notes

- Fork workflow: push to `fork` (`adeptofvoltron/open-mercato`); PR via `gh pr create --repo open-mercato/open-mercato --base develop --head adeptofvoltron:feat/tenant-scoped-search-settings-impl`.
- Upstream gives this account no triage perms → label/assignee/review steps degrade to **comments only** + documented self-review.
- Node 24 required (`export PATH="/home/bernard/.nvm/versions/node/v24.16.0/bin:$PATH"`).
- Branch stacked on `origin/fix/tenant-scoped-search-settings` (spec PR #3093) — the implementation PR depends on #3093 merging; until then its diff also shows the spec files.
