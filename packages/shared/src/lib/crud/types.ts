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
 *
 * Two limits of that hand-down are worth knowing before you rely on it:
 *
 * - It is scoped to one `CommandBus.execute()`, and the declaration lives on the request's
 *   `DataEngine` instance. That is sound because `createRequestContainer()` registers
 *   `dataEngine` per request; re-registering it as a transient would leave the command marking
 *   on a different instance than the route declared on, so nothing is indexed and every write
 *   logs the warning.
 * - `CommandBus.undo()` runs outside any route, so no declaration is active there. An undo
 *   handler that must maintain the projection MUST pass its own `indexer` to
 *   `emitCrudUndoSideEffects` — otherwise undoing a delete restores the row in the database and
 *   leaves it missing from `query_index` until the next full rebuild.
 */
export type CrudIndexerConfig<TEntity = unknown> = {
  entityType: string
  buildUpsertPayload?(ctx: CrudEmitContext<TEntity>): unknown
  buildDeletePayload?(ctx: CrudEmitContext<TEntity>): unknown
  cacheAliases?: string[]
}

export type CrudIdentifierResolver<TEntity = unknown> = (entity: TEntity, action: CrudEventAction) => CrudEntityIdentifiers
