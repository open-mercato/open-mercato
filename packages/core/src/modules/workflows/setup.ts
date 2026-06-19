import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { resolveBusinessRuleDiscoveryCache } from '@open-mercato/core/modules/business_rules/lib/rule-engine'
import { seedExampleWorkflows } from './lib/seeds'

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const cache = resolveBusinessRuleDiscoveryCache(ctx.container.resolve.bind(ctx.container))
    await seedExampleWorkflows(ctx.em, scope, { cache })
  },

  defaultRoleFeatures: {
    admin: ['workflows.*'],
  },
}

export default setup
