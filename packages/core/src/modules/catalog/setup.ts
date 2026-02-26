import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedCatalogUnits, seedCatalogPriceKinds, seedCatalogExamplesForScope } from './lib/seeds'

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedCatalogUnits(ctx.em, scope)
    await seedCatalogPriceKinds(ctx.em, scope)
  },

  seedExamples: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedCatalogExamplesForScope(ctx.em, ctx.container, scope)
  },

  defaultRoleFeatures: {
    admin: ['catalog.*', 'catalog.variants.manage', 'catalog.pricing.manage', 'catalog.price_history.view', 'catalog.settings.view', 'catalog.settings.edit'],
    employee: ['catalog.*', 'catalog.variants.manage', 'catalog.pricing.manage', 'catalog.price_history.view', 'catalog.settings.view'],
  },
}

export default setup
