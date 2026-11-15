import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getSesChannelAdapter } from './lib/adapter'
import { applySesEnvPreset } from './lib/preset'
import { registerSesSystemEmailConfigResolver } from './lib/system-email-config'

function ensureSesAdapterRegistered(): void {
  if (hasChannelAdapter('ses')) return
  registerChannelAdapter(getSesChannelAdapter())
}

ensureSesAdapterRegistered()
registerSesSystemEmailConfigResolver()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_ses.view', 'channel_ses.configure'],
    admin: ['channel_ses.view', 'channel_ses.configure'],
  },
  async seedDefaults(ctx) {
    ensureSesAdapterRegistered()
    registerSesSystemEmailConfigResolver()
    await applySesEnvPreset(ctx)
  },
}

export default setup
