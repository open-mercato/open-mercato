const RESERVED_SYSTEM_ENTITY_TYPES = new Set<string>([
  'entities:custom_entity',
  'entities:custom_entity_storage',
  'entities:custom_field_def',
  'entities:custom_field_value',
  'query_index:entity_index_row',
  'query_index:entity_index_coverage',
  'query_index:search_token',
])

export function isSystemEntitySelectable(entityId: string): boolean {
  if (!entityId) return false
  return !RESERVED_SYSTEM_ENTITY_TYPES.has(entityId)
}

export function flattenSystemEntityIds(
  allEntities: Record<string, Record<string, string>>,
  options?: { predicate?: (entityType: string) => boolean },
): string[] {
  if (!allEntities) return []
  const predicate = options?.predicate || isSystemEntitySelectable
  const seen = new Set<string>()
  for (const bucket of Object.values(allEntities)) {
    for (const id of Object.values(bucket ?? {})) {
      if (typeof id !== 'string' || id.length === 0) continue
      if (!predicate(id)) continue
      seen.add(id)
    }
  }
  return Array.from(seen).sort()
}

export function filterSelectableSystemEntityIds(entityIds: Iterable<string>): string[] {
  const selected: string[] = []
  for (const id of entityIds) {
    if (isSystemEntitySelectable(id)) selected.push(id)
  }
  return selected
}

export function isReservedSystemEntityType(entityId: string): boolean {
  return RESERVED_SYSTEM_ENTITY_TYPES.has(entityId)
}
