import { AsyncLocalStorage } from 'node:async_hooks'
import { parseBooleanWithDefault } from '../boolean'
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
 *
 * A scope opened with `shareContainer` (the API dispatcher, when
 * `OM_REQUEST_CONTAINER_MEMO` is on) also lets `createRequestContainer()` build
 * the container once and hand every caller a child scope of it. See #2977.
 */
export type RequestScopeContainer = {
  resolve: <T = unknown>(name: string) => T
}

export type RequestScopeOptions = {
  shareContainer?: boolean
}

export type RequestScopeStats = {
  shareContainer: boolean
  containersBuilt: number
  containersRequested: number
}

type RequestScopeStore = {
  container: RequestScopeContainer | null
  shareContainer: boolean
  sharedRoot: Promise<unknown> | null
  containersBuilt: number
  containersRequested: number
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

export function isRequestContainerMemoEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_REQUEST_CONTAINER_MEMO, false)
}

export function runInRequestScope<T>(fn: () => T, options?: RequestScopeOptions): T {
  return requestScopeStorage.run(
    {
      container: null,
      shareContainer: options?.shareContainer === true,
      sharedRoot: null,
      containersBuilt: 0,
      containersRequested: 0,
    },
    fn,
  )
}

export function bindRequestScopeContainer(container: RequestScopeContainer): void {
  const store = requestScopeStorage.getStore()
  if (store) store.container = container
}

export function getRequestScopeContainer(): RequestScopeContainer | null {
  return requestScopeStorage.getStore()?.container ?? null
}

export function noteRequestContainerRequested(): void {
  const store = requestScopeStorage.getStore()
  if (store) store.containersRequested += 1
}

export function noteRequestContainerBuilt(): void {
  const store = requestScopeStorage.getStore()
  if (store) store.containersBuilt += 1
}

/**
 * Returns the request's shared root container, building it with `build` on the
 * first call. Returns null when the current scope does not share containers, so
 * the caller builds a fresh one. A failed build is forgotten, so the next call
 * retries instead of replaying the rejection for the rest of the request.
 */
export function resolveSharedRequestRoot<T>(build: () => Promise<T>): Promise<T> | null {
  const store = requestScopeStorage.getStore()
  if (!store || !store.shareContainer) return null
  if (!store.sharedRoot) {
    const pending = build()
    store.sharedRoot = pending
    pending.catch(() => {
      if (store.sharedRoot === pending) store.sharedRoot = null
    })
  }
  return store.sharedRoot as Promise<T>
}

/**
 * Stops sharing for the rest of the current scope. The dispatcher calls it once
 * the response is settled, so work that outlives the request (`setImmediate`
 * callbacks, streamed responses) inherits the scope but builds its own
 * container instead of reusing the request's EntityManager.
 */
export function endRequestContainerSharing(): void {
  const store = requestScopeStorage.getStore()
  if (!store) return
  store.shareContainer = false
  store.sharedRoot = null
}

export function getRequestScopeStats(): RequestScopeStats | null {
  const store = requestScopeStorage.getStore()
  if (!store) return null
  return {
    shareContainer: store.shareContainer,
    containersBuilt: store.containersBuilt,
    containersRequested: store.containersRequested,
  }
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
