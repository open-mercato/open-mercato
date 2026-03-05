import type { ShippingAdapter } from './adapter'

const adapterRegistry = new Map<string, ShippingAdapter>()

export function registerShippingAdapter(adapter: ShippingAdapter): () => void {
  adapterRegistry.set(adapter.providerKey, adapter)
  return () => adapterRegistry.delete(adapter.providerKey)
}

export function getShippingAdapter(providerKey: string): ShippingAdapter | undefined {
  return adapterRegistry.get(providerKey)
}

export function listShippingAdapters(): ShippingAdapter[] {
  return Array.from(adapterRegistry.values())
}

export function clearShippingAdapters(): void {
  adapterRegistry.clear()
}
