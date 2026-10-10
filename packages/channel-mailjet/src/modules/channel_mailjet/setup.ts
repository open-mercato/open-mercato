import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getMailjetChannelAdapter } from './lib/adapter'
import { applyMailjetEnvPreset } from './lib/preset'
import { registerMailjetSystemEmailConfigResolver } from './lib/system-email-config'

function ensureMailjetAdapterRegistered(): void {
  if (hasChannelAdapter('mailjet')) return
  registerChannelAdapter(getMailjetChannelAdapter())
}

ensureMailjetAdapterRegistered()
registerMailjetSystemEmailConfigResolver()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_mailjet.view', 'channel_mailjet.configure'],
    admin: ['channel_mailjet.view', 'channel_mailjet.configure'],
  },
  async seedDefaults(ctx) {
    ensureMailjetAdapterRegistered()
    registerMailjetSystemEmailConfigResolver()
    await applyMailjetEnvPreset(ctx)
  },
}

export default setup
