import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesPaymentMethod, SalesShippingMethod, SalesTaxRate } from './data/entities'
import { seedSalesAdjustmentKinds, seedSalesStatusDictionaries } from './lib/dictionaries'

const DEFAULT_TAX_RATES = [
  { code: 'vat-23', name: '23% VAT', rate: '23' },
  { code: 'vat-0', name: '0% VAT', rate: '0' },
] as const

type ExampleShippingSeed = {
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

const EXAMPLE_SHIPPING_METHODS: ExampleShippingSeed[] = [
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

type ExamplePaymentSeed = {
  code: string
  name: string
  description?: string
  providerKey?: string
  providerSettings?: Record<string, unknown>
  terms?: string
}

const EXAMPLE_PAYMENT_METHODS: ExamplePaymentSeed[] = [
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

function parseArgs(rest: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part) continue
    if (part.startsWith('--')) {
      const [rawKey, rawValue] = part.slice(2).split('=')
      if (rawValue !== undefined) args[rawKey] = rawValue
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
        args[rawKey] = rest[i + 1]!
        i += 1
      }
    }
  }
  return args
}

const seedTaxRatesCommand: ModuleCli = {
  command: 'seed-tax-rates',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato sales seed-tax-rates --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    try {
      await em.transactional(async (tem) => {
        const existing = await tem.find(SalesTaxRate, {
          tenantId,
          organizationId,
          deletedAt: null,
        })
        const existingCodes = new Set(existing.map((entry) => entry.code.toLowerCase()))
        const hasDefault = existing.some((entry) => entry.isDefault)
        let assignedDefault = hasDefault
        const now = new Date()
        for (const def of DEFAULT_TAX_RATES) {
          if (existingCodes.has(def.code)) continue
          const shouldSetDefault = !assignedDefault
          const record = tem.create(SalesTaxRate, {
            organizationId,
            tenantId,
            name: def.name,
            code: def.code,
            rate: def.rate,
            countryCode: null,
            regionCode: null,
            postalCode: null,
            city: null,
            customerGroupId: null,
            productCategoryId: null,
            channelId: null,
            priority: 0,
            isCompound: false,
            isDefault: shouldSetDefault,
            metadata: null,
            startsAt: null,
            endsAt: null,
            createdAt: now,
            updatedAt: now,
          })
          if (shouldSetDefault) assignedDefault = true
          tem.persist(record)
        }
      })
      console.log('🧾 Tax rates seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedStatusesCommand: ModuleCli = {
  command: 'seed-statuses',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato sales seed-statuses --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedSalesStatusDictionaries(tem, { tenantId, organizationId })
        await tem.flush()
      })
      console.log('🚦 Sales order statuses seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedAdjustmentKindsCommand: ModuleCli = {
  command: 'seed-adjustment-kinds',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato sales seed-adjustment-kinds --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedSalesAdjustmentKinds(tem, { tenantId, organizationId })
        await tem.flush()
      })
      console.log('⚙️  Sales adjustment kinds seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedShippingMethodsCommand: ModuleCli = {
  command: 'seed-shipping-methods',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato sales seed-shipping-methods --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        const existing = await tem.find(SalesShippingMethod, {
          tenantId,
          organizationId,
          deletedAt: null,
        })
        const existingCodes = new Set(existing.map((entry) => (entry.code ?? '').toLowerCase()))
        const now = new Date()
        for (const seed of EXAMPLE_SHIPPING_METHODS) {
          if (existingCodes.has(seed.code)) continue
          const record = tem.create(SalesShippingMethod, {
            organizationId,
            tenantId,
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
          tem.persist(record)
        }
      })
      console.log('🚚 Shipping methods seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedPaymentMethodsCommand: ModuleCli = {
  command: 'seed-payment-methods',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato sales seed-payment-methods --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        const existing = await tem.find(SalesPaymentMethod, {
          tenantId,
          organizationId,
          deletedAt: null,
        })
        const existingCodes = new Set(existing.map((entry) => (entry.code ?? '').toLowerCase()))
        const now = new Date()
        for (const seed of EXAMPLE_PAYMENT_METHODS) {
          if (existingCodes.has(seed.code)) continue
          const record = tem.create(SalesPaymentMethod, {
            organizationId,
            tenantId,
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
          tem.persist(record)
        }
      })
      console.log('💳 Payment methods seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [
  seedTaxRatesCommand,
  seedStatusesCommand,
  seedAdjustmentKindsCommand,
  seedShippingMethodsCommand,
  seedPaymentMethodsCommand,
]
