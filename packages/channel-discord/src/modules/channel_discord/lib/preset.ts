import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { discordCredentialsSchema, type DiscordCredentials } from './credentials'

export const CHANNEL_DISCORD_INTEGRATION_ID = 'channel_discord'

export type DiscordEnvPreset = {
  credentials: DiscordCredentials
  force: boolean
}

export type ApplyDiscordPresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured' }

function readEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

/**
 * Read the deployment-managed Discord bootstrap credentials from the environment
 * (SPEC 2026-06-19 § Connect the channel in Open Mercato).
 *
 * Returns `null` when no `OM_CHANNEL_DISCORD_*` credential var is set at all —
 * the normal case, where the bot is connected interactively through
 * `/backend/integrations`. When any of them IS set the preset must be complete,
 * so a half-filled deployment fails loudly instead of persisting a bot token
 * that cannot authenticate. The bot token is never logged or echoed.
 */
export function readDiscordEnvPreset(env: NodeJS.ProcessEnv = process.env): DiscordEnvPreset | null {
  const botToken = readEnvValue(env, 'OM_CHANNEL_DISCORD_BOT_TOKEN')
  const applicationId = readEnvValue(env, 'OM_CHANNEL_DISCORD_APPLICATION_ID')
  const publicKey = readEnvValue(env, 'OM_CHANNEL_DISCORD_PUBLIC_KEY')
  const guildId = readEnvValue(env, 'OM_CHANNEL_DISCORD_GUILD_ID')
  const defaultChannelId = readEnvValue(env, 'OM_CHANNEL_DISCORD_DEFAULT_CHANNEL_ID')

  if (!botToken && !applicationId && !publicKey) return null

  const parsed = discordCredentialsSchema.safeParse({
    botToken,
    applicationId,
    publicKey,
    ...(guildId ? { guildId } : {}),
    ...(defaultChannelId ? { defaultChannelId } : {}),
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(
      '[internal] Incomplete Discord env preset. Set OM_CHANNEL_DISCORD_BOT_TOKEN, ' +
        'OM_CHANNEL_DISCORD_APPLICATION_ID and OM_CHANNEL_DISCORD_PUBLIC_KEY ' +
        `(${first?.path.join('.') ?? 'credentials'}: ${first?.message ?? 'invalid'}).`,
    )
  }

  return {
    credentials: parsed.data,
    force: parseBooleanToken(env.OM_CHANNEL_DISCORD_FORCE_PRECONFIGURE) ?? false,
  }
}

/**
 * Apply the env preset to one (tenant, organization) scope through the standard
 * integration credential service — never by special-casing the provider in core.
 *
 * Existing credentials win unless `OM_CHANNEL_DISCORD_FORCE_PRECONFIGURE` (or an
 * explicit `force`) says otherwise, so re-running tenant setup or the
 * `configure-from-env` CLI command is safe and idempotent.
 */
export async function applyDiscordEnvPreset(params: {
  credentialsService: CredentialsService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyDiscordPresetResult> {
  const preset = readDiscordEnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No Discord preset env variables were provided.' }
  }

  const force = params.force ?? preset.force
  if (!force) {
    const existing = await params.credentialsService.getRaw(CHANNEL_DISCORD_INTEGRATION_ID, params.scope)
    if (existing) {
      return {
        status: 'skipped',
        reason:
          'Discord credentials already exist. Use OM_CHANNEL_DISCORD_FORCE_PRECONFIGURE=true to overwrite.',
      }
    }
  }

  await params.credentialsService.save(CHANNEL_DISCORD_INTEGRATION_ID, preset.credentials, params.scope)

  if (params.integrationLogService) {
    await params.integrationLogService
      .scoped(CHANNEL_DISCORD_INTEGRATION_ID, params.scope)
      .info('Discord integration was preconfigured from environment variables.', {
        applicationId: preset.credentials.applicationId,
        guildId: preset.credentials.guildId ?? null,
        defaultChannelId: preset.credentials.defaultChannelId ?? null,
      })
  }

  return { status: 'configured' }
}
