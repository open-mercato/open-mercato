export type CrudEventAction = 'created' | 'updated' | 'deleted'

export type CrudEntityIdentifiers = {
  id: string
  organizationId: string | null
  tenantId: string | null
}

export type CrudEmitContext<T = any> = {
  action: CrudEventAction
  entity: T
  identifiers: CrudEntityIdentifiers
}

export type CrudEventsConfig<T = any> = {
  module: string
  entity: string
  persistent?: boolean
  buildPayload?: (ctx: CrudEmitContext<T>) => any
}

export type CrudIndexerConfig<T = any> = {
  entityType: string
  buildUpsertPayload?: (ctx: CrudEmitContext<T>) => any
  buildDeletePayload?: (ctx: CrudEmitContext<T>) => any
}

export type CrudIdentifierResolver<T = any> = (entity: T, action: CrudEventAction) => CrudEntityIdentifiers
