import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['dashboards.*', 'dashboards.admin.assign-widgets', 'analytics.view'],
    employee: ['dashboards.view', 'dashboards.configure', 'analytics.view'],
  },
}

export default setup
