import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['attachments.*', 'attachments.view', 'attachments.manage'],
    employee: ['attachments.view'],
  },
}

export default setup
