# Preserve the shared vector index during tenant embedding updates

- Status: Implemented; validation and review recorded on the issue PR.
- Scope: OSS bug fix, issue [#8676](https://github.com/open-mercato/open-mercato/issues/8676).
- Related: [Tenant-scoped search settings](2026-06-15-tenant-scoped-search-settings.md).

## Problem and decision

Tenant embedding settings called the instance-wide pgvector recreation method whenever a provider, model, or dimension change required reindexing. That method drops shared vector and migration tables, removing every tenant's derived search data.

Keep the existing instance-level, fixed-dimension vector column. The tenant settings route must never recreate, resize, purge, or drop the index. Compatible changes save only authenticated tenant settings and retain the existing `reindexRequired` response to request an explicit reindex. Existing vector rows remain until the normal tenant-scoped reindex workflow replaces them.

An effective dimension (`outputDimensionality ?? dimension`) that differs from the physical shared index returns HTTP 409 before any settings write. An unavailable driver, missing table, or unreadable dimension returns HTTP 503 before writes. Index initialization and changes to its dimension remain operator responsibilities; tenant settings do not initialize or resize shared tables.

Validate companion auto-index settings before writes. Save both settings in the request EntityManager transaction; invalidate scoped configuration caches if persistence rolls back. Update the embedding runtime only after successful persistence.

## Migration & Backward Compatibility

No schema, driver interface, DI key, route, ACL, request shape, or response shape changes. The explicit instance-level `recreateWithDimension` driver method remains available to its existing callers. Existing HTTP 409/503 error envelopes cover rejected configuration. The dimension rejection enforces a constraint already imposed by the shared database column and prevents the cross-tenant destructive side effect; tenants cannot use settings to resize the instance index. No migration or deprecation bridge is needed.

Clients should surface the localized conflict error and choose a compatible model/output dimension. Operators must initialize an unavailable index through the existing instance setup and coordinate any intentional dimension migration outside tenant settings. This fix does not redesign per-tenant embedding execution or provide automatic reindexing.

## Regression coverage

- Real POST route: compatible model/provider/effective-dimension changes, unchanged config, first override, incompatible dimension, unavailable table/catalog, rollback and concurrent incompatible requests.
- PostgreSQL + pgvector + real `ModuleConfigService`: seed two tenants; prove B is searchable before and after A updates; verify both tenants' vectors, B settings and migration markers remain; assert no destructive index SQL during settings updates.
- Force a real database constraint failure after the embedding settings write; verify transaction rollback. Exercise simultaneous successful tenant updates and concurrent rollback/success isolation.
- Preserve the existing Ollama URL validation tests.

The PostgreSQL suite uses `OM_SEARCH_PGVECTOR_TEST_URL`, unique fixture schema/table names, and teardown. It needs a disposable PostgreSQL database with pgvector available and creates all fixtures itself; it never relies on application seed data.

## Changelog

- 2026-11-04 — Fix #8676 by removing shared recreation from tenant settings, rejecting incompatible dimensions, and persisting companion settings atomically; add route and real database regressions.
