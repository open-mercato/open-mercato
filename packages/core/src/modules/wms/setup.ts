import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['wms.*'],
    admin: ['wms.*'],
    employee: ['wms.view'],
  },
}

export default setup
