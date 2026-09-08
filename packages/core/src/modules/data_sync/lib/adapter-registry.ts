import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
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

export function resolveProviderKey(integrationId: string): string {
  return getIntegration(integrationId)?.providerKey ?? integrationId
}

/**
 * The adapter serving an integration. Single source of truth on purpose: the
 * engine uses it to decide whether to WRITE the shared cursor row and the start
 * paths use it to decide whether to READ one, and those two decisions must agree
 * for every integration or an opted-out entity type silently resumes wrong.
 */
export function resolveAdapterForIntegration(integrationId: string): DataSyncAdapter | null {
  return getDataSyncAdapter(resolveProviderKey(integrationId)) ?? null
}
