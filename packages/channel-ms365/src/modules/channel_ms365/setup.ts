import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getMs365ChannelAdapter } from './lib/adapter'

/**
 * Register the Microsoft 365 `ChannelAdapter` once per process at import time.
 * The registry is process-wide so the underlying `setRegister` call is
 * idempotent; we guard with `hasChannelAdapter` to silence the registry's
 * duplicate error on dev-mode HMR + repeated test imports.
 *
 * Tenant-level OAuth client config (Client ID + Client Secret + Tenant ID) is
 * persisted via the standard `IntegrationCredentials` flow for the `ms365`
 * provider; this module does not preconfigure per-tenant credentials from env
 * (Entra app registrations are explicit per-tenant).
 */
function ensureMs365AdapterRegistered(): void {
  if (hasChannelAdapter('ms365')) return
  registerChannelAdapter(getMs365ChannelAdapter())
}

ensureMs365AdapterRegistered()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_ms365.view', 'channel_ms365.configure'],
    admin: ['channel_ms365.view', 'channel_ms365.configure'],
  },
  async onTenantCreated() {
    ensureMs365AdapterRegistered()
  },
}

export default setup
