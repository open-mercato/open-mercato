import { AsyncLocalStorage } from 'node:async_hooks'
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

type RequestScopeStore = {
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
  return requestScopeStorage.run({ container, owner: container }, fn)
}

export function bindRequestScopeContainer(container: RequestScopeContainer): void {
  const store = requestScopeStorage.getStore()
  if (store) store.container = container
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
