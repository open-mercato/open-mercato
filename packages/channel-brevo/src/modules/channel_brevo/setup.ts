import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getBrevoChannelAdapter } from './lib/adapter'
import { applyBrevoEnvPreset } from './lib/preset'
import { registerBrevoSystemEmailConfigResolver } from './lib/system-email-config'

function ensureBrevoAdapterRegistered(): void {
  if (hasChannelAdapter('brevo')) return
  registerChannelAdapter(getBrevoChannelAdapter())
}

ensureBrevoAdapterRegistered()
registerBrevoSystemEmailConfigResolver()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_brevo.view', 'channel_brevo.configure'],
    admin: ['channel_brevo.view', 'channel_brevo.configure'],
  },
  async seedDefaults(ctx) {
    ensureBrevoAdapterRegistered()
    registerBrevoSystemEmailConfigResolver()
    await applyBrevoEnvPreset(ctx)
  },
}

export default setup
