# Release Notes

Behavior changes and deprecations that downstream/third-party module developers must know about. See `BACKWARD_COMPATIBILITY.md` for the contract-surface rules.

## Unreleased

### Tenant-scoped search settings + verified provider availability

Spec: `.ai/specs/2026-06-15-tenant-scoped-search-settings.md` (tracking issue #3092).

**What changed**

- **Search settings are now tenant-scoped.** Vector/fulltext search settings (Cmd+K strategies, embedding provider/model, auto-index flag) were stored in a single global `module_configs` row, so any tenant admin's save overwrote every tenant's configuration. Settings are now scoped per tenant: a tenant reads/writes only its own row and inherits the instance default (legacy global row) → env-derived default when unset. Settings GET responses gain a `source: 'tenant' | 'instance' | 'env'` field.
- **`ModuleConfigService` gained an optional `scope` argument** on `getRecord`/`getValue`/`setValue`/`invalidate`. This is additive — every caller that omits `scope` keeps the exact prior behavior (the global row). `ModuleConfigRecord` gained additive `tenantId`/`organizationId`/`source` fields.
- **`module_configs` schema:** added nullable `tenant_id`/`organization_id` columns; replaced the single `(module_id, name)` unique constraint with two partial unique indexes (global `WHERE tenant_id IS NULL`, scoped `WHERE tenant_id IS NOT NULL`). Existing rows keep `tenant_id = NULL` and become the instance default; no backfill required.
- **Provider availability is now verified.** `isProviderConfigured('ollama')` previously returned `true` unconditionally. A new cached, fail-closed `embeddingProviderProbe` actively checks Ollama via `GET {OLLAMA_BASE_URL}/api/tags` (key-presence for the other providers). The embeddings settings GET returns per-provider `available`/`reason`, and the embeddings POST rejects selecting an unreachable provider with `409 { error, reason }`.

**Action required**

- Apply the `configs` module migration (`Migration20260617150000`) before relying on tenant-scoped settings.
- Environments that relied on Ollama always reporting "available" must ensure Ollama is actually reachable at `OLLAMA_BASE_URL` (which was already required for embedding to function).

**Backward compatibility**

- All changes are additive. No event IDs, widget spot IDs, ACL feature IDs, import paths, or CLI commands changed. The vector index (shared pgvector table) remains instance-level; per-tenant scoping covers settings selection, not stored vectors.
