import type { ShippingAdapter } from './adapter'

const adapters = new Map<string, ShippingAdapter>()

export function registerShippingAdapter(adapter: ShippingAdapter): () => void {
  const key = adapter.providerKey.trim()
  if (!key) return () => {}
  adapters.set(key, adapter)
  return () => {
    if (adapters.get(key) === adapter) adapters.delete(key)
  }
}

export function getShippingAdapter(providerKey: string): ShippingAdapter | null {
  return adapters.get(providerKey) ?? null
}

export function listShippingAdapters(): ShippingAdapter[] {
  return Array.from(adapters.values())
}
