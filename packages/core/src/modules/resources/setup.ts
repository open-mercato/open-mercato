import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedResourcesAddressTypes, seedResourcesCapacityUnits, seedResourcesResourceExamples } from './lib/seeds'
import { isDictionariesModuleEnabled } from './lib/optionalModules'

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    if (isDictionariesModuleEnabled()) await seedResourcesAddressTypes(ctx.em, scope)
  },

  seedExamples: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    if (isDictionariesModuleEnabled()) await seedResourcesCapacityUnits(ctx.em, scope)
    await seedResourcesResourceExamples(ctx.em, scope)
  },

  defaultRoleFeatures: {
    admin: ['resources.*'],
  },
}

export default setup
