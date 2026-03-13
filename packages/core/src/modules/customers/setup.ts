import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { CustomFieldEntityConfig } from '@open-mercato/core/modules/entities/data/entities'
import { seedCustomerDictionaries, seedCurrencyDictionary, seedCustomerExamples, seedDefaultPipeline } from './cli'
import { DETAIL_HEADER_FIELDSET } from './lib/detailHelpers'

const DETAIL_HEADER_FIELDSET_DEF = {
  code: DETAIL_HEADER_FIELDSET,
  label: 'Detail header',
  description: 'Fields displayed in the company detail page header.',
}

const COMPANY_ENTITY_IDS = [
  'customers:customer_entity',
  'customers:customer_company_profile',
]

async function seedDetailHeaderFieldset(
  em: any,
  scope: { tenantId: string; organizationId: string },
) {
  for (const entityId of COMPANY_ENTITY_IDS) {
    const existing = await em.findOne(CustomFieldEntityConfig, {
      entityId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (existing) {
      const config = (existing.configJson ?? {}) as Record<string, unknown>
      const fieldsets = Array.isArray(config.fieldsets) ? config.fieldsets : []
      const hasFieldset = fieldsets.some(
        (fs: any) => typeof fs === 'object' && fs?.code === DETAIL_HEADER_FIELDSET,
      )
      if (!hasFieldset) {
        existing.configJson = {
          ...config,
          fieldsets: [...fieldsets, DETAIL_HEADER_FIELDSET_DEF],
        }
      }
    } else {
      const row = em.create(CustomFieldEntityConfig, {
        entityId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        configJson: { fieldsets: [DETAIL_HEADER_FIELDSET_DEF] },
      })
      em.persist(row)
    }
  }
  await em.flush()
}

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedCustomerDictionaries(ctx.em, scope)
    await seedCurrencyDictionary(ctx.em, scope)
    await seedDefaultPipeline(ctx.em, scope)
    await seedDetailHeaderFieldset(ctx.em, scope)
  },

  seedExamples: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedCustomerExamples(ctx.em, ctx.container, scope)
  },

  defaultRoleFeatures: {
    admin: [
      'customers.*',
    ],
    employee: [
      'customers.*',
    ],
  },
}

export default setup
