import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getImapChannelAdapter } from './lib/adapter'

/**
 * The IMAP provider registers its `ChannelAdapter` exactly once per process at
 * import time. We guard with `hasChannelAdapter` so dev-mode HMR or repeated
 * imports during tests don't throw the registry's "duplicate providerKey" error.
 *
 * No per-tenant onTenantCreated work is needed: IMAP credentials are connected
 * by individual users via the `/backend/profile/communication-channels` page,
 * not via tenant-bootstrap env presets.
 */
function ensureImapAdapterRegistered(): void {
  if (hasChannelAdapter('imap')) return
  registerChannelAdapter(getImapChannelAdapter())
}

ensureImapAdapterRegistered()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_imap.view', 'channel_imap.configure'],
    admin: ['channel_imap.view', 'channel_imap.configure'],
  },
  async onTenantCreated() {
    ensureImapAdapterRegistered()
  },
}

export default setup
