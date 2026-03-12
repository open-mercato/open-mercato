/**
 * Generic bulk action framework for any entity type.
 * Provides a standard pattern for bulk operations with partial success reporting.
 *
 * Usage:
 *   const handlers = {
 *     reassign: async ({ entity, payload, em }) => { entity.ownerUserId = payload.userId; },
 *     changeStatus: async ({ entity, payload, em }) => { entity.status = payload.status; },
 *   }
 *
 *   const result = await executeBulkAction(em, entityClass, {
 *     ids,
 *     action,
 *     payload,
 *     handlers,
 *     scopeFilter: { tenantId, organizationId, deletedAt: null },
 *   })
 */

export type BulkActionHandler<TEntity = unknown, TPayload = unknown> = (params: {
  entity: TEntity
  payload: TPayload
  index: number
}) => Promise<void>

export type BulkActionConfig<TEntity = unknown, TPayload = unknown> = {
  ids: string[]
  action: string
  payload: TPayload
  handlers: Record<string, BulkActionHandler<TEntity, TPayload>>
  scopeFilter?: Record<string, unknown>
  maxBatchSize?: number
}

export type BulkActionResult = {
  processed: number
  succeeded: number
  failed: number
  errors: Array<{ id: string; error: string }>
}

type EntityClass<T = unknown> = new (...args: unknown[]) => T

/**
 * Execute a bulk action against a set of entities.
 * Processes each entity individually, collecting errors for partial success reporting.
 *
 * @param em - MikroORM EntityManager
 * @param entityClass - The entity class to operate on
 * @param config - Bulk action configuration
 * @returns Result with success/failure counts and per-item errors
 */
export async function executeBulkAction<TEntity extends Record<string, unknown>, TPayload = unknown>(
  em: { find: (cls: EntityClass<TEntity>, filter: Record<string, unknown>) => Promise<TEntity[]>; flush: () => Promise<void> },
  entityClass: EntityClass<TEntity>,
  config: BulkActionConfig<TEntity, TPayload>,
): Promise<BulkActionResult> {
  const { ids, action, payload, handlers, scopeFilter, maxBatchSize = 100 } = config

  const handler = handlers[action]
  if (!handler) {
    return {
      processed: 0,
      succeeded: 0,
      failed: ids.length,
      errors: ids.map((id) => ({ id, error: `Unknown action: ${action}` })),
    }
  }

  const batchIds = ids.slice(0, maxBatchSize)
  const filter: Record<string, unknown> = {
    id: { $in: batchIds },
    ...scopeFilter,
  }

  const entities = await em.find(entityClass, filter)
  const entityMap = new Map<string, TEntity>()
  for (const entity of entities) {
    entityMap.set(entity.id as string, entity)
  }

  const result: BulkActionResult = {
    processed: batchIds.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  }

  for (let index = 0; index < batchIds.length; index++) {
    const id = batchIds[index]
    const entity = entityMap.get(id)

    if (!entity) {
      result.failed++
      result.errors.push({ id, error: 'Entity not found' })
      continue
    }

    try {
      await handler({ entity, payload, index })
      result.succeeded++
    } catch (err) {
      result.failed++
      const message = err instanceof Error ? err.message : 'Unknown error'
      result.errors.push({ id, error: message })
    }
  }

  if (result.succeeded > 0) {
    await em.flush()
  }

  return result
}
