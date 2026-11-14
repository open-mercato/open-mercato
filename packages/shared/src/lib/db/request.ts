import { AsyncLocalStorage } from 'node:async_hooks'

const requestKey = Symbol.for('@open-mercato/shared.databaseRequest.v1')
type RequestState = { storage: AsyncLocalStorage<Request> }

function storage(): AsyncLocalStorage<Request> {
  const globals = globalThis as typeof globalThis & { [requestKey]?: RequestState }
  globals[requestKey] ??= { storage: new AsyncLocalStorage<Request>() }
  return globals[requestKey].storage
}

export function runWithDatabaseRequest<Result>(request: Request, callback: () => Result): Result {
  return storage().run(request, callback)
}

export function getDatabaseRequest(): Request | undefined {
  return storage().getStore()
}
