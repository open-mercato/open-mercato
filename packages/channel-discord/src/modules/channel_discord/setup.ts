import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getDiscordChannelAdapter } from './lib/adapter'

/**
 * Register the Discord `ChannelAdapter` exactly once per process at import time.
 * The registry is process-wide, so we guard with `hasChannelAdapter` to silence
 * the duplicate-providerKey error on dev-mode HMR + repeated test imports.
 *
 * Env presets (`OM_CHANNEL_DISCORD_*`, see integration docs) are optional
 * operator conveniences; the bot is normally connected via the credential
 * connect flow (`/backend/integrations`). The gateway worker honours
 * `OM_CHANNEL_DISCORD_GATEWAY_DISABLED` to skip the socket in CI / send-only
 * deployments.
 */
function ensureDiscordAdapterRegistered(): void {
  if (hasChannelAdapter('discord')) return
  registerChannelAdapter(getDiscordChannelAdapter())
}

ensureDiscordAdapterRegistered()

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['channel_discord.view', 'channel_discord.configure'],
    admin: ['channel_discord.view', 'channel_discord.configure'],
  },
  async onTenantCreated() {
    ensureDiscordAdapterRegistered()
  },
}

export default setup
