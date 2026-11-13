import type { DatabasePoolLifecycle } from '@open-mercato/shared/lib/db/runtime'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  assertBoundaryInvocation,
  currentTenantBoundaryScope,
  peekTenantBoundaryScope,
  resolveTenantBoundaryScope,
  type TenantBoundaryScope,
} from './scope'

type ClientQuery = (...arguments_: unknown[]) => unknown
type ClientRelease = (error?: Error | boolean) => void
type QueryCallback = (error: Error | null, result?: unknown) => void

export type BoundaryClient = Readonly<{
  query: ClientQuery
  release: ClientRelease
  processID?: number
}>

type ConnectCallback = (error: Error | undefined, client: BoundaryClient | undefined, release: ClientRelease) => void
type PoolConnect = {
  (): Promise<BoundaryClient>
  (callback: ConnectCallback): void
}

export type BoundaryPool = { connect: PoolConnect; ended?: boolean }
export type BoundaryPoolOptions = Readonly<{
  configurationKey: string
  initializeClient?: (client: BoundaryClient) => Promise<void>
  verifyPool?: (pool: BoundaryPool) => Promise<void>
  validateScope?: (scope: TenantBoundaryScope | undefined) => void
}>

type PoolRegistration = { configurationKey: string; lifecycle: DatabasePoolLifecycle }
type PoolState = { pools: WeakMap<object, PoolRegistration> }
const poolsKey = Symbol.for('@open-mercato/enterprise.tenantBoundaryPools.v1')
const setTenantSql = "select set_config('app.current_tenant_id', $1, false)"
const eventMethods = ['on', 'once', 'off', 'addListener', 'removeListener', 'listenerCount'] as const

function registrations(): WeakMap<object, PoolRegistration> {
  const globals = globalThis as typeof globalThis & { [poolsKey]?: PoolState }
  globals[poolsKey] ??= { pools: new WeakMap() }
  return globals[poolsKey].pools
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('[internal] Tenant boundary connection failed', { cause: error })
}

function assertClient(client: BoundaryClient): void {
  if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') {
    throw new Error('[internal] Tenant boundary requires a supported PostgreSQL client')
  }
}

export function installTenantPoolBoundary(pool: BoundaryPool, options: BoundaryPoolOptions): DatabasePoolLifecycle {
  const registered = registrations().get(pool)
  if (registered) {
    if (registered.configurationKey !== options.configurationKey) {
      throw new Error('[internal] Tenant boundary pool configuration changed; drain pools and restart')
    }
    return registered.lifecycle
  }
  if (typeof pool.connect !== 'function') throw new Error('[internal] Tenant boundary requires a PostgreSQL pool')
  const originalConnect = pool.connect
  const verifiedClients = new WeakSet<object>()
  const validation = new AsyncLocalStorage<boolean>()
  let ready = false
  let disposed = false
  let pending = 0
  let leased = 0
  let readiness: Promise<void> | undefined

  async function acquire(receiver: BoundaryPool, captured: Promise<TenantBoundaryScope | undefined>): Promise<BoundaryClient> {
    pending += 1
    try {
      const owner = await captured
      assertBoundaryInvocation(owner)
      if (disposed) throw new Error('[internal] Tenant boundary pool has been disposed')
      const physical = await (originalConnect as () => Promise<BoundaryClient>).call(receiver)
      try {
        assertClient(physical)
      } catch (error) {
        if (physical && typeof physical.release === 'function') physical.release(asError(error))
        throw error
      }
      const originalRelease = physical.release.bind(physical)
      const originalQuery = physical.query.bind(physical)
      try {
        assertBoundaryInvocation(owner)
        if (disposed) throw new Error('[internal] Tenant boundary pool has been disposed')
        const tenantId = owner?.context.kind === 'maintenance' ? '' : owner?.context.tenantId ?? ''
        await originalQuery(setTenantSql, [tenantId])
        if (!verifiedClients.has(physical)) {
          await options.initializeClient?.(physical)
          verifiedClients.add(physical)
        }
        assertBoundaryInvocation(owner)
      } catch (error) {
        originalRelease(asError(error))
        throw error
      }

      let released = false
      let removeLeaseListeners: () => void = () => undefined
      leased += 1
      const release: ClientRelease = (error) => {
        if (released) throw new Error('[internal] Tenant boundary lease has already been released')
        const current = peekTenantBoundaryScope()
        if (!(error instanceof Error) && current && current.invocation.token !== owner?.invocation.token) {
          throw new Error('[internal] Cannot release a tenant boundary lease from another invocation')
        }
        released = true
        leased -= 1
        removeLeaseListeners()
        const expired = owner && !owner.invocation.isActive()
        originalRelease(expired ? new Error('[internal] Tenant boundary owner completed before release') : error)
      }

      const execute = async (arguments_: unknown[]): Promise<unknown> => {
        if (released) throw new Error('[internal] Tenant boundary lease has already been released')
        assertBoundaryInvocation(owner)
        const current = ready ? await resolveTenantBoundaryScope() : currentTenantBoundaryScope()
        if (ready) options.validateScope?.(current)
        if (current?.invocation.token !== owner?.invocation.token) {
          throw new Error('[internal] PostgreSQL lease belongs to another tenant boundary invocation')
        }
        if (released) throw new Error('[internal] Tenant boundary lease was released before query execution')
        assertBoundaryInvocation(owner)
        const query = arguments_[0]
        if (query && typeof query === 'object' && 'submit' in query) {
          throw new Error('[internal] Tenant boundary does not support unguarded cursor or streaming query escapes')
        }
        return await originalQuery(...arguments_)
      }

      const query: ClientQuery = (...arguments_) => {
        const callback = arguments_.at(-1)
        if (typeof callback !== 'function') return execute(arguments_)
        const completed = callback as QueryCallback
        void execute(arguments_.slice(0, -1)).then(
          (result) => completed(null, result),
          (error: unknown) => completed(asError(error)),
        )
        return undefined
      }
      const facade: BoundaryClient & Record<string, unknown> = { query, release, processID: physical.processID }
      const listeners = new WeakMap<(...arguments_: unknown[]) => unknown, (...arguments_: unknown[]) => unknown>()
      const subscriptions: Array<{ event: unknown; listener: (...arguments_: unknown[]) => unknown }> = []
      removeLeaseListeners = () => {
        const remove = (physical as unknown as Record<string, unknown>).removeListener
        if (typeof remove === 'function') {
          for (const subscription of subscriptions) remove.call(physical, subscription.event, subscription.listener)
        }
        subscriptions.length = 0
      }
      for (const method of eventMethods) {
        const handler = (physical as unknown as Record<string, unknown>)[method]
        if (typeof handler !== 'function') continue
        facade[method] = (...arguments_: unknown[]) => {
          if (method !== 'removeListener' && method !== 'off' && method !== 'listenerCount') {
            if (released) throw new Error('[internal] Tenant boundary lease has already been released')
            assertBoundaryInvocation(owner)
            const current = peekTenantBoundaryScope()
            if (current && current.invocation.token !== owner?.invocation.token) {
              throw new Error('[internal] PostgreSQL listener belongs to another tenant boundary invocation')
            }
          }
          const listener = arguments_[1]
          const invoke = listener as (...arguments_: unknown[]) => unknown
          if (typeof listener === 'function') {
            if (method === 'removeListener' || method === 'off' || method === 'listenerCount') {
              const wrapped = listeners.get(invoke)
              if (!wrapped) return method === 'listenerCount' ? 0 : facade
              arguments_[1] = wrapped
            } else {
              let wrapped = listeners.get(invoke)
              if (!wrapped) {
                wrapped = (...values: unknown[]) => invoke.apply(facade, values)
                listeners.set(invoke, wrapped)
              }
              arguments_[1] = wrapped
              subscriptions.push({ event: arguments_[0], listener: wrapped })
            }
          }
          const result = handler.apply(physical, arguments_)
          return result === physical ? facade : result
        }
      }
      return Object.freeze(facade)
    } finally {
      pending -= 1
    }
  }

  const ensureReady = (): Promise<void> => {
    if (disposed) return Promise.reject(new Error('[internal] Tenant boundary pool has been disposed'))
    readiness ??= validation.run(true, async () => {
      await options.verifyPool?.(pool)
      ready = true
    })
    return readiness
  }

  const connect = function (this: BoundaryPool, callback?: ConnectCallback): Promise<BoundaryClient> | void {
    const existing = currentTenantBoundaryScope()
    const captured = validation.getStore() === true
      ? Promise.resolve(existing)
      : ensureReady().then(async () => {
        const scope = existing ?? await resolveTenantBoundaryScope()
        options.validateScope?.(scope)
        return scope
      })
    const acquired = acquire(this, captured)
    if (!callback) return acquired
    void acquired.then(
      (client) => callback(undefined, client, client.release),
      (error: unknown) => callback(asError(error), undefined, () => undefined),
    )
  } as PoolConnect

  pool.connect = connect
  const lifecycle: DatabasePoolLifecycle = Object.freeze({
    ready: async () => {
      await ensureReady()
    },
    dispose: () => {
      if (disposed) return
      if (pool.ended !== true || pending !== 0 || leased !== 0) {
        throw new Error('[internal] Tenant boundary pool must drain and close before disposal')
      }
      disposed = true
      if (pool.connect === connect) pool.connect = originalConnect
      registrations().delete(pool)
    },
  })
  registrations().set(pool, { configurationKey: options.configurationKey, lifecycle })
  return lifecycle
}
