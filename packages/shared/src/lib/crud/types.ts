export type CrudEventAction = 'created' | 'updated' | 'deleted'

export type CrudEntityIdentifiers = {
  id: string
  organizationId: string | null
  tenantId: string | null
}

export type CrudEmitContext<TEntity = unknown> = {
  action: CrudEventAction
  entity: TEntity
  identifiers: CrudEntityIdentifiers
}

export type CrudEventsConfig<TEntity = unknown> = {
  module: string
  entity: string
  persistent?: boolean
  buildPayload?: (ctx: CrudEmitContext<TEntity>) => unknown
}

export type CrudIndexerConfig<TEntity = unknown> = {
  entityType: string
  buildUpsertPayload?: (ctx: CrudEmitContext<TEntity>) => unknown
  buildDeletePayload?: (ctx: CrudEmitContext<TEntity>) => unknown
  cacheAliases?: string[]
}

export type CrudIdentifierResolver<TEntity = unknown> = (entity: TEntity, action: CrudEventAction) => CrudEntityIdentifiers
