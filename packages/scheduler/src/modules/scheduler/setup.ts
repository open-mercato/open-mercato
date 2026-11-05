import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['scheduler.*'],
    employee: ['scheduler.jobs.view'],
  },
}

export default setup
