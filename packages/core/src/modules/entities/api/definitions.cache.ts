import type { CacheStrategy } from '@open-mercato/cache'

const CACHE_PREFIX = 'entities:definitions'
export const ENTITY_DEFINITIONS_CACHE_TTL_MS = 5 * 60 * 1000

type CacheKeyOptions = {
  tenantId: string | null | undefined
  organizationId: string | null | undefined
  entityIds: string[]
}

function normalizeTenantId(tenantId: string | null | undefined): string {
  return tenantId ?? 'global'
}

function normalizeOrganizationId(organizationId: string | null | undefined): string {
  return organizationId ?? 'none'
}

export function createDefinitionsCacheKey(options: CacheKeyOptions): string {
  const tenant = normalizeTenantId(options.tenantId)
  const organization = normalizeOrganizationId(options.organizationId)
  const scope = options.entityIds.join('|')
  return `${CACHE_PREFIX}:${tenant}:${organization}:entities=${scope}`
}

export function createDefinitionsCacheTags(options: CacheKeyOptions): string[] {
  const tenant = normalizeTenantId(options.tenantId)
  const organization = normalizeOrganizationId(options.organizationId)
  const baseTenant = `${CACHE_PREFIX}:${tenant}`
  const tags = new Set<string>([
    baseTenant,
    `${baseTenant}:org:${organization}`,
  ])

  const uniqueEntities = Array.from(new Set(options.entityIds))
  for (const entityId of uniqueEntities) {
    tags.add(`${baseTenant}:entity:${entityId}`)
    tags.add(`${baseTenant}:org:${organization}:entity:${entityId}`)
  }

  return Array.from(tags)
}

export async function invalidateDefinitionsCache(
  cache: CacheStrategy | undefined,
  options: { tenantId: string | null | undefined; organizationId: string | null | undefined; entityIds: string[] }
): Promise<void> {
  if (!cache?.deleteByTags) return
  const tags = createDefinitionsCacheTags(options)
  const entityTags = tags.filter((tag) => tag.includes(':entity:'))
  const targets = entityTags.length ? entityTags : tags
  if (!targets.length) return
  try {
    await cache.deleteByTags(targets)
  } catch (err) {
    console.warn('[entities.definitions.cache] Failed to invalidate cache', err)
  }
}
