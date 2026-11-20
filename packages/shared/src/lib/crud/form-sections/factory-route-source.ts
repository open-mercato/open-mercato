import type { CrudFormSectionCapabilityProviderFact } from '../../../modules/form-section-facts'
import type { EntityName } from '@mikro-orm/core'
import type { z } from 'zod'
import type { CommandExecuteResult, CommandRuntimeContext } from '../../commands/types'
import type { CrudCtx, CrudMethodMetadata } from '../factory'

export type CrudSectionRouteOperation = 'create' | 'update' | 'delete'
export const crudSectionOperationMethods = { create: 'POST', update: 'PUT', delete: 'DELETE' } as const
export type CrudSectionRouteMethod = (typeof crudSectionOperationMethods)[CrudSectionRouteOperation]

type CrudRouteSectionAction = {
  commandId: string
  schema?: z.ZodType
  status?: number
  hasCustomMetadata: boolean
  response?(input: { result: unknown; logEntry: unknown; ctx: CrudCtx }): unknown
}

export type CrudRouteSectionSource = {
  metadata: Partial<Record<CrudSectionRouteMethod, CrudMethodMetadata>>
  orm: {
    entity: EntityName<object>
    idField: string
    orgField: string | null
    tenantField: string | null
    softDeleteField: string | null
  }
  resourceKind: string
  hasWriteHooks: boolean
  hasCustomIdentifiers: boolean
  deleteIdFrom: 'query' | 'body'
  softDelete: boolean
  actions: Partial<Record<CrudSectionRouteOperation, CrudRouteSectionAction>>
  requestContext(request: Request): Promise<CrudCtx>
  execute(operation: CrudSectionRouteOperation, input: unknown, context: CommandRuntimeContext): Promise<CommandExecuteResult<unknown>>
}

const routesKey = Symbol.for('openMercato.crud-form-sections.factory-routes')
const registry = globalThis as typeof globalThis & { [routesKey]?: WeakMap<object, CrudRouteSectionSource> }

export function rememberCrudRouteSectionSource(route: object, source: CrudRouteSectionSource): void {
  const sources = registry[routesKey] ??= new WeakMap()
  sources.set(route, source)
}

export function findCrudRouteSectionSource(route: object): CrudRouteSectionSource | undefined {
  return registry[routesKey]?.get(route)
}

type DerivedRouteCapability = { fact: CrudFormSectionCapabilityProviderFact; features: readonly string[] }
const capabilityKey = Symbol.for('openMercato.crud-form-sections.derived-capabilities')
const capabilities = globalThis as typeof globalThis & {
  [capabilityKey]?: WeakMap<object, readonly DerivedRouteCapability[]>
}

export function rememberDerivedCrudRouteCapabilities(sections: object, entries: readonly DerivedRouteCapability[]): void {
  const registry = capabilities[capabilityKey] ??= new WeakMap()
  registry.set(sections, entries)
}

export function getDerivedCrudRouteCapabilities(sections: object): readonly DerivedRouteCapability[] {
  return capabilities[capabilityKey]?.get(sections) ?? []
}
