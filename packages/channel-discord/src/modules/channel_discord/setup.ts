import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getDiscordChannelAdapter } from './lib/adapter'
import { applyDiscordEnvPreset, CHANNEL_DISCORD_INTEGRATION_ID } from './lib/preset'

const logger = createLogger('channel_discord').child({ component: 'setup' })

/**
 * Register the Discord `ChannelAdapter` exactly once per process at import time.
 * The registry is process-wide, so we guard with `hasChannelAdapter` to silence
 * the duplicate-providerKey error on dev-mode HMR + repeated test imports.
 *
 * Env presets (`OM_CHANNEL_DISCORD_*`, see `lib/preset.ts` and `.env.example`)
 * are optional operator conveniences applied on tenant creation and rerunnable
 * via `yarn mercato channel_discord configure-from-env`; the bot is normally
 * connected via the credential connect flow (`/backend/integrations`). The
 * gateway worker honours `OM_CHANNEL_DISCORD_GATEWAY_DISABLED` to skip the
 * socket in CI / send-only deployments.
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
  async onTenantCreated({ em, organizationId, tenantId }) {
    ensureDiscordAdapterRegistered()

    const integrationLogService = createIntegrationLogService(em)
    try {
      await applyDiscordEnvPreset({
        credentialsService: createCredentialsService(em),
        integrationLogService,
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Discord preset error'
      try {
        await integrationLogService
          .scoped(CHANNEL_DISCORD_INTEGRATION_ID, { tenantId, organizationId })
          .error(`Failed to apply Discord env preset during tenant setup: ${message}`)
      } catch (logError) {
        const logMessage = logError instanceof Error ? logError.message : 'Unknown integration log error'
        logger.error('Failed to apply env preset during tenant setup; persisting to integration logs also failed', {
          presetError: message,
          logError: logMessage,
        })
      }
    }
  },
}

export default setup
