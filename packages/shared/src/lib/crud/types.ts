export type CrudEventAction = 'created' | 'updated' | 'deleted'

/** Internal payload marker: the data engine owns this CRUD event's query-index decision. */
export const CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY = '__omQueryIndexManaged' as const

export type CrudEntityIdentifiers = {
  id: string
  organizationId: string | null
  tenantId: string | null
}

export type CrudEmitContext<TEntity = unknown> = {
  action: CrudEventAction
  entity: TEntity
  identifiers: CrudEntityIdentifiers
  syncOrigin?: string | null
  actorUserId?: string | null
}

export type CrudEventsConfig<TEntity = unknown> = {
  module: string
  entity: string
  persistent?: boolean
  buildPayload?(ctx: CrudEmitContext<TEntity>): unknown
}

export type CrudIndexerConfig<TEntity = unknown> = {
  entityType: string
  buildUpsertPayload?(ctx: CrudEmitContext<TEntity>): unknown
  buildDeletePayload?(ctx: CrudEmitContext<TEntity>): unknown
  cacheAliases?: string[]
}

export type CrudIdentifierResolver<TEntity = unknown> = (entity: TEntity, action: CrudEventAction) => CrudEntityIdentifiers
