import { z } from 'zod'
import type { PaymentProvider, ShippingProvider } from './types'

type ProviderKind = 'shipping' | 'payment'

const shippingProviders = new Map<string, ShippingProvider>()
const paymentProviders = new Map<string, PaymentProvider>()

const providerSettingsSchema = z.record(z.string(), z.unknown()).optional()

function registerProvider<T extends ShippingProvider | PaymentProvider>(
  kind: ProviderKind,
  provider: T
) {
  if (!provider.key) return
  const map = kind === 'shipping' ? shippingProviders : paymentProviders
  const normalizedKey = provider.key.trim()
  if (!normalizedKey) return
  map.set(normalizedKey, { ...provider, key: normalizedKey })
}

export function registerShippingProvider(provider: ShippingProvider) {
  registerProvider('shipping', provider)
  return () => {
    shippingProviders.delete(provider.key)
  }
}

export function registerPaymentProvider(provider: PaymentProvider) {
  registerProvider('payment', provider)
  return () => {
    paymentProviders.delete(provider.key)
  }
}

export function listShippingProviders(): ShippingProvider[] {
  return Array.from(shippingProviders.values())
}

export function listPaymentProviders(): PaymentProvider[] {
  return Array.from(paymentProviders.values())
}

export function getShippingProvider(key: string | null | undefined): ShippingProvider | null {
  if (!key) return null
  return shippingProviders.get(key) ?? null
}

export function getPaymentProvider(key: string | null | undefined): PaymentProvider | null {
  if (!key) return null
  return paymentProviders.get(key) ?? null
}

export function normalizeProviderSettings(
  kind: ProviderKind,
  providerKey: string | null | undefined,
  settings: unknown
): Record<string, unknown> | null {
  const parsed = providerSettingsSchema.safeParse(settings)
  if (!providerKey || !parsed.success) return parsed.success ? parsed.data ?? null : null
  const provider = kind === 'shipping' ? getShippingProvider(providerKey) : getPaymentProvider(providerKey)
  if (!provider || !provider.settings?.schema) return parsed.data ?? null
  const normalized = provider.settings.schema.safeParse(parsed.data ?? {})
  if (!normalized.success) {
    return parsed.data ?? null
  }
  return normalized.data ?? null
}
