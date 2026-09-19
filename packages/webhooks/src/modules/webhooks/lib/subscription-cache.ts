import type { CacheStrategy } from '@open-mercato/cache'
import { runWithCacheTenant } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('webhooks').child({ component: 'subscription-cache' })

const DEFAULT_TTL_MS = 60_000
const GLOBAL_SCOPE_SEGMENT = 'global'

export type CachedActiveWebhook = {
  id: string
  tenantId: string
  organizationId: string | null
  subscribedEvents: string[]
}

export type WebhookSubscriptionCache = Pick<CacheStrategy, 'get' | 'set' | 'deleteByTags'>

export function isWebhookSubscriptionCache(value: unknown): value is WebhookSubscriptionCache {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WebhookSubscriptionCache>
  return (
    typeof candidate.get === 'function'
    && typeof candidate.set === 'function'
    && typeof candidate.deleteByTags === 'function'
  )
}

export function resolveWebhookSubscriptionCache(resolve: (token: string) => unknown): WebhookSubscriptionCache | null {
  try {
    const cache = resolve('cache')
    return isWebhookSubscriptionCache(cache) ? cache : null
  } catch {
    return null
  }
}

export function getWebhookSubscriptionCacheTtlMs(): number {
  const raw = process.env.OM_WEBHOOKS_SUBSCRIPTION_CACHE_TTL_MS
  if (raw === undefined || raw.trim() === '') return DEFAULT_TTL_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TTL_MS
  return parsed
}

function normalizeScopeSegment(organizationId: string | null | undefined): string {
  return organizationId ?? GLOBAL_SCOPE_SEGMENT
}

export function getWebhookSubscriptionCacheKey(tenantId: string, organizationId: string | null | undefined): string {
  return `webhooks:subscriptions:${tenantId}:${normalizeScopeSegment(organizationId)}`
}

export function getWebhookSubscriptionCacheTag(tenantId: string): string {
  return `webhooks:subscriptions:tenant:${tenantId}`
}

function isCachedActiveWebhookList(value: unknown): value is CachedActiveWebhook[] {
  return Array.isArray(value) && value.every((entry) => (
    entry !== null
    && typeof entry === 'object'
    && typeof (entry as CachedActiveWebhook).id === 'string'
    && typeof (entry as CachedActiveWebhook).tenantId === 'string'
    && Array.isArray((entry as CachedActiveWebhook).subscribedEvents)
  ))
}

export async function getCachedActiveWebhooks(
  cache: WebhookSubscriptionCache | null,
  tenantId: string,
  organizationId: string | null | undefined,
): Promise<CachedActiveWebhook[] | null> {
  if (!cache) return null
  try {
    const value = await runWithCacheTenant(tenantId, () => cache.get(getWebhookSubscriptionCacheKey(tenantId, organizationId)))
    return isCachedActiveWebhookList(value) ? value : null
  } catch (error) {
    logger.warn('Failed to read webhook subscription cache', { err: error })
    return null
  }
}

export async function setCachedActiveWebhooks(
  cache: WebhookSubscriptionCache | null,
  tenantId: string,
  organizationId: string | null | undefined,
  webhooks: CachedActiveWebhook[],
  ttlMs: number,
): Promise<void> {
  if (!cache || ttlMs <= 0) return
  try {
    await runWithCacheTenant(tenantId, () => cache.set(
      getWebhookSubscriptionCacheKey(tenantId, organizationId),
      webhooks,
      { ttl: ttlMs, tags: [getWebhookSubscriptionCacheTag(tenantId)] },
    ))
  } catch (error) {
    logger.warn('Failed to write webhook subscription cache', { err: error })
  }
}

export async function invalidateWebhookSubscriptionCache(
  cache: WebhookSubscriptionCache | null,
  tenantId: string | null | undefined,
): Promise<void> {
  if (!cache) return
  const normalizedTenantId = tenantId?.trim()
  if (!normalizedTenantId) return
  try {
    await runWithCacheTenant(normalizedTenantId, () => cache.deleteByTags([getWebhookSubscriptionCacheTag(normalizedTenantId)]))
  } catch (error) {
    logger.warn('Failed to invalidate webhook subscription cache', { err: error })
  }
}
