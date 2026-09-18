import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    // View-only module: the gallery reads no tenant data, so the grant is safe
    // to hand out broadly. Superadmin is covered by wildcard grants.
    admin: ['design_system.view'],
    employee: ['design_system.view'],
  },
}

export default setup
