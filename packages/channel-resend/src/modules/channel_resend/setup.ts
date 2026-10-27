import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getResendChannelAdapter } from './lib/adapter'
import { applyResendEnvPreset } from './lib/preset'
import { registerResendSystemEmailConfigResolver } from './lib/system-email-config'

function ensureResendAdapterRegistered(): void {
  if (hasChannelAdapter('resend')) return
  registerChannelAdapter(getResendChannelAdapter())
}

ensureResendAdapterRegistered()
registerResendSystemEmailConfigResolver()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_resend.view', 'channel_resend.configure'],
    admin: ['channel_resend.view', 'channel_resend.configure'],
  },
  async seedDefaults(ctx) {
    ensureResendAdapterRegistered()
    registerResendSystemEmailConfigResolver()
    await applyResendEnvPreset(ctx)
  },
}

export default setup
