# Vector-index entity authorization

## Scope

Apply the existing search entity view policy to `GET /api/search/index` (#10693). Resolve permissions in the effective tenant and organization scope. Preserve the index list response shape and purge behavior.

## Behavior

Load the caller's entity grants for each explicitly scoped organization. For a tenant-wide request, use the tenant-wide ACL. Preserve the superadmin behavior of the shared entity policy within approved scopes. Filter the pgvector query by the readable sets before applying its offset and limit. Check returned tenant, organization and entity at the response boundary for all drivers. An empty permitted set returns an empty page. An unavailable authorization service returns the existing service-unavailable response.

## Integration coverage

Extend `TC-SEARCH-003` to verify that a caller with only `search.view` receives empty pages when listing the index or requesting a specific entity. Route and driver tests cover authorized explicit entities, wildcard features, mixed organizations, pagination and responses from a driver that omits its filters.

## Migration & Backward Compatibility

The existing list URL, method, query and response shape remain valid. Pages now exclude records from entities the caller cannot view and are numbered after that exclusion on the built-in driver. `VectorDriverListParams.entityAccess` is an optional driver filter. An entry with a null organization represents tenant-wide scope, and a null entity list permits all entity types in that scope. Existing drivers can keep their method signature.

The old listing cannot be offered during deprecation because it would still expose entries outside the caller's permissions. The emergency exception requires named maintainer approval before merge. See [client and operator migration](../../UPGRADE_NOTES.md#vector-index-entity-authorization-10693).

## Changelog

- 2026-11-26 — Define readable vector index pages and regression coverage.
