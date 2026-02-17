import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { Profiler } from '../profiler'

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

// Mongo/Medusa-style filter operators (typed)
export type WhereOps<T> = {
  $eq?: T
  $ne?: T | null
  $gt?: T extends number | Date ? T : never
  $gte?: T extends number | Date ? T : never
  $lt?: T extends number | Date ? T : never
  $lte?: T extends number | Date ? T : never
  $in?: T[]
  $nin?: T[]
  $like?: T extends string ? string : never
  $ilike?: T extends string ? string : never
  $exists?: boolean
}

// A field filter can be a direct value (equals) or ops object
export type WhereValue<T = any> = T | WhereOps<T>

// Generic shape for object filters. If you have a typed map of field→type,
// pass it as the generic to get end-to-end typing.
// Example: Where<{
//   id: string; title: string; created_at: Date; 'cf:severity': number
// }>
export type Where<Fields extends Record<string, any> = Record<string, any>> =
  Partial<{ [K in keyof Fields]: WhereValue<Fields[K]> }> & Record<string, WhereValue>

export type QueryCustomFieldJoin = {
  fromField: string
  toField: string
  type?: 'left' | 'inner'
}

export type QueryCustomFieldSource = {
  entityId: EntityId
  table?: string
  alias?: string
  recordIdColumn?: string
  join?: QueryCustomFieldJoin
  tenantField?: string
  organizationField?: string
}

export type QueryJoinEdge = {
  alias: string
  table?: string
  entityId?: EntityId
  from: {
    alias?: string
    field: string
  }
  to: {
    field: string
  }
  type?: 'left' | 'inner'
}

export type QueryOptions = {
  fields?: FieldSelector[] // base fields and/or 'cf:<key>' for custom fields
  includeExtensions?: boolean | string[] // include all registered extensions or only specific ones by entity id
  includeCustomFields?: boolean | string[] // include all CFs or specific keys
  // Accept classic array syntax or Mongo-style object syntax
  filters?: Filter[] | Where
  sort?: Sort[]
  page?: Page
  organizationId?: string // enforce multi-tenant scope
  tenantId?: string // enforce tenant scope
  // Optional list of organization ids to scope results. Takes precedence over organizationId.
  organizationIds?: string[]
  // Soft-delete behavior: when false (default), rows with non-null deleted_at
  // are excluded if the base table has that column. Set true to include them.
  withDeleted?: boolean
  customFieldSources?: QueryCustomFieldSource[]
  joins?: QueryJoinEdge[]
  profiler?: Profiler
  // When true, suppress automatic reindex scheduling triggered by coverage gap detection.
  // Used by the search indexing pipeline to prevent feedback loops where indexing triggers
  // re-indexing indefinitely.
  skipAutoReindex?: boolean
}

export type PartialIndexWarning = {
  entity: EntityId
  entityLabel?: string | null
  baseCount?: number | null
  indexedCount?: number | null
  scope?: 'scoped' | 'global'
}

export type QueryResultMeta = {
  partialIndexWarning?: PartialIndexWarning
}

export type QueryResult<T = any> = {
  items: T[]
  page: number
  pageSize: number
  total: number
  meta?: QueryResultMeta
}

export interface QueryEngine {
  query<T = any>(entity: EntityId, opts?: QueryOptions): Promise<QueryResult<T>>
}
