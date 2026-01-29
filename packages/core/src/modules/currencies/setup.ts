import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedExampleCurrencies } from './lib/seeds'

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedExampleCurrencies(ctx.em, scope)
  },

  defaultRoleFeatures: {
    admin: ['currencies.*'],
  },
}

export default setup
