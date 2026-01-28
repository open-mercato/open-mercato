import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedPlannerUnavailabilityReasons, seedPlannerAvailabilityRuleSetDefaults } from './lib/seeds'

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedPlannerUnavailabilityReasons(ctx.em, scope)
  },

  seedExamples: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedPlannerAvailabilityRuleSetDefaults(ctx.em, scope)
  },

  defaultRoleFeatures: {
    admin: ['planner.*'],
    employee: ['planner.view'],
  },
}

export default setup
