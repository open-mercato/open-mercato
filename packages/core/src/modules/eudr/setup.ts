import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['eudr.*'],
    employee: ['eudr.mappings.view', 'eudr.submissions.view', 'eudr.statements.view', 'eudr.plots.view', 'eudr.risk.view'],
  },
}

export default setup
