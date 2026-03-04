import type { GatewayAdapter } from './adapter'

type AdapterVersionMap = Map<string, GatewayAdapter>

const adaptersByProvider = new Map<string, AdapterVersionMap>()
const defaultVersionByProvider = new Map<string, string>()

export function registerGatewayAdapter(
  adapter: GatewayAdapter,
  options?: { version?: string; isDefault?: boolean },
): () => void {
  const providerKey = adapter.providerKey.trim()
  if (!providerKey) return () => {}

  const version = options?.version?.trim() || 'default'
  const providerMap = adaptersByProvider.get(providerKey) ?? new Map<string, GatewayAdapter>()

  providerMap.set(version, adapter)
  adaptersByProvider.set(providerKey, providerMap)

  if (options?.isDefault || !defaultVersionByProvider.has(providerKey)) {
    defaultVersionByProvider.set(providerKey, version)
  }

  return () => {
    const existing = adaptersByProvider.get(providerKey)
    if (!existing) return
    existing.delete(version)
    if (existing.size === 0) {
      adaptersByProvider.delete(providerKey)
      defaultVersionByProvider.delete(providerKey)
      return
    }

    if (defaultVersionByProvider.get(providerKey) === version) {
      const [nextVersion] = existing.keys()
      if (nextVersion) defaultVersionByProvider.set(providerKey, nextVersion)
    }
  }
}

export function getGatewayAdapter(providerKey: string, version?: string | null): GatewayAdapter | null {
  const providerMap = adaptersByProvider.get(providerKey)
  if (!providerMap) return null
  if (version && providerMap.has(version)) {
    return providerMap.get(version) ?? null
  }

  const defaultVersion = defaultVersionByProvider.get(providerKey)
  if (defaultVersion && providerMap.has(defaultVersion)) {
    return providerMap.get(defaultVersion) ?? null
  }

  const [adapter] = providerMap.values()
  return adapter ?? null
}

export function listGatewayAdapters(providerKey?: string): Array<{ providerKey: string; version: string; adapter: GatewayAdapter }> {
  const result: Array<{ providerKey: string; version: string; adapter: GatewayAdapter }> = []

  if (providerKey) {
    const providerMap = adaptersByProvider.get(providerKey)
    if (!providerMap) return result
    for (const [version, adapter] of providerMap.entries()) {
      result.push({ providerKey, version, adapter })
    }
    return result
  }

  for (const [provider, providerMap] of adaptersByProvider.entries()) {
    for (const [version, adapter] of providerMap.entries()) {
      result.push({ providerKey: provider, version, adapter })
    }
  }

  return result
}
