import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: [
      'voice_channels.calls.view',
      'voice_channels.calls.manage',
      'voice_channels.copilot.view',
      'voice_channels.copilot.configure',
      'voice_channels.mock.manage',
    ],
    admin: [
      'voice_channels.calls.view',
      'voice_channels.calls.manage',
      'voice_channels.copilot.view',
      'voice_channels.copilot.configure',
      'voice_channels.mock.manage',
    ],
  },
}

export default setup