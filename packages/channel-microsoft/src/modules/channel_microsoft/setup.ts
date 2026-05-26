import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getMicrosoftChannelAdapter } from './lib/adapter'

function ensureMicrosoftAdapterRegistered(): void {
  if (hasChannelAdapter('microsoft')) return
  registerChannelAdapter(getMicrosoftChannelAdapter())
}

ensureMicrosoftAdapterRegistered()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_microsoft.view', 'channel_microsoft.configure'],
    admin: ['channel_microsoft.view', 'channel_microsoft.configure'],
  },
  async onTenantCreated() {
    ensureMicrosoftAdapterRegistered()
  },
}

export default setup
