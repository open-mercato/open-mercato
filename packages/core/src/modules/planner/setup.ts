import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { seedPlannerUnavailabilityReasons, seedPlannerAvailabilityRuleSetDefaults } from './lib/seeds'
import { isDictionariesModuleEnabled } from './lib/optionalModules'

const logger = createLogger('planner')

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    if (isDictionariesModuleEnabled()) {
      await seedPlannerUnavailabilityReasons(ctx.em, scope)
    } else {
      logger.info('Dictionaries module is disabled; skipping planner unavailability reasons')
    }
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
