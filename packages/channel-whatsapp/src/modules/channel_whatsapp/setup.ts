import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getWhatsAppChannelAdapter } from './lib/adapter'

function ensureWhatsAppAdapterRegistered(): void {
  if (hasChannelAdapter('whatsapp')) return
  registerChannelAdapter(getWhatsAppChannelAdapter())
}

ensureWhatsAppAdapterRegistered()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_whatsapp.view', 'channel_whatsapp.configure'],
    admin: ['channel_whatsapp.view', 'channel_whatsapp.configure'],
  },
}

export default setup
