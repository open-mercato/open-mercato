import type { ShippingAdapter } from './adapter'

const SHIPPING_ADAPTER_REGISTRY_KEY = Symbol.for('@open-mercato/shipping-carriers/adapter-registry')

type GlobalWithShippingRegistry = typeof globalThis & {
  [SHIPPING_ADAPTER_REGISTRY_KEY]?: Map<string, ShippingAdapter>
}

function getAdapterRegistry(): Map<string, ShippingAdapter> {
  const globalScope = globalThis as GlobalWithShippingRegistry
  if (!globalScope[SHIPPING_ADAPTER_REGISTRY_KEY]) {
    globalScope[SHIPPING_ADAPTER_REGISTRY_KEY] = new Map<string, ShippingAdapter>()
  }
  return globalScope[SHIPPING_ADAPTER_REGISTRY_KEY]
}

export function registerShippingAdapter(adapter: ShippingAdapter): () => void {
  const adapterRegistry = getAdapterRegistry()
  adapterRegistry.set(adapter.providerKey, adapter)
  return () => adapterRegistry.delete(adapter.providerKey)
}

export function getShippingAdapter(providerKey: string): ShippingAdapter | undefined {
  return getAdapterRegistry().get(providerKey)
}

export function listShippingAdapters(): ShippingAdapter[] {
  return Array.from(getAdapterRegistry().values())
}

export function clearShippingAdapters(): void {
  getAdapterRegistry().clear()
}
