import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { PaymentProvider, ShippingProvider, TaxProvider } from './types'

type ProviderKind = 'shipping' | 'payment' | 'tax'

const logger = createLogger('sales')

const shippingProviders = new Map<string, ShippingProvider>()
const paymentProviders = new Map<string, PaymentProvider>()
const taxProviders = new Map<string, TaxProvider>()

const providerSettingsSchema = z.record(z.string(), z.unknown()).optional()

export function registerShippingProvider(provider: ShippingProvider) {
  if (!provider.key) return () => {}
  const normalizedKey = provider.key.trim()
  if (!normalizedKey) return () => {}
  shippingProviders.set(normalizedKey, { ...provider, key: normalizedKey })
  return () => {
    shippingProviders.delete(provider.key)
  }
}

export function registerPaymentProvider(provider: PaymentProvider) {
  if (!provider.key) return () => {}
  const normalizedKey = provider.key.trim()
  if (!normalizedKey) return () => {}
  paymentProviders.set(normalizedKey, { ...provider, key: normalizedKey })
  return () => {
    paymentProviders.delete(provider.key)
  }
}

/**
 * Registers a tax provider under its key, overwriting an existing registration
 * with the same key so a module reload is idempotent. Secret settings fields are
 * dropped: a tax provider's secrets belong to the integrations module, which
 * encrypts them at rest and masks them in the admin UI, while provider settings
 * are stored in clear on the settings row.
 */
export function registerTaxProvider(provider: TaxProvider) {
  if (!provider.key) return () => {}
  const normalizedKey = provider.key.trim()
  if (!normalizedKey) return () => {}
  const fields = provider.settings?.fields
  const secretFields = fields?.filter((field) => field.type === 'secret') ?? []
  for (const field of secretFields) {
    logger.warn('tax provider settings must not declare secret fields', {
      key: normalizedKey,
      field: field.key,
    })
  }
  const settings = provider.settings
    ? { ...provider.settings, ...(fields ? { fields: fields.filter((field) => field.type !== 'secret') } : {}) }
    : provider.settings
  taxProviders.set(normalizedKey, { ...provider, key: normalizedKey, settings })
  return () => {
    taxProviders.delete(normalizedKey)
  }
}

export function listShippingProviders(): ShippingProvider[] {
  return Array.from(shippingProviders.values())
}

export function listPaymentProviders(): PaymentProvider[] {
  return Array.from(paymentProviders.values())
}

export function listTaxProviders(): TaxProvider[] {
  return Array.from(taxProviders.values())
}

export function getShippingProvider(key: string | null | undefined): ShippingProvider | null {
  if (!key) return null
  return shippingProviders.get(key) ?? null
}

export function getPaymentProvider(key: string | null | undefined): PaymentProvider | null {
  if (!key) return null
  return paymentProviders.get(key) ?? null
}

export function getTaxProvider(key: string | null | undefined): TaxProvider | null {
  if (!key) return null
  return taxProviders.get(key) ?? null
}

export function normalizeProviderSettings(
  kind: ProviderKind,
  providerKey: string | null | undefined,
  settings: unknown
): Record<string, unknown> | null {
  const parsed = providerSettingsSchema.safeParse(settings)
  if (!providerKey || !parsed.success) return parsed.success ? (parsed.data ?? null) as Record<string, unknown> | null : null
  const provider =
    kind === 'shipping'
      ? getShippingProvider(providerKey)
      : kind === 'payment'
        ? getPaymentProvider(providerKey)
        : getTaxProvider(providerKey)
  if (!provider || !provider.settings?.schema) return parsed.data ?? null
  const normalized = provider.settings.schema.safeParse(parsed.data ?? {})
  if (!normalized.success) {
    return parsed.data ?? null
  }
  return (normalized.data ?? null) as Record<string, unknown> | null
}
