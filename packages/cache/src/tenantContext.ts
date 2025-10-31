import { AsyncLocalStorage } from 'node:async_hooks'

const tenantStorage = new AsyncLocalStorage<string | null>()

export function runWithCacheTenant<T>(tenantId: string | null, fn: () => T): T
export function runWithCacheTenant<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T>
export function runWithCacheTenant<T>(tenantId: string | null, fn: () => T | Promise<T>): T | Promise<T> {
  return tenantStorage.run(tenantId ?? null, fn)
}

export function getCurrentCacheTenant(): string | null {
  return tenantStorage.getStore() ?? null
}
