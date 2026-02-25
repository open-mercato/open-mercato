import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['messages.*'],
    admin: [
      'messages.*',
    ],
    employee: [
      'messages.view',
      'messages.compose',
      'messages.attach',
      'messages.attach_files',
      'messages.actions',
    ],
  },
}

export default setup
