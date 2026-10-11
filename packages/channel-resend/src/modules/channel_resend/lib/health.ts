import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { fetchWithTimeout } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { resendCredentialsSchema } from './credentials'

type HealthCheckResult = {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
}

export const channelResendHealthCheck = {
  async check(
    credentials: Record<string, unknown> | null,
    _scope: IntegrationScope,
  ): Promise<HealthCheckResult> {
    const parsed = resendCredentialsSchema.safeParse(credentials ?? {})
    if (!parsed.success) {
      return {
        status: 'unhealthy',
        message: `Resend credentials invalid: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`,
        details: { reason: 'invalid_credentials' },
      }
    }

    try {
      const response = await fetchWithTimeout('https://api.resend.com/domains?limit=1', {
        headers: { Authorization: `Bearer ${parsed.data.apiKey}` },
        timeoutMs: 8_000,
      })
      if (!response.ok) {
        return {
          status: 'unhealthy',
          message: `Resend API rejected the credentials with status ${response.status}`,
          details: { reason: 'api_rejected', status: response.status },
        }
      }
      return {
        status: 'healthy',
        message: 'Resend API credentials are valid',
        details: { endpoint: 'domains' },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Resend API request failed'
      return {
        status: 'unhealthy',
        message: `Resend health check failed: ${message}`,
        details: { reason: 'request_failed' },
      }
    }
  },
}
