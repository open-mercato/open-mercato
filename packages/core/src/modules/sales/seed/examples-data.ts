import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesPaymentMethod, SalesShippingMethod } from '../data/entities'

export type SeedScope = { tenantId: string; organizationId: string }

export type ExampleShippingSeed = {
  code: string
  name: string
  description?: string
  carrierCode?: string
  providerKey?: string
  providerSettings?: Record<string, unknown>
  serviceLevel?: string
  estimatedTransitDays?: number
  baseRateNet: string
  baseRateGross?: string
  currencyCode?: string
}

export const EXAMPLE_SHIPPING_METHODS: ExampleShippingSeed[] = [
  {
    code: 'standard-ground',
    name: 'Standard Ground',
    description: 'Delivery in 3-5 business days.',
    carrierCode: 'ground',
    providerKey: 'flat-rate',
    serviceLevel: 'ground',
    estimatedTransitDays: 5,
    baseRateNet: '9.90',
    baseRateGross: '9.90',
    currencyCode: 'USD',
    providerSettings: {
      applyBaseRate: true,
      rates: [
        {
          id: 'ground-small',
          name: 'Domestic (0-5kg)',
          metric: 'weight',
          min: 0,
          max: 5,
          amountNet: 9.9,
          amountGross: 9.9,
          currencyCode: 'USD',
        },
        {
          id: 'ground-heavy',
          name: 'Heavy parcels (5-20kg)',
          metric: 'weight',
          min: 5,
          max: 20,
          amountNet: 14.9,
          amountGross: 14.9,
          currencyCode: 'USD',
        },
      ],
    },
  },
  {
    code: 'express-air',
    name: 'Express Air',
    description: 'Priority courier (1-2 business days).',
    carrierCode: 'air',
    providerKey: 'flat-rate',
    serviceLevel: 'express',
    estimatedTransitDays: 2,
    baseRateNet: '19.90',
    baseRateGross: '19.90',
    currencyCode: 'USD',
    providerSettings: {
      applyBaseRate: false,
      rates: [
        {
          id: 'express-light',
          name: 'Express 0-2kg',
          metric: 'weight',
          min: 0,
          max: 2,
          amountNet: 24.9,
          amountGross: 24.9,
          currencyCode: 'USD',
        },
        {
          id: 'express-standard',
          name: 'Express 2-10kg',
          metric: 'weight',
          min: 2,
          max: 10,
          amountNet: 39.9,
          amountGross: 39.9,
          currencyCode: 'USD',
        },
      ],
    },
  },
] as const

export type ExamplePaymentSeed = {
  code: string
  name: string
  description?: string
  providerKey?: string
  providerSettings?: Record<string, unknown>
  terms?: string
}

export const EXAMPLE_PAYMENT_METHODS: ExamplePaymentSeed[] = [
  {
    code: 'card',
    name: 'Credit Card',
    description: 'Visa, Mastercard, Amex.',
    providerKey: 'stripe',
    terms: 'Charge is captured on shipment.',
    providerSettings: {
      publishableKey: 'pk_test_example',
      secretKey: 'sk_test_example',
      applicationFeePercent: 2.9,
      applicationFeeFlat: 0.3,
      captureMethod: 'automatic',
    },
  },
  {
    code: 'bank-transfer',
    name: 'Bank Transfer',
    description: 'Pay by wire transfer.',
    providerKey: 'wire-transfer',
    terms: 'Due within 7 days of invoice.',
    providerSettings: {
      instructions: 'Please wire funds to ACME Corp, IBAN XX00 0000 0000 0000 0000 0000.',
      accountNumber: 'ACME-IBAN-0001',
      dueDays: 7,
    },
  },
  {
    code: 'cod',
    name: 'Cash on Delivery',
    description: 'Pay courier on delivery.',
    providerKey: 'cash-on-delivery',
    providerSettings: {
      feeFlat: 4,
      feePercent: 1.5,
      maxOrderTotal: 500,
    },
  },
] as const

type EnsureOptions = { skipFlush?: boolean }

export async function ensureExampleShippingMethods(
  em: EntityManager,
  scope: SeedScope,
  options?: EnsureOptions
): Promise<Map<string, SalesShippingMethod>> {
  const existing = await em.find(SalesShippingMethod, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  const map = new Map<string, SalesShippingMethod>()
  existing.forEach((entry) => map.set((entry.code ?? '').toLowerCase(), entry))
  const now = new Date()
  for (const seed of EXAMPLE_SHIPPING_METHODS) {
    const code = seed.code.toLowerCase()
    if (map.has(code)) continue
    const record = em.create(SalesShippingMethod, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: seed.name,
      code: seed.code,
      description: seed.description,
      carrierCode: seed.carrierCode,
      providerKey: seed.providerKey ?? null,
      serviceLevel: seed.serviceLevel,
      estimatedTransitDays: seed.estimatedTransitDays,
      baseRateNet: seed.baseRateNet,
      baseRateGross: seed.baseRateGross ?? seed.baseRateNet,
      currencyCode: seed.currencyCode ?? 'USD',
      isActive: true,
      metadata:
        seed.providerSettings && Object.keys(seed.providerSettings).length
          ? { providerSettings: seed.providerSettings }
          : null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    map.set(code, record)
  }
  if (!options?.skipFlush) {
    await em.flush()
  }
  return map
}

export async function ensureExamplePaymentMethods(
  em: EntityManager,
  scope: SeedScope,
  options?: EnsureOptions
): Promise<Map<string, SalesPaymentMethod>> {
  const existing = await em.find(SalesPaymentMethod, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  const map = new Map<string, SalesPaymentMethod>()
  existing.forEach((entry) => map.set((entry.code ?? '').toLowerCase(), entry))
  const now = new Date()
  for (const seed of EXAMPLE_PAYMENT_METHODS) {
    const code = seed.code.toLowerCase()
    if (map.has(code)) continue
    const record = em.create(SalesPaymentMethod, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: seed.name,
      code: seed.code,
      description: seed.description ?? null,
      providerKey: seed.providerKey ?? null,
      terms: seed.terms ?? null,
      isActive: true,
      metadata:
        seed.providerSettings && Object.keys(seed.providerSettings).length
          ? { providerSettings: seed.providerSettings }
          : null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    map.set(code, record)
  }
  if (!options?.skipFlush) {
    await em.flush()
  }
  return map
}
