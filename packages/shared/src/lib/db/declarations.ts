import type { DatabaseExecutionContext, DatabaseTableMetadata } from './runtime'

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
export type DatabaseModuleDeclarations = Readonly<{
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
