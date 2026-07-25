import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'

export type CustomFieldFilterEntry = readonly [string, unknown]

type ValueColumn = 'valueText' | 'valueMultiline' | 'valueInt' | 'valueFloat' | 'valueBool'

const valueColumnForKind = (kind: string | null | undefined): ValueColumn => {
  switch (kind) {
    case 'integer':
      return 'valueInt'
    case 'float':
      return 'valueFloat'
    case 'boolean':
      return 'valueBool'
    case 'multiline':
      return 'valueMultiline'
    default:
      return 'valueText'
  }
}

const expectedValuesFor = (condition: unknown): unknown[] => {
  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    const maybeIn = (condition as { $in?: unknown[] }).$in
    if (Array.isArray(maybeIn)) return maybeIn
  }
  return [condition]
}

const intersect = (current: Set<string> | null, next: Set<string>): Set<string> => {
  if (current === null) return next
  const result = new Set<string>()
  for (const id of next) {
    if (current.has(id)) result.add(id)
  }
  return result
}

/**
 * Resolve the bounded set of record ids that satisfy the given custom-field
 * filters by querying the custom-field value store directly, instead of loading
 * every entity row and matching the values in memory. Filters are combined with
 * AND semantics. Returns an empty set when any filter matches nothing.
 */
export async function resolveRecordIdsForCustomFieldFilters(opts: {
  em: EntityManager
  entityId: EntityId
  tenantId: string | null
  filters: CustomFieldFilterEntry[]
}): Promise<Set<string>> {
  const { em, entityId, tenantId, filters } = opts
  if (!filters.length) return new Set<string>()

  const keys = Array.from(new Set(filters.map(([key]) => key)))
  const tenantScope: Record<string, unknown> = tenantId
    ? { tenantId: { $in: [tenantId, null] } }
    : { tenantId: null }

  const defs = await em.find(CustomFieldDef, {
    entityId: String(entityId),
    key: { $in: keys },
    isActive: true,
    deletedAt: null,
    ...tenantScope,
  } as FilterQuery<CustomFieldDef>)
  const kindByKey = new Map<string, string>()
  for (const def of defs) {
    if (!kindByKey.has(def.key)) kindByKey.set(def.key, def.kind)
  }

  let matched: Set<string> | null = null
  for (const [key, condition] of filters) {
    const column = valueColumnForKind(kindByKey.get(key))
    const expectedValues = expectedValuesFor(condition).filter((value) => value !== undefined && value !== null)
    if (!expectedValues.length) return new Set<string>()

    const rows = await em.find(
      CustomFieldValue,
      {
        entityId: String(entityId),
        fieldKey: key,
        deletedAt: null,
        [column]: { $in: expectedValues },
        ...tenantScope,
      } as FilterQuery<CustomFieldValue>,
      { fields: ['recordId'] },
    )
    const ids = new Set<string>(rows.map((row) => String(row.recordId)))
    matched = intersect(matched, ids)
    if (matched.size === 0) return matched
  }

  return matched ?? new Set<string>()
}
