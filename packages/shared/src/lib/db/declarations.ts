import { z } from 'zod'
import type { DatabaseExecutionContext, DatabaseStorageDescriptor, DatabaseTableMetadata } from './runtime'

export type DatabaseRequestInput = Readonly<{
  pathname: string
  headers: Headers
  request?: Request
  requireAuth: boolean
  requireCustomerAuth: boolean
}>
export type DatabaseRequestIdentity = Readonly<{
  context: DatabaseExecutionContext
  organization?: Readonly<{ id: string; slug?: string }>
}>
export type DatabaseRequestProvider = Readonly<{
  matches(input: DatabaseRequestInput): boolean
  resolve(input: DatabaseRequestInput): Promise<DatabaseRequestIdentity | null>
}>
export type DatabaseBindingValidator = (identity: DatabaseRequestIdentity) => Promise<boolean>
export type DatabaseJobInput = Readonly<{
  queue: string
  workerIds: readonly string[]
  payload: unknown
  metadata?: Readonly<Record<string, unknown>>
}>
export type DatabaseJobProvider = Readonly<{
  matches(input: DatabaseJobInput): boolean
  resolve(input: DatabaseJobInput): Promise<DatabaseExecutionContext>
}>
export type DatabaseStorageConnection = Readonly<{
  query(text: string, values?: readonly unknown[]): Promise<unknown>
}>
export type DatabaseStorageProvider = Readonly<{
  id: string
  descriptor: DatabaseStorageDescriptor
  provision(connection: DatabaseStorageConnection): Promise<void>
}>
export type DatabaseModuleDeclarations = Readonly<{
  storageProviders?: readonly DatabaseStorageProvider[]
  jobProviders?: readonly DatabaseJobProvider[]
  requestProviders?: readonly DatabaseRequestProvider[]
  bindingValidators?: readonly DatabaseBindingValidator[]
  tableClassification?: 'identity'
  storageTables?: readonly Readonly<DatabaseTableMetadata & {
    classification: 'identity' | 'mixed' | 'global' | 'deferred' | 'transport'
    reason: string
  }>[]
  tables?: readonly Readonly<{
    table: string
    classification: 'enforced' | 'identity' | 'mixed' | 'global' | 'deferred' | 'transport'
    reason: string
    tenantNullable?: boolean
  }>[]
}>
export type DatabaseModuleDeclarationEntry = Readonly<{ moduleId: string; declarations: DatabaseModuleDeclarations }>

const declarationsKey = Symbol.for('@open-mercato/shared.databaseModuleDeclarations.v1')
function declarations(): Map<string, DatabaseModuleDeclarations> {
  const globals = globalThis as typeof globalThis & { [declarationsKey]?: Map<string, DatabaseModuleDeclarations> }
  return globals[declarationsKey] ??= new Map()
}

export function registerDatabaseModuleDeclarations(entries: readonly DatabaseModuleDeclarationEntry[]): void {
  for (const entry of entries) {
    if (!entry.moduleId.trim()) throw new Error('[internal] Database declaration requires a module identity')
    if (!declarations().has(entry.moduleId)) declarations().set(entry.moduleId, entry.declarations)
  }
}

export async function resolveDeclaredDatabaseRequestContext(input: DatabaseRequestInput): Promise<DatabaseExecutionContext> {
  const providers = [...declarations().values()].flatMap((entry) => entry.requestProviders ?? []).filter((provider) => provider.matches(input))
  if (providers.length > 1) throw new Error('[internal] Ambiguous database request identity providers')
  const identity = await providers[0]?.resolve(input)
  if (!identity) return { kind: 'identity', tenantId: null, source: 'identity', operation: 'unauthenticated-request' }
  for (const validator of [...declarations().values()].flatMap((entry) => entry.bindingValidators ?? [])) {
    if (!await validator(identity)) return { kind: 'identity', tenantId: null, source: 'identity', operation: 'invalid-request-binding' }
  }
  return identity.context
}

export function databaseJobTenantContext(tenantId: unknown, operation: string): DatabaseExecutionContext {
  const parsed = z.string().uuid().safeParse(tenantId)
  if (!parsed.success) throw new Error('[internal] Database job requires a verified tenant UUID')
  return { kind: 'tenant', tenantId: parsed.data.toLowerCase(), source: 'worker', operation }
}

export async function resolveDeclaredDatabaseJobContext(input: DatabaseJobInput): Promise<DatabaseExecutionContext> {
  const providers = [...declarations().values()].flatMap((entry) => entry.jobProviders ?? []).filter((provider) => provider.matches(input))
  if (providers.length > 1) throw new Error('[internal] Ambiguous database job context providers')
  if (providers[0]) return providers[0].resolve(input)
  const payloadTenant = input.payload && typeof input.payload === 'object' && 'tenantId' in input.payload ? input.payload.tenantId : undefined
  const metadataTenant = input.metadata?.tenantId
  if (payloadTenant != null && metadataTenant != null && payloadTenant !== metadataTenant) {
    throw new Error('[internal] Conflicting database job tenant identities')
  }
  return databaseJobTenantContext(metadataTenant ?? payloadTenant, input.queue)
}

export async function provisionDeclaredDatabaseStorage(connection: DatabaseStorageConnection): Promise<void> {
  const providers = [...declarations().values()].flatMap((entry) => entry.storageProviders ?? [])
  const identities = providers.map((provider) => provider.id)
  if (new Set(identities).size !== identities.length) throw new Error('[internal] Ambiguous database storage providers')
  for (const provider of providers) await provider.provision(connection)
}
