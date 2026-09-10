/**
 * The narrow exception to the rule `reindexEntity` enforces: entity types whose
 * source table has no `tenant_id` column BECAUSE the rows are one platform-wide
 * catalogue that every tenant is meant to read.
 *
 * For these, sweeping the whole table and stamping the result with the caller's
 * tenant is the intended behaviour, and it is also the only thing that makes
 * them findable at all. Both readers filter on an exact tenant with no NULL
 * branch — `TokenSearchStrategy.search()` and `createPresenterEnricher()`'s
 * `fetchDocsBatch()` in `@open-mercato/search`. The enricher does have
 * `organization_id = X OR organization_id IS NULL`; there is no tenant
 * counterpart anywhere, so a NULL tenant stamp is invisible, not global.
 *
 * Everything else with no `tenant_id` column fails closed, INCLUDING entity
 * types nobody has classified yet. That is the point of expressing this as an
 * allowlist over a derived condition rather than as a denylist of known-private
 * tables: a tenant-less entity type introduced by a later release is refused on
 * arrival instead of quietly leaking until someone notices.
 *
 * The bar for admitting an entity type is "is every tenant MEANT to read every
 * row", not "a reindex started refusing it". Of the fourteen entity types in
 * this repository whose table has no `tenant_id` column, exactly one clears it;
 * the other thirteen are private rows that must fail closed —
 * `directory:tenant` (one row per tenant, `name` tokenised),
 * `auth:user_role`, `auth:session`, `auth:password_reset`,
 * `customers:customer_deal_person_link`, `messages:message_recipient` and the
 * rest of that shape.
 */
const CORE_TENANT_GLOBAL_ENTITY_TYPES: readonly string[] = [
  // No `tenant_id`; `feature_toggle_overrides` carries the per-tenant value.
  // Its `default_value` is `jsonb`, which contributes no tokens.
  'feature_toggles:feature_toggle',
]

const tenantGlobalEntityTypes = new Set<string>(CORE_TENANT_GLOBAL_ENTITY_TYPES)

function normalize(entityType: string): string {
  return String(entityType || '').trim()
}

/**
 * Declare that an entity type outside this package is a platform-wide catalogue.
 *
 * Modules shipped as their own package — and apps with their own tenant-less
 * catalogue tables — cannot be listed above, so they opt in here. Call it during
 * module registration (a module's `di.ts` is the usual place), before any
 * reindex job runs.
 *
 * Forgetting the call is safe in the only direction that matters: the entity
 * type simply keeps failing closed, and `reindexEntity` logs a warning naming
 * it, so the missing declaration is diagnosable from the log rather than from a
 * cross-tenant search result.
 */
export function registerTenantGlobalEntityTypes(...entityTypes: string[]): void {
  for (const entityType of entityTypes) {
    const normalized = normalize(entityType)
    if (normalized) tenantGlobalEntityTypes.add(normalized)
  }
}

/** True when a table with no `tenant_id` column may be swept by a tenant-scoped reindex. */
export function isTenantGlobalEntityType(entityType: string): boolean {
  return tenantGlobalEntityTypes.has(normalize(entityType))
}

/** The current allowlist, for diagnostics and tests. */
export function listTenantGlobalEntityTypes(): string[] {
  return Array.from(tenantGlobalEntityTypes)
}

/** Test-only: drop every registration and restore this package's own entries. */
export function resetTenantGlobalEntityTypes(): void {
  tenantGlobalEntityTypes.clear()
  for (const entityType of CORE_TENANT_GLOBAL_ENTITY_TYPES) tenantGlobalEntityTypes.add(entityType)
}
