import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['data_quality.*'],
    employee: [
      'data_quality.view',
      'data_quality.check.view',
      'data_quality.suite.view',
      'data_quality.scan.view',
      'data_quality.finding.view',
    ],
  },
}

export default setup
