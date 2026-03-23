import type { EntityManager } from '@mikro-orm/postgresql'

type EntityClass<T = unknown> = new (...args: unknown[]) => T

/**
 * Generic reorder utility for any sortable list.
 * Updates the order field of each entity to match the provided ID sequence.
 *
 * @param em - MikroORM EntityManager
 * @param entityClass - The entity class to reorder
 * @param ids - Ordered array of entity IDs (new sequence)
 * @param orderField - The field name storing the order/sequence number
 * @param parentFilter - Optional filter to scope items (e.g., { deal: dealId })
 * @returns Count of reordered items
 */
export async function reorderItems<T extends Record<string, unknown>>(
  em: EntityManager,
  entityClass: EntityClass<T>,
  ids: string[],
  orderField: string = 'lineNumber',
  parentFilter?: Record<string, unknown>,
): Promise<{ reordered: number }> {
  if (ids.length === 0) return { reordered: 0 }

  const filter: Record<string, unknown> = { id: { $in: ids } }
  if (parentFilter) {
    Object.assign(filter, parentFilter)
  }

  const items = await em.find(entityClass, filter as never)
  const itemMap = new Map<string, T>()
  for (const item of items) {
    const id = (item as Record<string, unknown>).id as string
    itemMap.set(id, item)
  }

  let reordered = 0
  for (let index = 0; index < ids.length; index++) {
    const item = itemMap.get(ids[index])
    if (!item) continue
    const currentValue = (item as Record<string, unknown>)[orderField]
    const newValue = index + 1
    if (currentValue !== newValue) {
      ;(item as Record<string, unknown>)[orderField] = newValue
      reordered++
    }
  }

  if (reordered > 0) {
    await em.flush()
  }

  return { reordered }
}
