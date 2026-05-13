type CacheService = {
  deleteByTags(tags: string[]): Promise<number>
}

export const metadata = {
  event: 'customer_accounts.domain_mapping.*',
  persistent: false,
  id: 'customer_accounts:invalidate-domain-cache',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const data = (payload ?? {}) as Record<string, unknown>
  const hostname = typeof data.hostname === 'string' ? data.hostname : null
  const organizationId = typeof data.organizationId === 'string' ? data.organizationId : null

  let cache: CacheService | null = null
  try {
    cache = ctx.resolve<CacheService>('cache')
  } catch {
    return
  }
  if (!cache) return

  const tags = ['domain_routing']
  if (hostname) tags.push(`domain_routing:${hostname}`)
  if (organizationId) tags.push(`domain_routing:org:${organizationId}`)
  try {
    await cache.deleteByTags(tags)
  } catch {
    // Best-effort cache invalidation. TTL is the backstop.
  }
}
