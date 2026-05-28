import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { microsoftClientCredentialsSchema } from './credentials'

export type HealthCheckStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthCheckResult {
  status: HealthCheckStatus
  message?: string
  details?: Record<string, unknown>
}

/**
 * Liveness probe for the Microsoft 365 / Outlook integration. The hub resolves
 * it by the service name declared in `integration.ts`
 * (`channelMicrosoftHealthCheck`) and passes the tenant-scoped
 * `IntegrationCredentials` row for the `microsoft` provider — i.e. the Azure AD
 * app config (`clientId`, optional `tenantId` / `clientSecret`), NOT per-user
 * channel tokens.
 *
 * There is no access token at this layer, so a Graph call would always 401. The
 * cheap, deterministic probe is therefore: confirm the app config is present
 * and well-formed. Public PKCE clients legitimately omit `clientSecret`, so the
 * schema treats it as optional — only a missing/invalid `clientId` makes the
 * integration `unhealthy`. Per-user token validity is exercised on the channel
 * (send / poll surface `requires_reauth`).
 */
export const channelMicrosoftHealthCheck = {
  async check(
    credentials: Record<string, unknown> | null,
    _scope: IntegrationScope,
  ): Promise<HealthCheckResult> {
    const parsed = microsoftClientCredentialsSchema.safeParse(credentials ?? {})
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return {
        status: 'unhealthy',
        message: `Microsoft OAuth client config invalid: ${first?.message ?? 'unknown validation error'}`,
        details: { reason: 'invalid_oauth_client' },
      }
    }
    return {
      status: 'healthy',
      message: 'Microsoft OAuth client configured',
      details: {
        clientIdConfigured: true,
        confidentialClient: Boolean(parsed.data.clientSecret),
      },
    }
  },
}
