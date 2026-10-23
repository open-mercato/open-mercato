import type { ModuleSetupConfig, TenantSetupContext } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { PurchaseSettings, PurchaseDocumentSequence } from './data/entities'

type SeedScope = { tenantId: string; organizationId: string }

async function seedPurchasesSettings(em: EntityManager, scope: SeedScope): Promise<void> {
  const existing = await em.findOne(PurchaseSettings, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })

  if (!existing) {
    const settings = em.create(PurchaseSettings, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      approvalThresholdAmount: '10000.0000',
      approvalThresholdCurrency: 'PLN',
      doubleValidationEnabled: true,
      defaultControlPolicy: 'on_received',
      autoCreateReceiptOnConfirm: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(settings)
  }

  const kinds = ['rfq', 'po', 'pz', 'bill'] as const
  for (const kind of kinds) {
    const seq = await em.findOne(PurchaseDocumentSequence, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      documentKind: kind,
      deletedAt: null,
    })
    if (!seq) {
      em.persist(
        em.create(PurchaseDocumentSequence, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          documentKind: kind,
          currentValue: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      )
    }
  }

  await em.flush()
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['purchases.*'],
    employee: [
      'purchases.orders.view',
      'purchases.orders.manage',
      'purchases.settings.view',
      'purchases.bills.view',
      'purchases.bills.manage',
      'purchases.reordering.view',
      'purchases.reordering.manage',
      'purchases.vendors.view',
      'purchases.vendors.manage',
    ],
  },
  async onTenantCreated(ctx: TenantSetupContext) {
    await seedPurchasesSettings(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },
  async seedExamples(ctx: TenantSetupContext) {
    const { seedPurchaseExamples } = await import('./lib/seeds')
    await seedPurchaseExamples(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },
}

export default setup
