import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getSmtpChannelAdapter } from './lib/adapter'
import { applySmtpEnvPreset } from './lib/preset'
import { registerSmtpSystemEmailConfigResolver } from './lib/system-email-config'

function ensureSmtpAdapterRegistered(): void {
  if (hasChannelAdapter('smtp')) return
  registerChannelAdapter(getSmtpChannelAdapter())
}

ensureSmtpAdapterRegistered()
registerSmtpSystemEmailConfigResolver()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_smtp.view', 'channel_smtp.configure'],
    admin: ['channel_smtp.view', 'channel_smtp.configure'],
  },
  async seedDefaults(ctx) {
    ensureSmtpAdapterRegistered()
    registerSmtpSystemEmailConfigResolver()
    await applySmtpEnvPreset(ctx)
  },
}

export default setup
