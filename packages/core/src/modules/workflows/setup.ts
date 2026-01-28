import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedExampleWorkflows } from './lib/seeds'

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedExampleWorkflows(ctx.em, scope)
  },

  defaultRoleFeatures: {
    admin: ['workflows.*'],
  },
}

export default setup
