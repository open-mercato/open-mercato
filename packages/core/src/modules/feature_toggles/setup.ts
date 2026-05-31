import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['feature_toggles.*'],
    admin: ['feature_toggles.view', 'feature_toggles.manage'],
  },
}

export default setup
