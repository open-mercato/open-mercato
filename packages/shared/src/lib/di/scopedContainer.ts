// #8268 review Major 1/2 (re-review): several runtime seams — the event bus's
// subscriber context (`packages/events/src/bus.ts`'s `deliver()`/`dispatchQueued()`)
// and queue workers' job context — hand handlers only a bound `resolve` function,
// never a real Awilix container. A handler that calls into command-bus code
// expecting a full `CommandRuntimeContext['container']` (several command phases call
// `container.register({ auth: asValue(...) })` to override the trusted auth scope for
// nested resolution) then crashes with "register is not a function" the moment that
// code path runs for real — invisible to a test that mocks the command bus at that
// boundary. This builds the minimal real container those call sites need: local
// `register()` overrides shadow `resolve()`, unwrapping a value-style Awilix
// resolver (`asValue(...)` — the only form every known call site registers) the same
// way a real container would, and everything else falls through to the caller's own
// resolver — the same shape a `createScope()`'d Awilix child container presents,
// without needing the parent Awilix instance these seams never hand out. A function-
// style resolver (`asFunction`/`asClass`) is NOT supported: those inspect the real
// container's internals (injection mode, registrations) beyond a bare `resolve()`
// call, which this lightweight shim does not provide.

export type ScopedResolveContainer = {
  resolve: <T = unknown>(name: string) => T
  register: (registrations: Record<string, unknown>) => void
}

function isAwilixLikeResolver(value: unknown): value is { resolve: (container?: unknown) => unknown } {
  return Boolean(value && typeof value === 'object' && typeof (value as { resolve?: unknown }).resolve === 'function')
}

export function buildScopedContainerFromResolve(resolve: <T = unknown>(name: string) => T): ScopedResolveContainer {
  const overrides = new Map<string, unknown>()
  const scoped: ScopedResolveContainer = {
    resolve: <T = unknown>(name: string): T => {
      if (overrides.has(name)) {
        const entry = overrides.get(name)
        return (isAwilixLikeResolver(entry) ? entry.resolve(scoped) : entry) as T
      }
      return resolve<T>(name)
    },
    register: (registrations: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(registrations)) {
        overrides.set(key, value)
      }
    },
  }
  return scoped
}
