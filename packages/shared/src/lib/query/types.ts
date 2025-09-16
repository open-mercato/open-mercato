import type { EntityId } from '@/modules/entities'

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like' | 'ilike' | 'exists'

export enum SortDir {
  Asc = 'asc',
  Desc = 'desc',
}

export type FieldSelector = string // base field or custom field key (prefixed with 'cf:')

export type Filter = {
  field: FieldSelector
  op: FilterOp
  value?: any
}

export type Sort = { field: FieldSelector; dir?: SortDir }

export type Page = { page?: number; pageSize?: number }

export type QueryOptions = {
  fields?: FieldSelector[] // base fields and/or 'cf:<key>' for custom fields
  includeExtensions?: boolean | string[] // include all registered extensions or only specific ones by entity id
  includeCustomFields?: boolean | string[] // include all CFs or specific keys
  filters?: Filter[]
  sort?: Sort[]
  page?: Page
  organizationId?: number // enforce multi-tenant scope
}

export type QueryResult<T = any> = {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export interface QueryEngine {
  query<T = any>(entity: EntityId, opts?: QueryOptions): Promise<QueryResult<T>>
}
