import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getGmailChannelAdapter } from './lib/adapter'

/**
 * Register the Gmail `ChannelAdapter` once per process at import time. The
 * registry is process-wide so the underlying `setRegister` call is idempotent;
 * we guard with `hasChannelAdapter` to silence the registry's duplicate error
 * on dev-mode HMR + repeated test imports.
 *
 * Tenant-level OAuth client config (Client ID + Client Secret) is persisted via
 * the standard `IntegrationCredentials` flow for the `gmail` provider; this
 * module does not preconfigure per-tenant credentials from env (Google Cloud
 * Console projects are explicit per-tenant).
 */
function ensureGmailAdapterRegistered(): void {
  if (hasChannelAdapter('gmail')) return
  registerChannelAdapter(getGmailChannelAdapter())
}

ensureGmailAdapterRegistered()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_gmail.view', 'channel_gmail.configure'],
    admin: ['channel_gmail.view', 'channel_gmail.configure'],
  },
  async onTenantCreated() {
    ensureGmailAdapterRegistered()
  },
}

export default setup
