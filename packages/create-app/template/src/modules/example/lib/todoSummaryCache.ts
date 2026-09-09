import { runWithCacheTenant } from '@open-mercato/cache'
import type { CacheStrategy } from '@open-mercato/cache'
import { buildCollectionTags, normalizeTagSegment } from '@open-mercato/shared/lib/crud/cache'

/**
 * The resource tag the Todo CRUD route already owns.
 *
 * `makeCrudRoute` derives its cache resource from `events: { module, entity }`
 * (`resolveResourceAliasesList` in `packages/shared/src/lib/crud/factory.ts`), so the
 * Todo route's resource is exactly `example.todo`. Tagging this module-owned summary
 * with the same collection tag means the platform's own post-commit
 * `invalidateCrudCache` drops it too whenever `ENABLE_CRUD_API_CACHE` is on — without
 * this module reimplementing tag naming.
 */
const TODO_RESOURCE = 'example.todo' as const

/** Bounded TTL. It is the backstop when an invalidation is lost (see the subscriber). */
export const TODO_SUMMARY_CACHE_TTL_MS = 60_000

export type TodoSummaryScope = {
  tenantId: string
  organizationId: string
}

export type TodoSummaryCounts = {
  total: number
  done: number
  open: number
}

/**
 * The cached value carries its own scope. The key is already tenant/organization
 * scoped, and the cache wrapper partitions storage by cache tenant on top of that,
 * but re-checking the scope on read makes serving another tenant's counts require
 * two independent failures instead of one.
 */
export type TodoSummary = TodoSummaryCounts & TodoSummaryScope

export type TodoSummaryRead = {
  summary: TodoSummary
  cacheHit: boolean
}

export type TodoSummaryLoader = (scope: TodoSummaryScope) => Promise<TodoSummaryCounts>

export type TodoSummaryService = {
  read(scope: TodoSummaryScope): Promise<TodoSummaryRead>
  invalidate(scope: TodoSummaryScope): Promise<number>
}

export function buildTodoSummaryCacheKey(scope: TodoSummaryScope): string {
  return [
    'example',
    'todo-summary',
    'tenant',
    normalizeTagSegment(scope.tenantId),
    'org',
    normalizeTagSegment(scope.organizationId),
  ].join(':')
}

export function buildTodoSummaryCacheTags(scope: TodoSummaryScope): string[] {
  return buildCollectionTags(TODO_RESOURCE, scope.tenantId, [scope.organizationId])
}

function isFiniteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Runtime narrowing for a value that came back from a cache backend. A cache read
 * returns `unknown` on purpose: the bytes may have been written by an older
 * deployment, a different shape, or a different scope.
 */
export function asTodoSummaryForScope(value: unknown, scope: TodoSummaryScope): TodoSummary | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!isFiniteCount(record.total) || !isFiniteCount(record.done) || !isFiniteCount(record.open)) return null
  if (record.tenantId !== scope.tenantId) return null
  if (record.organizationId !== scope.organizationId) return null
  return {
    total: record.total,
    done: record.done,
    open: record.open,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
}

/**
 * Cache-aside read of a Todo count summary.
 *
 * `loadCounts` is injected rather than resolved here so the caching behaviour is
 * exercisable without a database; `lib/todoSummaryService.ts` supplies the
 * `EntityManager`-backed loader and is what DI registers.
 */
export function createTodoSummaryCache(deps: {
  cache: CacheStrategy
  loadCounts: TodoSummaryLoader
  ttlMs?: number
}): TodoSummaryService {
  const { cache, loadCounts } = deps
  const ttl = deps.ttlMs ?? TODO_SUMMARY_CACHE_TTL_MS

  return {
    async read(scope: TodoSummaryScope): Promise<TodoSummaryRead> {
      const key = buildTodoSummaryCacheKey(scope)
      const cached = await runWithCacheTenant(scope.tenantId, () => cache.get(key))
      const reusable = asTodoSummaryForScope(cached, scope)
      if (reusable) return { summary: reusable, cacheHit: true }

      const counts = await loadCounts(scope)
      const summary: TodoSummary = {
        total: counts.total,
        done: counts.done,
        open: counts.open,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }
      await runWithCacheTenant(scope.tenantId, () =>
        cache.set(key, summary, { ttl, tags: buildTodoSummaryCacheTags(scope) }),
      )
      return { summary, cacheHit: false }
    },

    async invalidate(scope: TodoSummaryScope): Promise<number> {
      return runWithCacheTenant(scope.tenantId, () =>
        cache.deleteByTags(buildTodoSummaryCacheTags(scope)),
      )
    },
  }
}
