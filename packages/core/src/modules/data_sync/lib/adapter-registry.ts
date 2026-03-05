import type { DataSyncAdapter } from './adapter'

const adapters = new Map<string, DataSyncAdapter>()

export function registerDataSyncAdapter(adapter: DataSyncAdapter): void {
  adapters.set(adapter.providerKey, adapter)
}

export function getDataSyncAdapter(providerKey: string): DataSyncAdapter | undefined {
  return adapters.get(providerKey)
}

export function getAllDataSyncAdapters(): DataSyncAdapter[] {
  return Array.from(adapters.values())
}
