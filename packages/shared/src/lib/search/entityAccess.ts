import type { SearchEntityConfig } from '../../modules/search'
import { authorizeFeatures } from '../../security/featurePolicy'

export type SearchEntityConfigLookup = {
  getEntityConfig: (entityId: string) => SearchEntityConfig | undefined
  getAllEntityConfigs: () => SearchEntityConfig[]
}

export type SearchEntityAccessSubject = {
  grantedFeatures: readonly string[]
  isSuperAdmin?: boolean
}

export type SearchEntityDenyReason =
  | 'unconfigured'
  | 'no-acl-features'
  | 'insufficient-features'

export type SearchEntityAccessOptions = {
  onDeny?: (entityId: string, reason: SearchEntityDenyReason) => void
}

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
