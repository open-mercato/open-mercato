import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { discordCredentialsSchema } from './credentials'
import { DiscordApiError, getDiscordRestClient } from './discord-rest'

export type HealthCheckStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthCheckResult {
  status: HealthCheckStatus
  message?: string
  details?: Record<string, unknown>
}

/**
 * Liveness probe for the Discord integration. The hub resolves it by the service
 * name declared in `integration.ts` (`channelDiscordHealthCheck`) and passes the
 * tenant-scoped `IntegrationCredentials` blob (the bot token + ids).
 *
 * The bot token is enough for a real probe: we call `GET /users/@me`. A clean
 * response is `healthy`; a `401` (revoked/invalid token) is `unhealthy` with an
 * actionable reason; any other failure is `unhealthy`.
 */
export const channelDiscordHealthCheck = {
  async check(
    credentials: Record<string, unknown> | null,
    _scope: IntegrationScope,
  ): Promise<HealthCheckResult> {
    const parsed = discordCredentialsSchema.safeParse(credentials ?? {})
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return {
        status: 'unhealthy',
        message: `Discord credentials invalid: ${first?.message ?? 'unknown validation error'}`,
        details: { reason: 'invalid_credentials' },
      }
    }
    try {
      const user = await getDiscordRestClient().getCurrentUser({ botToken: parsed.data.botToken })
      return {
        status: 'healthy',
        message: 'Discord bot token valid',
        details: { botUserId: user.id, botUsername: user.username },
      }
    } catch (error) {
      const status = error instanceof DiscordApiError ? error.status : 0
      const reason = status === 401 ? 'invalid_token' : 'discord_probe_failed'
      const raw = error instanceof Error ? error.message : 'Discord probe failed'
      const message = raw.replace(/^\[internal\]\s*/, '')
      return {
        status: 'unhealthy',
        message: status === 401 ? 'Discord bot token rejected (401)' : `Discord probe failed: ${message}`,
        details: { reason, status },
      }
    }
  },
}
