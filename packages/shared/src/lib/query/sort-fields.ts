import { sql } from 'kysely'
import type { Sort } from './types'

export function getSortFields(sorts: readonly Sort[]): string[] {
  return [...new Set(sorts.flatMap(({ field, fallbackFields }) => [field, ...(fallbackFields ?? [])]))]
}

export function resolveBaseSortExpression(sort: Sort, qualify: (field: string) => string) {
  const primary = qualify(sort.field)
  if (!sort.fallbackFields?.length) return primary
  const columns = [primary, ...sort.fallbackFields.map(qualify)]
  return sql`coalesce(${sql.join(columns.map((column) => sql.ref(column)))})`
}
