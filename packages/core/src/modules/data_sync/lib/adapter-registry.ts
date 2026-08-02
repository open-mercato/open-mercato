import type { DataSyncAdapter } from './adapter'

const DATA_SYNC_ADAPTER_REGISTRY_KEY = Symbol.for('@open-mercato/data-sync/adapter-registry')

type GlobalWithDataSyncRegistry = typeof globalThis & {
  [DATA_SYNC_ADAPTER_REGISTRY_KEY]?: Map<string, DataSyncAdapter>
}

function getAdapterRegistry(): Map<string, DataSyncAdapter> {
  const globalScope = globalThis as GlobalWithDataSyncRegistry
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
