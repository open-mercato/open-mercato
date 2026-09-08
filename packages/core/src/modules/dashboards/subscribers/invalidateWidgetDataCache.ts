import { runWithCacheTenant } from '@open-mercato/cache'

type CacheService = {
  deleteByTags(tags: string[]): Promise<number>
}

export const metadata = {
  event: 'currencies.currency.*',
  persistent: false,
  id: 'dashboards:invalidate-widget-data-on-currency-change',
}

export default async function handle(
  payload: unknown,
  context: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const data = (payload ?? {}) as Record<string, unknown>
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : null
  if (!tenantId) return

  let cache: CacheService
  try {
    cache = context.resolve<CacheService>('cache')
  } catch {
    return
  }

  try {
    await runWithCacheTenant(tenantId, () => cache.deleteByTags(['widget-data']))
  } catch {
  }
}
