import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { SalesSettings, SalesDocumentSequence, SalesTaxRate } from './data/entities'
import { DEFAULT_ORDER_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT } from './lib/documentNumberTokens'
import { seedSalesStatusDictionaries, seedSalesAdjustmentKinds } from './lib/dictionaries'
import { ensureExampleShippingMethods, ensureExamplePaymentMethods } from './seed/examples-data'
import { seedSalesExamples } from './seed/examples'

type SeedScope = { tenantId: string; organizationId: string }

const DEFAULT_TAX_RATES = [
  { code: 'vat-23', name: '23% VAT', rate: '23' },
  { code: 'vat-0', name: '0% VAT', rate: '0' },
] as const

async function seedSalesTaxRates(em: EntityManager, scope: SeedScope): Promise<void> {
  await em.transactional(async (tem) => {
    const existing = await tem.find(SalesTaxRate, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    const existingCodes = new Set(existing.map((rate) => rate.code))
    const hasDefault = existing.some((rate) => rate.isDefault)
    const now = new Date()
    let isFirst = !hasDefault

    for (const seed of DEFAULT_TAX_RATES) {
      if (existingCodes.has(seed.code)) continue
      tem.persist(
        tem.create(SalesTaxRate, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          code: seed.code,
          name: seed.name,
          rate: seed.rate,
          priority: 0,
          isCompound: false,
          isDefault: isFirst,
          createdAt: now,
          updatedAt: now,
        })
      )
      isFirst = false
    }
  })
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['sales.*', 'sales.documents.number.edit'],
    employee: ['sales.*'],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    const exists = await em.findOne(SalesSettings, { tenantId, organizationId })
    if (!exists) {
      em.persist(
        em.create(SalesSettings, {
          tenantId,
          organizationId,
          orderNumberFormat: DEFAULT_ORDER_NUMBER_FORMAT,
          quoteNumberFormat: DEFAULT_QUOTE_NUMBER_FORMAT,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      )
    }

    for (const kind of ['order', 'quote'] as const) {
      const seq = await em.findOne(SalesDocumentSequence, {
        tenantId,
        organizationId,
        documentKind: kind,
      })
      if (!seq) {
        em.persist(
          em.create(SalesDocumentSequence, {
            tenantId,
            organizationId,
            documentKind: kind,
            currentValue: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        )
      }
    }

    await em.flush()
  },

  async seedDefaults({ em, tenantId, organizationId }) {
    const scope = { tenantId, organizationId }
    await seedSalesTaxRates(em, scope)
    await seedSalesStatusDictionaries(em, scope)
    await seedSalesAdjustmentKinds(em, scope)
    await ensureExampleShippingMethods(em, scope)
    await ensureExamplePaymentMethods(em, scope)
  },

  async seedExamples({ em, container, tenantId, organizationId }) {
    const scope = { tenantId, organizationId }
    await seedSalesExamples(em, container, scope)
  },
}

export default setup
