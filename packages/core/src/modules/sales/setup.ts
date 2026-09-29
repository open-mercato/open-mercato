import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { SalesSettings, SalesDocumentSequence, SalesTaxRate } from './data/entities'
import { DEFAULT_ORDER_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT } from './lib/documentNumberTokens'
import { seedSalesStatusDictionaries, seedSalesAdjustmentKinds } from './lib/dictionaries'
import { seedSalesChannelsToggle } from './lib/salesChannelsToggleSeed'
import { ensureExampleShippingMethods, ensureExamplePaymentMethods } from './seed/examples-data'
import { seedSalesExamples } from './seed/examples'
import { createDocumentSequence } from './services/salesDocumentNumberGenerator'

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
    employee: [
      'sales.channels.view',
      'sales.channels.manage',
      'sales.settings.view',
      'sales.settings.manage',
      'sales.orders.view',
      'sales.orders.manage',
      'sales.orders.approve',
      'sales.widgets.new-orders',
      'sales.widgets.new-quotes',
      'sales.quotes.view',
      'sales.quotes.manage',
      'sales.shipments.manage',
      'sales.payments.manage',
      'sales.returns.view',
      'sales.returns.create',
      'sales.returns.manage',
      'sales.invoices.manage',
      'sales.credit_memos.manage',
    ],
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

    const sequenceRows: SalesDocumentSequence[] = []
    for (const kind of ['order', 'quote', 'return', 'invoice', 'credit_memo'] as const) {
      const seq = await em.findOne(SalesDocumentSequence, {
        tenantId,
        organizationId,
        documentKind: kind,
      })
      sequenceRows.push(
        seq ??
          em.create(SalesDocumentSequence, {
            tenantId,
            organizationId,
            documentKind: kind,
            currentValue: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
      )
      if (!seq) em.persist(sequenceRows[sequenceRows.length - 1]!)
    }

    await em.flush()

    // Each registry row is backed by its own Postgres sequence (#5604); create them now so the
    // first document of a fresh tenant does not have to fall back to lazy creation. The ids come
    // from the rows just flushed rather than from a re-read: `createDocumentSequence` issues DDL
    // over `em.getConnection()`, which runs outside the EntityManager's transaction context, so
    // a read on that connection would not see rows this hook wrote inside a transaction and the
    // loop would silently create nothing.
    for (const row of sequenceRows) {
      await createDocumentSequence(em, row.id)
    }
  },

  async seedDefaults({ em, tenantId, organizationId }) {
    const scope = { tenantId, organizationId }
    await seedSalesTaxRates(em, scope)
    await seedSalesStatusDictionaries(em, scope)
    await seedSalesAdjustmentKinds(em, scope)
    await ensureExampleShippingMethods(em, scope)
    await ensureExamplePaymentMethods(em, scope)
    await seedSalesChannelsToggle(em)
  },

  async seedExamples({ em, container, tenantId, organizationId }) {
    const scope = { tenantId, organizationId }
    await seedSalesExamples(em, container, scope)
  },
}

export default setup
