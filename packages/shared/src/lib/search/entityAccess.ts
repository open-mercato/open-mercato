import type { SearchEntityConfig } from '../../modules/search'
import { authorizeFeatures } from '../../security/featurePolicy'

/**
 * Minimal shape of the `searchIndexer` DI service consumed by per-entity ACL
 * resolution. Kept structural so callers and tests can pass a plain object
 * instead of constructing a full `SearchIndexer`.
 */
export type SearchEntityConfigLookup = {
  getEntityConfig: (entityId: string) => SearchEntityConfig | undefined
  getAllEntityConfigs: () => SearchEntityConfig[]
}

export type SearchEntityAccessSubject = {
  grantedFeatures: readonly string[]
  isSuperAdmin?: boolean
}

export type SearchEntityDenyReason =
  /** No module declares this entity in a `search.ts` config. */
  | 'unconfigured'
  /** The entity is configured for search but declares no `aclFeatures`. */
  | 'no-acl-features'
  /** The caller does not hold the entity's declared view feature(s). */
  | 'insufficient-features'

export type SearchEntityAccessOptions = {
  /**
   * Called once per denied entity type. Exists so a silent drop is diagnosable:
   * results disappearing because a module forgot to declare `aclFeatures` looks
   * identical, from the palette, to results that simply did not match.
   */
  onDeny?: (entityId: string, reason: SearchEntityDenyReason) => void
}

/**
 * Decide whether a caller may see results for one entity type.
 *
 * The single `search.global` gate on the palette only says "this user may use
 * global search"; it says nothing about which records they may read. Each entity
 * declares the owning module's view feature(s) in `aclFeatures`, and those are
 * what actually authorize the read — the same rule the `search_get` /
 * `search_aggregate` AI tools already apply.
 *
 * Fails closed: an entity that is not registered for search, or that declares no
 * `aclFeatures`, is never exposed to a non-superadmin caller.
 */
export function canReadSearchEntity(
  entityId: string,
  lookup: SearchEntityConfigLookup,
  subject: SearchEntityAccessSubject,
  options: SearchEntityAccessOptions = {},
): boolean {
  if (subject.isSuperAdmin) return true

  const config = lookup.getEntityConfig(entityId)
  if (!config) {
    options.onDeny?.(entityId, 'unconfigured')
    return false
  }

  const required = config.aclFeatures
  if (!required || required.length === 0) {
    options.onDeny?.(entityId, 'no-acl-features')
    return false
  }

  const allowed = authorizeFeatures(required, {
    grantedFeatures: subject.grantedFeatures,
    unrestricted: false,
  })
  if (!allowed) options.onDeny?.(entityId, 'insufficient-features')
  return allowed
}

/**
 * The entity types this caller may read, narrowed to `requestedEntityTypes` when
 * the caller asked for specific ones.
 *
 * Restricting the query up front is what keeps `limit` meaningful. Filtering only
 * after the search would spend the whole result budget on records the caller
 * cannot see: an employee granted just `customers.people.view` would get the top
 * 50 hits across every entity type, then watch most of them be dropped, and the
 * palette would look empty even with hundreds of matching people behind it.
 *
 * Returns `undefined` when no restriction applies (superadmin with no explicit
 * request), and an empty array when nothing is readable — callers should
 * short-circuit on that rather than pass it down as "no filter".
 */
export function resolveReadableEntityTypes(
  lookup: SearchEntityConfigLookup,
  subject: SearchEntityAccessSubject,
  requestedEntityTypes?: string[],
): string[] | undefined {
  if (subject.isSuperAdmin) return requestedEntityTypes

  const readable = lookup
    .getAllEntityConfigs()
    .filter((config) => config.enabled !== false)
    .map((config) => config.entityId)
    .filter((entityId) => canReadSearchEntity(entityId, lookup, subject))

  if (!requestedEntityTypes) return readable
  const requested = new Set(requestedEntityTypes)
  return readable.filter((entityId) => requested.has(entityId))
}

/**
 * Drop the results whose entity type the caller is not allowed to read.
 *
 * Filtering happens server-side so an under-privileged caller never receives the
 * presenter title, subtitle or deep link of a record they cannot open. Decisions
 * are memoized per entity type because a single response commonly mixes dozens of
 * results across a handful of types.
 */
export function filterSearchResultsByEntityAccess<T extends { entityId: string }>(
  results: readonly T[],
  lookup: SearchEntityConfigLookup,
  subject: SearchEntityAccessSubject,
  options: SearchEntityAccessOptions = {},
): T[] {
  if (subject.isSuperAdmin) return [...results]

  const decisions = new Map<string, boolean>()
  return results.filter((result) => {
    const cached = decisions.get(result.entityId)
    if (cached !== undefined) return cached
    const allowed = canReadSearchEntity(result.entityId, lookup, subject, options)
    decisions.set(result.entityId, allowed)
    return allowed
  })
}
