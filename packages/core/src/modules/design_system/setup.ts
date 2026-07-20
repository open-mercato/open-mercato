import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    // The gallery and mockup renderer read no tenant data, so the view grant is
    // safe to hand out broadly. Mockup writes (dev-only annotation write-back)
    // default to admin only. Superadmin is covered by wildcard grants.
    admin: ['design_system.view', 'design_system.mockups.manage'],
    employee: ['design_system.view'],
  },
}

export default setup
