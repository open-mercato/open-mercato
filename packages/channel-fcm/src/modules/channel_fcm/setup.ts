import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getFcmChannelAdapter } from './lib/adapter'

/**
 * Register the FCM `ChannelAdapter` once per process at import time. The registry
 * is process-wide; we guard with `hasChannelAdapter` to silence the duplicate
 * error on dev-mode HMR + repeated test imports.
 *
 * Provider credentials (the Firebase service account) are persisted per tenant via
 * the standard `IntegrationCredentials` flow for the `channel_fcm` provider; this
 * module never preconfigures credentials from env.
 */
function ensureFcmAdapterRegistered(): void {
  if (hasChannelAdapter('fcm')) return
  registerChannelAdapter(getFcmChannelAdapter())
}

ensureFcmAdapterRegistered()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_fcm.view', 'channel_fcm.configure'],
    admin: ['channel_fcm.view', 'channel_fcm.configure'],
  },
  async onTenantCreated() {
    ensureFcmAdapterRegistered()
  },
}

export default setup
