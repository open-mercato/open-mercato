import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { Todo } from '../data/entities'
import {
  createTodoSummaryCache,
  type TodoSummaryCounts,
  type TodoSummaryScope,
  type TodoSummaryService,
} from './todoSummaryCache'

/**
 * Scoped count load. Every predicate carries tenant AND organization: the cache in
 * front of it can only ever be as isolated as the query behind it.
 */
export async function countTodosForScope(
  em: EntityManager,
  scope: TodoSummaryScope,
): Promise<TodoSummaryCounts> {
  const base = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  }
  const total = await em.count(Todo, base)
  const done = await em.count(Todo, { ...base, isDone: true })
  return { total, done, open: total - done }
}

/**
 * Awilix provider registered in `di.ts` as `exampleTodoSummaryService`.
 *
 * Declared with a destructured cradle so the container's PROXY injection mode
 * resolves `em` and `cache` by name; `.scoped()` ties the instance to the request
 * container that owns that `em`.
 */
export function createExampleTodoSummaryService(deps: {
  em: EntityManager
  cache: CacheStrategy
}): TodoSummaryService {
  return createTodoSummaryCache({
    cache: deps.cache,
    loadCounts: (scope) => countTodosForScope(deps.em, scope),
  })
}
