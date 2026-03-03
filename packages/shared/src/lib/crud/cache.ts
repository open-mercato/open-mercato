import type { AwilixContainer } from 'awilix'
import type { CacheStrategy } from '@open-mercato/cache'
import { parseBooleanToken } from '../boolean'

export type CrudCacheIdentifiers = {
  id?: string | null
  organizationId?: string | null
  tenantId?: string | null
}

let crudCacheEnabledFlag: boolean | null = null
export function isCrudCacheEnabled(): boolean {
  if (crudCacheEnabledFlag !== null) return crudCacheEnabledFlag
  crudCacheEnabledFlag = parseBooleanToken(process.env.ENABLE_CRUD_API_CACHE ?? '') === true
  return crudCacheEnabledFlag
}

let crudCacheDebugFlag: boolean | null = null
export function isCrudCacheDebugEnabled(): boolean {
  if (crudCacheDebugFlag !== null) return crudCacheDebugFlag
  crudCacheDebugFlag = parseBooleanToken(process.env.QUERY_ENGINE_DEBUG_SQL ?? '') === true
  return crudCacheDebugFlag
}

export function debugCrudCache(event: string, context: Record<string, unknown>) {
  if (!isCrudCacheDebugEnabled()) return
  try {
    console.debug('[crud][cache]', event, context)
  } catch {}
}

export function resolveCrudCache(container: AwilixContainer): CacheStrategy | null {
  try {
    const cache = (container.resolve('cache') as CacheStrategy)
    if (cache && typeof cache.get === 'function' && typeof cache.set === 'function') {
      return cache
    }
  } catch {}
  return null
}

export function normalizeTagSegment(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'null'
  return value.toString().trim().replace(/[^a-zA-Z0-9._-]/g, '-')
}

export function canonicalizeResourceTag(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  if (!trimmed.length) return null
  const withSeparators = trimmed
    .replace(/::/g, '.')
    .replace(/[/\\]+/g, '.')
    .replace(/[\s]+/g, '.')
    .replace(/_/g, '.')
    .replace(/-+/g, '.')
  const withCamelBreaks = withSeparators.replace(/([a-z0-9])([A-Z])/g, '$1.$2')
  const collapsed = withCamelBreaks.replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '')
  const lowered = collapsed.toLowerCase()
  return lowered.length ? lowered : null
}

export function buildRecordTag(resource: string, tenantId: string | null, recordId: string): string {
  return [
    'crud',
    normalizeTagSegment(resource),
    'tenant',
    normalizeTagSegment(tenantId),
    'record',
    normalizeTagSegment(recordId),
  ].join(':')
}

export function buildCollectionTags(
  resource: string,
  tenantId: string | null,
  organizationIds: Array<string | null>
): string[] {
  const normalizedResource = normalizeTagSegment(resource)
  const normalizedTenant = normalizeTagSegment(tenantId)
  const tags = new Set<string>()
  if (!organizationIds.length) {
    tags.add(['crud', normalizedResource, 'tenant', normalizedTenant, 'org', 'null', 'collection'].join(':'))
    return Array.from(tags)
  }
  for (const orgId of organizationIds) {
    tags.add(['crud', normalizedResource, 'tenant', normalizedTenant, 'org', normalizeTagSegment(orgId), 'collection'].join(':'))
  }
  return Array.from(tags)
}

export function normalizeIdentifierValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString()
    if (value && typeof (value as { id?: unknown }).id !== 'undefined') {
      return normalizeIdentifierValue((value as { id?: unknown }).id)
    }
  }
  return String(value)
}

export function pickFirstIdentifier(...values: Array<unknown>): string | null {
  for (const value of values) {
    const normalized = normalizeIdentifierValue(value)
    if (normalized) return normalized
  }
  return null
}

function singularizeSegment(segment: string): string {
  const lower = segment.toLowerCase()
  if (lower.endsWith('ies') && lower.length > 3) return lower.slice(0, -3) + 'y'
  if (lower.endsWith('ses') && lower.length > 3) return lower.slice(0, -2)
  if (
    (lower.endsWith('xes') ||
      lower.endsWith('zes') ||
      lower.endsWith('ches') ||
      lower.endsWith('shes')) &&
    lower.length > 3
  ) {
    return lower.slice(0, -2)
  }
  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 1) return lower.slice(0, -1)
  return lower
}

function singularizeResourceSegment(segment: string): string {
  return segment
    .split('-')
    .map((part) => singularizeSegment(part))
    .join('-')
}

export function deriveResourceFromCommandId(commandId: string | undefined | null): string | null {
  if (!commandId || typeof commandId !== 'string') return null
  const parts = commandId.split('.')
  if (parts.length < 2) return null
  const modulePart = parts[0]
  const entityPart = singularizeResourceSegment(parts[1])
  if (!modulePart || !entityPart) return null
  return `${modulePart}.${entityPart}`
}

export function expandResourceAliases(resource: string, aliases?: string[]): string[] {
  const set = new Set<string>()
  const inputs = [resource, ...(aliases ?? [])]
  for (const candidate of inputs) {
    const canonical = canonicalizeResourceTag(candidate)
    if (canonical) set.add(canonical)
  }
  if (!set.size) return []
  return Array.from(set)
}

export async function invalidateCrudCache(
  container: AwilixContainer,
  resource: string,
  identifiers: CrudCacheIdentifiers,
  fallbackTenant: string | null,
  reason: string,
  aliases?: string[]
): Promise<void> {
  if (!isCrudCacheEnabled()) return
  const cache = resolveCrudCache(container)
  if (!cache || typeof cache.deleteByTags !== 'function') return
  const resources = expandResourceAliases(resource, aliases)
  const tenantId = identifiers.tenantId ?? fallbackTenant ?? null
  const recordId = normalizeIdentifierValue(identifiers.id)
  const tags = new Set<string>()
  for (const key of resources) {
    if (recordId) {
      tags.add(buildRecordTag(key, tenantId, recordId))
    }
    const organizationIds: Array<string | null> = []
    if (identifiers.organizationId !== undefined) {
      organizationIds.push(identifiers.organizationId ?? null)
    }
    if (!organizationIds.length) organizationIds.push(null)
    for (const tag of buildCollectionTags(key, tenantId, organizationIds)) {
      tags.add(tag)
    }
  }
  if (!tags.size) return
  const tagList = Array.from(tags)
  debugCrudCache('invalidate', {
    resource,
    aliases: resources,
    reason,
    tenantId: tenantId ?? 'null',
    tags: tagList,
    action: 'clearing',
  })
  const deleted = await cache.deleteByTags(tagList)
  debugCrudCache('invalidate', {
    resource,
    reason,
    tenantId: tenantId ?? 'null',
    tags: tagList,
    action: 'cleared',
    deleted,
  })
}
