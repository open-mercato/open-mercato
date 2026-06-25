// Invalidate the OrganizationScope cache when an organization mutates.
//
// resolveOrganizationScopeForRequest caches its result with a short TTL
// (default 60s, OM_ORG_SCOPE_CACHE_TTL_MS). When an organization is
// created/updated/deleted, the cached scope for users of the affected
// tenant may be stale (visibility set or descendant tree changed). We
// drop every cache entry tagged for that tenant; the TTL is the backstop
// for races where the event fires after a request reads the cache.

import { buildOrgScopeTenantCacheTag } from '@open-mercato/core/modules/directory/utils/organizationScope'

type CacheService = {
  deleteByTags(tags: string[]): Promise<number>
}

export const metadata = {
  event: 'directory.organization.*',
  persistent: false,
  id: 'directory:invalidate-org-scope-cache',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const data = (payload ?? {}) as Record<string, unknown>
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : null
  if (!tenantId) return
  let cache: CacheService | null = null
  try {
    cache = ctx.resolve<CacheService>('cache')
  } catch {
    return
  }
  if (!cache) return
  try {
    await cache.deleteByTags([buildOrgScopeTenantCacheTag(tenantId)])
  } catch {
    // best-effort; TTL is the backstop.
  }
}
