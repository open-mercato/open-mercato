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

/**
 * Declares that a CRUD write maintains the `query_index` projection for `entityType`.
 *
 * On `makeCrudRoute`'s built-in write path (`create` / `update` / `del`) the route emits the
 * projection event itself. On the command path (`actions.*`) the command handler owns the
 * side-effect mark and the command bus owns the flush, so the route's declaration is applied
 * to the handler's mark: a handler that calls `emitCrudSideEffects({ events })` without an
 * `indexer` still indexes the record under this `entityType`, and one that passes its own
 * `indexer` keeps it. A handler that marks no side effect at all indexes nothing — the route
 * logs a warning naming the command when that happens.
 */
export type CrudIndexerConfig<TEntity = unknown> = {
  entityType: string
  buildUpsertPayload?(ctx: CrudEmitContext<TEntity>): unknown
  buildDeletePayload?(ctx: CrudEmitContext<TEntity>): unknown
  cacheAliases?: string[]
}

export type CrudIdentifierResolver<TEntity = unknown> = (entity: TEntity, action: CrudEventAction) => CrudEntityIdentifiers
