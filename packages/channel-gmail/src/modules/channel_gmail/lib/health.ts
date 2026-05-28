import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { gmailClientCredentialsSchema } from './credentials'

export type HealthCheckStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthCheckResult {
  status: HealthCheckStatus
  message?: string
  details?: Record<string, unknown>
}

/**
 * Liveness probe for the Gmail integration. The hub resolves it by the service
 * name declared in `integration.ts` (`channelGmailHealthCheck`) and passes the
 * tenant-scoped `IntegrationCredentials` row for the `gmail` provider — i.e. the
 * OAuth client config (`clientId` / `clientSecret`), NOT per-user channel tokens.
 *
 * There is no access token at this layer, so a network call to the Gmail API
 * would always 401. The cheap, deterministic probe is therefore: confirm the
 * OAuth client config is present and well-formed. A misconfigured / partial
 * client blob surfaces as `unhealthy` so operators see the problem before a
 * user attempts to connect a mailbox. Per-user token validity is exercised on
 * the channel itself (send / poll surface `requires_reauth`).
 */
export const channelGmailHealthCheck = {
  async check(
    credentials: Record<string, unknown> | null,
    _scope: IntegrationScope,
  ): Promise<HealthCheckResult> {
    const parsed = gmailClientCredentialsSchema.safeParse(credentials ?? {})
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return {
        status: 'unhealthy',
        message: `Gmail OAuth client config invalid: ${first?.message ?? 'unknown validation error'}`,
        details: { reason: 'invalid_oauth_client' },
      }
    }
    return {
      status: 'healthy',
      message: 'Gmail OAuth client configured',
      details: { clientIdConfigured: true },
    }
  },
}
