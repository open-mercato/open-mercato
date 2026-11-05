import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getApnsChannelAdapter } from './lib/adapter'

/**
 * Register the APNs `ChannelAdapter` once per process at import time. Guarded with
 * `hasChannelAdapter` to silence the duplicate error on dev-mode HMR + repeated
 * test imports. Provider credentials (.p8 key + ids) are persisted per tenant via
 * the standard `IntegrationCredentials` flow for the `channel_apns` provider.
 */
function ensureApnsAdapterRegistered(): void {
  if (hasChannelAdapter('apns')) return
  registerChannelAdapter(getApnsChannelAdapter())
}

ensureApnsAdapterRegistered()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_apns.view', 'channel_apns.configure'],
    admin: ['channel_apns.view', 'channel_apns.configure'],
  },
  async onTenantCreated() {
    ensureApnsAdapterRegistered()
  },
}

export default setup
