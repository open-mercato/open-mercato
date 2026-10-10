import type { SearchIndexDocCondition, SearchIndexDocFilter } from '@open-mercato/shared/modules/search'

export type IndexedDocument = { id: string; doc: Record<string, unknown> }

function conditionHolds(entry: IndexedDocument, condition: SearchIndexDocCondition): boolean {
  if (condition.op === 'recordIdNotIn') return !condition.values.includes(entry.id)
  const value = entry.doc[condition.key]
  switch (condition.op) {
    case 'exists':
      return value !== undefined && value !== null
    case 'eq':
      return value !== undefined && value !== null && String(value) === String(condition.value)
    case 'overlap':
      return Array.isArray(value) && value.some((item) => condition.values.includes(String(item)))
    case 'noverlap':
      return Array.isArray(value) && !value.some((item) => condition.values.includes(String(item)))
  }
}

/** In-memory reference for the SQL a search strategy compiles from `SearchIndexDocFilter`. */
export function evaluateIndexDocFilter(entry: IndexedDocument, filter: SearchIndexDocFilter): boolean {
  return filter.anyOf.some((branch) => branch.every((condition) => conditionHolds(entry, condition)))
}
