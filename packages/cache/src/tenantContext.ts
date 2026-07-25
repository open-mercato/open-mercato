import { AsyncLocalStorage } from 'node:async_hooks'

// Bundlers (Turbopack/esbuild/tsx) can emit this module into multiple chunks,
// each with its own module-local AsyncLocalStorage. A tenant context entered
// through one copy (e.g. an API route's `runWithCacheTenant`) is then invisible
// to the copy the cache service's tenant-aware wrapper reads, so entries get
// stored under the `tenant:global:` prefix while invalidations that DO carry
// the tenant (queue workers, cross-process drains) target `tenant:<id>:` —
// tag-based eviction silently misses and reads stay stale until TTL.
// Key the storage off globalThis via Symbol.for so every duplicated copy
// resolves the same instance. Mirrors the data_sync adapter-registry fix.
const TENANT_STORAGE_KEY = Symbol.for('@open-mercato/cache/tenant-context')

type GlobalWithTenantStorage = typeof globalThis & {
  [TENANT_STORAGE_KEY]?: AsyncLocalStorage<string | null>
}

function resolveTenantStorage(): AsyncLocalStorage<string | null> {
  const scope = globalThis as GlobalWithTenantStorage
  if (!scope[TENANT_STORAGE_KEY]) {
    scope[TENANT_STORAGE_KEY] = new AsyncLocalStorage<string | null>()
  }
  return scope[TENANT_STORAGE_KEY]
}

const tenantStorage = resolveTenantStorage()

export function runWithCacheTenant<T>(tenantId: string | null, fn: () => T): T
export function runWithCacheTenant<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T>
export function runWithCacheTenant<T>(tenantId: string | null, fn: () => T | Promise<T>): T | Promise<T> {
  return tenantStorage.run(tenantId ?? null, fn)
}

export function getCurrentCacheTenant(): string | null {
  return tenantStorage.getStore() ?? null
}
