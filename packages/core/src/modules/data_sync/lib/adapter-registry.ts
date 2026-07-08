import type { DataSyncAdapter } from './adapter'

// Back the registry with globalThis, keyed by a well-known Symbol, so it survives
// bundler module duplication (Turbopack/esbuild/tsx). Those bundlers can emit the
// same file into multiple chunks, each with its own module-local state — so an
// adapter registered from a module's `di.ts` (one copy) would be invisible to
// `/api/data_sync/run` (another copy), throwing "No registered sync adapter for
// provider" in production builds. Mirrors shipping_carriers' adapter-registry.
const DATA_SYNC_ADAPTER_REGISTRY_KEY = Symbol.for('@open-mercato/core/data_sync/adapter-registry')

type GlobalWithAdapterRegistry = typeof globalThis & {
  [DATA_SYNC_ADAPTER_REGISTRY_KEY]?: Map<string, DataSyncAdapter>
}

function getAdapterRegistry(): Map<string, DataSyncAdapter> {
  const globalScope = globalThis as GlobalWithAdapterRegistry
  if (!globalScope[DATA_SYNC_ADAPTER_REGISTRY_KEY]) {
    globalScope[DATA_SYNC_ADAPTER_REGISTRY_KEY] = new Map<string, DataSyncAdapter>()
  }
  return globalScope[DATA_SYNC_ADAPTER_REGISTRY_KEY]
}

export function registerDataSyncAdapter(adapter: DataSyncAdapter): void {
  getAdapterRegistry().set(adapter.providerKey, adapter)
}

export function getDataSyncAdapter(providerKey: string): DataSyncAdapter | undefined {
  return getAdapterRegistry().get(providerKey)
}

export function getAllDataSyncAdapters(): DataSyncAdapter[] {
  return Array.from(getAdapterRegistry().values())
}
