import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureRoles } from '@open-mercato/core/modules/auth/lib/setup-app'
import {
  WMS_CUSTOM_ROLE_NAMES,
  WMS_OPERATOR_FEATURES,
  WMS_OPERATOR_ROLE,
  WMS_SUPERVISOR_FEATURES,
  WMS_SUPERVISOR_ROLE,
} from './lib/roleFeatures'
import { seedWmsIntegrationToggles } from './lib/wmsIntegrationToggles'

async function seedWmsRoles(em: Parameters<typeof ensureRoles>[0], tenantId: string): Promise<void> {
  await ensureRoles(em, { tenantId, roleNames: [...WMS_CUSTOM_ROLE_NAMES] })
}

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    await seedWmsIntegrationToggles(ctx.em)
    await seedWmsRoles(ctx.em, ctx.tenantId)
  },
  defaultRoleFeatures: {
    admin: ['wms.*'],
    employee: ['wms.view'],
    [WMS_OPERATOR_ROLE]: [...WMS_OPERATOR_FEATURES],
    [WMS_SUPERVISOR_ROLE]: [...WMS_SUPERVISOR_FEATURES],
  },
}

export default setup
