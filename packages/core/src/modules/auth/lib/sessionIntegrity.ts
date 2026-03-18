import type { EntityManager } from '@mikro-orm/postgresql'

const CACHE_TTL_MS = 60_000 // 60 seconds

type CacheEntry = { valid: boolean; expiresAt: number }
const validityCache = new Map<string, CacheEntry>()

/**
 * Validates that the user and tenant referenced in an auth context still exist in the database.
 * Uses a short-lived in-memory cache to avoid per-request DB hits.
 *
 * Returns false when the JWT references a user or tenant that no longer exists
 * (e.g. after a reinstall that recreated the database).
 */
export async function isAuthContextValid(
  em: EntityManager,
  auth: { sub: string; tenantId?: string | null },
): Promise<boolean> {
  if (!auth.sub) return false

  const cacheKey = `${auth.sub}:${auth.tenantId ?? ''}`
  const cached = validityCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.valid
  }

  const valid = await checkValidity(em, auth)
  validityCache.set(cacheKey, { valid, expiresAt: Date.now() + CACHE_TTL_MS })
  return valid
}

async function checkValidity(
  em: EntityManager,
  auth: { sub: string; tenantId?: string | null },
): Promise<boolean> {
  try {
    const { User } = await import('@open-mercato/core/modules/auth/data/entities')
    const user = await em.findOne(User, { id: auth.sub, deletedAt: null })
    if (!user) return false

    if (auth.tenantId) {
      const { Tenant } = await import('@open-mercato/core/modules/directory/data/entities')
      const tenant = await em.findOne(Tenant, { id: auth.tenantId })
      if (!tenant) return false
    }

    return true
  } catch {
    // If we can't validate, assume invalid to be safe
    return false
  }
}

export function invalidateSessionIntegrityCache(): void {
  validityCache.clear()
}
