import type { DataMapping, FieldMapping } from '../../data_sync/lib/adapter'
import { detectCustomersPersonMapping } from './column-detector'

export type SuggestedMapping = DataMapping & {
  unmappedColumns: string[]
}

export function buildSuggestedMapping(entityType: string, headers: string[]): SuggestedMapping {
  if (entityType === 'customers.person') {
    return detectCustomersPersonMapping(headers)
  }

  return {
    entityType,
    matchStrategy: 'custom',
    fields: [] as FieldMapping[],
    unmappedColumns: headers.slice(),
  }
}
