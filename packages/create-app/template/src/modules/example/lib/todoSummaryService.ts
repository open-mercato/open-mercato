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
 * The parameters MUST be listed individually rather than taken as one cradle object. The
 * platform container is built with `InjectionMode.CLASSIC`
 * (`packages/shared/src/lib/di/container.ts`), which resolves one registration per *parameter
 * name*, and neither cradle shape survives that mode:
 *
 * - a single named parameter (`deps`) makes the container look for a registration called `deps`
 *   and throw `Could not resolve 'deps'`, which is how this surfaced — every request to
 *   `/api/example/todos/summary` answered 500;
 * - a destructured parameter (`{ em, cache }`) is worse, because classic injection passes
 *   nothing at all and the factory silently receives `undefined` for both.
 *
 * Listing `em` and `cache` as parameters is what classic injection resolves by name.
 * `.scoped()` then ties the instance to the request container that owns that `em`.
 */
export function createExampleTodoSummaryService(
  em: EntityManager,
  cache: CacheStrategy,
): TodoSummaryService {
  return createTodoSummaryCache({
    cache,
    loadCounts: (scope) => countTodosForScope(em, scope),
  })
}
