import { AsyncLocalStorage } from 'node:async_hooks'
import { createLogger } from '../logger'
import { getTelemetryRuntime } from '../telemetry/runtime'
import { setScopedEventBusResolver } from '../../modules/events/factory'

/**
 * Per-request (or per-job) slot for the most recently built DI container.
 *
 * Every `createRequestContainer()` bootstraps its own event bus and parks it as
 * the process-global bus, so module emitters (`createModuleEvents().emit`) used
 * to dispatch subscribers against whichever container was built last in the
 * process — under concurrency, another request's container. Inside a scope the
 * emitter uses the bus of the latest container built *in this scope* instead;
 * outside any scope it keeps falling back to the global bus. See issue #2963.
 */
export type RequestScopeContainer = {
  resolve: <T = unknown>(name: string) => T
}

type DisposableScope = { dispose: () => Promise<void>; createScope?: () => DisposableScope }
type RequestDisposals = { scopes: Set<DisposableScope>; pending: Set<Promise<unknown>>; closed: boolean }

type RequestScopeStore = {
  disposals?: RequestDisposals
  container: RequestScopeContainer | null
  owner?: RequestScopeContainer
}

const REQUEST_SCOPE_STORAGE_KEY = Symbol.for('@open-mercato/shared/di/request-scope')

type GlobalWithRequestScopeStorage = typeof globalThis & {
  [REQUEST_SCOPE_STORAGE_KEY]?: AsyncLocalStorage<RequestScopeStore>
}

function resolveRequestScopeStorage(): AsyncLocalStorage<RequestScopeStore> {
  const scope = globalThis as GlobalWithRequestScopeStorage
  if (!scope[REQUEST_SCOPE_STORAGE_KEY]) {
    scope[REQUEST_SCOPE_STORAGE_KEY] = new AsyncLocalStorage<RequestScopeStore>()
  }
  return scope[REQUEST_SCOPE_STORAGE_KEY]
}

const requestScopeStorage = resolveRequestScopeStorage()

export function runInRequestScope<T>(fn: () => T): T {
  return requestScopeStorage.run({ container: null }, fn)
}

export function runWithRequestScopeContainer<T>(container: RequestScopeContainer, fn: () => T): T {
  return requestScopeStorage.run({ container, owner: container, disposals: requestScopeStorage.getStore()?.disposals }, fn)
}

export function bindRequestScopeContainer(container: RequestScopeContainer): void {
  const store = requestScopeStorage.getStore()
  if (store) store.container = container
  if ('dispose' in container && typeof container.dispose === 'function') {
    trackRequestScopeDisposal(container as RequestScopeContainer & DisposableScope)
  }
}

const logger = createLogger('shared').child({ component: 'request-scope' })

function observeCleanup(action: () => void): void {
  try { action() } catch { return }
}

export function runWithRequestScopeAcquisition<T>(fn: () => Promise<T>): Promise<T> {
  const ownership = requestScopeStorage.getStore()?.disposals
  if (!ownership) return fn()
  const pending = fn()
  ownership.pending.add(pending)
  return pending.finally(() => { ownership.pending.delete(pending) })
}

async function disposeOwnedScope(scope: DisposableScope): Promise<void> {
  try {
    await scope.dispose()
  } catch (error) {
    observeCleanup(() => logger.error('Failed to dispose request-owned DI scope', { err: error }))
    observeCleanup(() => getTelemetryRuntime()?.reportError(error, { module: 'shared', code: 'shared.request_scope_cleanup_failed' }))
  }
}

export function trackRequestScopeDisposal(scope: DisposableScope): void {
  const ownership = requestScopeStorage.getStore()?.disposals
  if (!ownership || ownership.scopes.has(scope)) return
  const dispose = scope.dispose.bind(scope)
  const createScope = scope.createScope?.bind(scope)
  if (createScope) {
    scope.createScope = () => {
      const nested = createScope()
      trackRequestScopeDisposal(nested)
      return nested
    }
  }
  let completion: Promise<void> | undefined
  scope.dispose = () => completion ??= Promise.resolve().then(dispose)
  if (ownership.closed) {
    void Promise.allSettled(Array.from(ownership.pending)).then(() => disposeOwnedScope(scope))
  } else ownership.scopes.add(scope)
}

async function closeRequestScopes(ownership: RequestDisposals): Promise<void> {
  while (ownership.pending.size > 0) await Promise.allSettled(Array.from(ownership.pending))
  ownership.closed = true
  const scopes = Array.from(ownership.scopes).reverse()
  ownership.scopes.clear()
  for (const scope of scopes) await disposeOwnedScope(scope)
}

type OwnedRequestScopeResult<T> = T extends Response ? Response : T

export async function runInOwnedRequestScope<T>(fn: () => T | Promise<T>): Promise<OwnedRequestScopeResult<T>> {
  const ownership: RequestDisposals = { scopes: new Set(), pending: new Set(), closed: false }
  const store: RequestScopeStore = { container: null, disposals: ownership }
  return requestScopeStorage.run(store, async (): Promise<OwnedRequestScopeResult<T>> => {
    let response: T
    try {
      response = await fn()
      if (!(response instanceof Response) || !response.body) {
        await closeRequestScopes(ownership)
        return response as OwnedRequestScopeResult<T>
      }
      const reader = response.body.getReader()
      let finishing: Promise<void> | undefined
      let cancellation: Promise<void> | undefined
      const finish = () => finishing ??= Promise.resolve().then(async () => {
        if (cancellation) await Promise.allSettled([cancellation])
        reader.releaseLock()
        await closeRequestScopes(ownership)
      })
      const body = new ReadableStream<Uint8Array>({
        pull: (controller) => requestScopeStorage.run(store, async () => {
          try {
            const result = await reader.read()
            if (result.done) {
              await finish()
              controller.close()
            } else controller.enqueue(result.value)
          } catch (error) {
            await finish()
            controller.error(error)
          }
        }),
        cancel: (reason) => requestScopeStorage.run(store, async () => {
          cancellation ??= Promise.resolve().then(() => reader.cancel(reason))
          try {
            await cancellation
          } finally {
            await finish()
          }
        }),
      }, { highWaterMark: 0 })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }) as OwnedRequestScopeResult<T>
    } catch (error) {
      await closeRequestScopes(ownership)
      throw error
    }
  })
}

export function getRequestScopeContainer(): RequestScopeContainer | null {
  const store = requestScopeStorage.getStore()
  return store?.owner ?? store?.container ?? null
}

type EmittingBus = {
  emit: (event: string, payload: unknown, options?: Record<string, unknown>) => Promise<void>
}

function resolveRequestScopeEventBus(): EmittingBus | null {
  const container = getRequestScopeContainer()
  if (!container) return null
  try {
    const bus = container.resolve<Partial<EmittingBus> | null | undefined>('eventBus')
    return bus && typeof bus.emit === 'function' ? (bus as EmittingBus) : null
  } catch {
    return null
  }
}

setScopedEventBusResolver(resolveRequestScopeEventBus)
