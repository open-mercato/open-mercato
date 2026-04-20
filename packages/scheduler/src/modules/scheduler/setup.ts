import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['scheduler.*'],
    employee: ['scheduler.job.view'],
  },
}

export default setup
