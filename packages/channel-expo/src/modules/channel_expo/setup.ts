import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getExpoChannelAdapter } from './lib/adapter'

/**
 * Register the Expo `ChannelAdapter` once per process at import time. Guarded with
 * `hasChannelAdapter` to silence the duplicate error on dev-mode HMR + repeated
 * test imports. Provider credentials (optional access token) are persisted per
 * tenant via the standard `IntegrationCredentials` flow for `channel_expo`.
 */
function ensureExpoAdapterRegistered(): void {
  if (hasChannelAdapter('expo')) return
  registerChannelAdapter(getExpoChannelAdapter())
}

ensureExpoAdapterRegistered()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_expo.view', 'channel_expo.configure'],
    admin: ['channel_expo.view', 'channel_expo.configure'],
  },
  async onTenantCreated() {
    ensureExpoAdapterRegistered()
  },
}

export default setup
