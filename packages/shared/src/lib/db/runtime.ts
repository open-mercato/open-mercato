export type DatabaseExecutionSource = 'identity' | 'api' | 'page' | 'portal' | 'public-token' | 'worker' | 'event' | 'scheduler' | 'cli' | 'maintenance'

export type DatabaseExecutionContext =
  | Readonly<{ kind: 'tenant'; tenantId: string; source: DatabaseExecutionSource; operation?: string }>
  | Readonly<{ kind: 'identity'; tenantId: string | null; source: 'identity'; operation?: string }>
  | Readonly<{ kind: 'maintenance'; tenantId: null; source: 'maintenance' | 'cli' | 'scheduler'; operation: string }>

export type DatabaseInvocation = Readonly<{ token: symbol; isActive(): boolean }>

export type DatabaseContextResolution =
  | Readonly<{ status: 'resolved'; context: DatabaseExecutionContext; invocation: DatabaseInvocation }>
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'unavailable'; error: Error }>

export type DatabaseStorageDescriptor = Readonly<{
  kind: string
  schema: string
  tables: readonly string[]
  configuration: Readonly<Record<string, string | number | boolean>>
}>

export type DatabasePoolDescriptor = Readonly<{
  id: string
  purpose: 'runtime' | 'maintenance' | 'transport'
  tables: readonly string[] | 'primary'
}>

export type DatabasePoolLifecycle = Readonly<{
  ready(): Promise<void>
  dispose(): void
}>

export type DatabaseRuntimeAdapter = Readonly<{
  id: string
  version: string
  configurationKey: string
  configurePool(pool: object, descriptor: DatabasePoolDescriptor): DatabasePoolLifecycle
  run<Result>(context: DatabaseExecutionContext, callback: () => Result): Result
  connectionUrl?(purpose: 'runtime' | 'maintenance', defaultUrl: string): string
  beforeMigrate?(): Promise<void>
  afterMigrate?(): Promise<void>
  recoverMigrationReindex?: boolean
  storageMode?(descriptor: DatabaseStorageDescriptor): 'provision' | 'validate'
}>

export type DatabaseExecutionContextResolver = () => Promise<DatabaseContextResolution>

type RegisteredPool = {
  descriptor: DatabasePoolDescriptor
  lifecycle: DatabasePoolLifecycle
}

type DatabaseRuntimeState = {
  adapter?: DatabaseRuntimeAdapter
  pools: WeakMap<object, RegisteredPool>
  activePools: number
  initializationStarted: boolean
  resolvers: Map<string, DatabaseExecutionContextResolver>
}

const runtimeKey = Symbol.for('@open-mercato/shared.databaseRuntime.v1')

function state(): DatabaseRuntimeState {
  const globals = globalThis as typeof globalThis & { [runtimeKey]?: DatabaseRuntimeState }
  globals[runtimeKey] ??= { pools: new WeakMap(), activePools: 0, initializationStarted: false, resolvers: new Map() }
  return globals[runtimeKey]
}

export function registerDatabaseRuntimeAdapter(adapter: DatabaseRuntimeAdapter): void {
  const current = state()
  if (current.adapter) {
    if (
      current.adapter.id === adapter.id
      && current.adapter.version === adapter.version
      && current.adapter.configurationKey === adapter.configurationKey
    ) return
    throw new Error('[internal] Database runtime configuration changed; drain pools and restart')
  }
  if (current.initializationStarted || current.activePools > 0) {
    throw new Error('[internal] Database runtime must be registered before connection pools initialize')
  }
  current.adapter = Object.freeze({ ...adapter })
}

export function beginDatabaseInitialization(): boolean {
  const current = state()
  current.initializationStarted = true
  return current.adapter !== undefined
}

export function registerDatabaseExecutionContextResolver(
  id: string,
  resolver: DatabaseExecutionContextResolver,
): void {
  if (!id.trim()) throw new Error('[internal] Database execution context resolver requires an id')
  const resolvers = state().resolvers
  if (!resolvers.has(id)) resolvers.set(id, resolver)
}

export async function resolveDatabaseExecutionContext(): Promise<Exclude<DatabaseContextResolution, { status: 'unavailable' }>> {
  for (const resolver of state().resolvers.values()) {
    const resolution = await resolver()
    if (resolution.status === 'unavailable') throw resolution.error
    if (resolution.status === 'resolved') {
      return Object.freeze({
        ...resolution,
        context: Object.freeze({ ...resolution.context }),
      })
    }
  }
  return Object.freeze({ status: 'absent' })
}

export function runWithDatabaseExecutionContext<Result>(
  context: DatabaseExecutionContext,
  callback: () => Result,
): Result {
  const adapter = state().adapter
  return adapter ? adapter.run(Object.freeze({ ...context }), callback) : callback()
}

export function resolveDatabaseConnectionUrl(
  purpose: 'runtime' | 'maintenance',
  defaultUrl: string,
): string {
  return state().adapter?.connectionUrl?.(purpose, defaultUrl) ?? defaultUrl
}

export function configureDatabasePool(pool: object, descriptor: DatabasePoolDescriptor): DatabasePoolLifecycle {
  const current = state()
  const existing = current.pools.get(pool)
  if (existing) {
    if (
      existing.descriptor.id !== descriptor.id
      || existing.descriptor.purpose !== descriptor.purpose
      || JSON.stringify(existing.descriptor.tables) !== JSON.stringify(descriptor.tables)
    ) throw new Error('[internal] Database pool was registered with conflicting identities')
    return existing.lifecycle
  }
  const captured = Object.freeze({
    ...descriptor,
    tables: descriptor.tables === 'primary' ? 'primary' : Object.freeze([...descriptor.tables]),
  })
  const configured = current.adapter?.configurePool(pool, captured)
  let disposed = false
  let readiness: Promise<void> | undefined
  const lifecycle: DatabasePoolLifecycle = Object.freeze({
    ready: async () => {
      if (disposed) throw new Error('[internal] Database pool lifecycle is already disposed')
      readiness ??= Promise.resolve().then(() => configured?.ready())
      await readiness
    },
    dispose: () => {
      if (disposed) return
      configured?.dispose()
      disposed = true
      current.pools.delete(pool)
      current.activePools -= 1
    },
  })
  current.pools.set(pool, { descriptor: captured, lifecycle })
  current.activePools += 1
  return lifecycle
}

export async function beforeDatabaseMigrate(): Promise<void> {
  await state().adapter?.beforeMigrate?.()
}

export async function afterDatabaseMigrate(): Promise<void> {
  await state().adapter?.afterMigrate?.()
}

export function shouldRecoverDatabaseMigrationReindex(): boolean {
  return state().adapter?.recoverMigrationReindex === true
}

export function databaseStorageMode(descriptor: DatabaseStorageDescriptor): 'provision' | 'validate' {
  return state().adapter?.storageMode?.(descriptor) ?? 'provision'
}
