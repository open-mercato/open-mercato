import { runWithCacheTenant } from '@open-mercato/cache'
import type { CacheStrategy } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildTodoSummaryCacheTags } from '../lib/todoSummaryCache'

const logger = createLogger('example').child({ subscriber: 'invalidate-todo-summary' })

/**
 * Drops the module-owned Todo summary cache after every Todo write.
 *
 * Wildcard event id, so create/update/delete all land here and a fourth write path
 * cannot be added without invalidating. These fire from `flushOrmEntityChanges`,
 * which runs AFTER the domain write commits — the ordering the cache contract
 * requires (`packages/cache/AGENTS.md` → "Consistency vs commit timing").
 *
 * Ephemeral (`persistent: false`) so invalidation happens in the writing process
 * immediately. Under a process-local memory cache that leaves peer processes to
 * converge on the entry's TTL; a shared backend (`CACHE_STRATEGY=redis`) makes the
 * single `deleteByTags` call authoritative for the whole deployment.
 */
export const metadata = {
  event: 'example.todo.*',
  persistent: false,
  id: 'example:invalidate-todo-summary',
}

/**
 * Default CRUD event payload built by the data engine for
 * `example.todo.<action>`: `{ id, organizationId, tenantId }`.
 */
export type TodoCrudEventPayload = {
  id?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

export type SubscriberResolverContext = {
  resolve: <T>(name: string) => T
}

export default async function handler(
  payload: TodoCrudEventPayload,
  ctx: SubscriberResolverContext,
): Promise<void> {
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload?.organizationId === 'string' ? payload.organizationId : null
  // An unscoped write cannot name a scoped cache entry. Clearing "everything" here
  // would cross tenants, so do nothing and let the TTL close the gap.
  if (!tenantId || !organizationId) return

  let cache: CacheStrategy | null = null
  try {
    cache = ctx.resolve<CacheStrategy>('cache')
  } catch {
    return
  }
  if (!cache || typeof cache.deleteByTags !== 'function') return

  try {
    await runWithCacheTenant(tenantId, () =>
      cache.deleteByTags(buildTodoSummaryCacheTags({ tenantId, organizationId })),
    )
  } catch (error) {
    // Best effort: the write already committed, and the bounded TTL is the backstop.
    logger.warn('Failed to invalidate todo summary cache', { err: error, tenantId })
  }
}
