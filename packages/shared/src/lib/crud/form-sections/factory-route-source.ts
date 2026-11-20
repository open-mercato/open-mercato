import type { CrudFormSectionCapabilityProviderFact } from '../../../modules/form-section-facts'
import type { EntityName } from '@mikro-orm/core'
import type { z } from 'zod'
import type { CommandExecuteResult, CommandRuntimeContext } from '../../commands/types'
import type { CrudCtx, CrudMethodMetadata } from '../factory'
import type { RunInterceptorsAfterResult } from '../interceptor-runner'

import { crudSectionOperationMethods, type CrudSectionRouteOperation } from './client-mutation-facts'
export { crudSectionOperationMethods, type CrudSectionRouteOperation }
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
  actions: Partial<Record<CrudSectionRouteOperation, CrudRouteSectionAction>>
  requestContext(request: Request): Promise<CrudCtx>
  hasFacadeOnlyInterceptors(operation: CrudSectionRouteOperation, originalPath: string, facadePath: string): boolean
  prepareCommand(input: {
    operation: CrudSectionRouteOperation
    raw: Record<string, unknown>
    directDelete: boolean
    context: CrudCtx
    request: Request
    resourceId: string | null
    readPreviousRecord(): Promise<Record<string, unknown> | null>
  }): Promise<{
    input: unknown
    afterCommit(args: {
      input: Record<string, unknown>
      resourceId: string | null
      status: number
      body: unknown
    }): Promise<RunInterceptorsAfterResult | null>
  }>
  attachCommittedOperation(response: Response, logEntry: unknown): Response
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
type BoundDerivedRouteCapability = DerivedRouteCapability & { ready(): boolean }
const capabilityKey = Symbol.for('openMercato.crud-form-sections.derived-capabilities')
const capabilities = globalThis as typeof globalThis & {
  [capabilityKey]?: WeakMap<object, readonly BoundDerivedRouteCapability[]>
}

export function rememberDerivedCrudRouteCapabilities(sections: object, entries: readonly BoundDerivedRouteCapability[]): void {
  const registry = capabilities[capabilityKey] ??= new WeakMap()
  registry.set(sections, entries)
}

export function getDerivedCrudRouteCapabilities(sections: object): readonly DerivedRouteCapability[] {
  return (capabilities[capabilityKey]?.get(sections) ?? [])
    .filter(({ ready }) => ready())
    .map(({ fact, features }) => ({ fact, features }))
}
