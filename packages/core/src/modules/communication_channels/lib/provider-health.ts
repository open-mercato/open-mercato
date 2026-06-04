import type { ZodType } from 'zod'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'

export type EmailHealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface EmailHealthCheckResult {
  status: EmailHealthStatus
  message?: string
  details?: Record<string, unknown>
}

export interface EmailHealthCheck {
  check: (credentials: Record<string, unknown> | null, scope: IntegrationScope) => Promise<EmailHealthCheckResult>
}

/**
 * Build a liveness probe for an OAuth-client-config integration. There is no
 * access token at this layer (the hub passes the tenant-scoped OAuth client
 * config, not per-user channel tokens), so a network call would always 401. The
 * cheap, deterministic probe is: confirm the client config is present and
 * well-formed. Per-user token validity is exercised on the channel itself
 * (send / poll surface `requires_reauth`).
 */
export function makeClientConfigHealthCheck<T>(options: {
  schema: ZodType<T>
  providerLabel: string
  healthyDetails?: (parsed: T) => Record<string, unknown>
}): EmailHealthCheck {
  return {
    async check(credentials) {
      const parsed = options.schema.safeParse(credentials ?? {})
      if (!parsed.success) {
        const first = parsed.error.issues[0]
        return {
          status: 'unhealthy',
          message: `${options.providerLabel} OAuth client config invalid: ${first?.message ?? 'unknown validation error'}`,
          details: { reason: 'invalid_oauth_client' },
        }
      }
      return {
        status: 'healthy',
        message: `${options.providerLabel} OAuth client configured`,
        details: { clientIdConfigured: true, ...(options.healthyDetails?.(parsed.data) ?? {}) },
      }
    },
  }
}
