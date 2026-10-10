import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { fetchWithTimeout } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { brevoCredentialsSchema } from './credentials'

type HealthCheckResult = {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
}

export const channelBrevoHealthCheck = {
  async check(
    credentials: Record<string, unknown> | null,
    _scope: IntegrationScope,
  ): Promise<HealthCheckResult> {
    const parsed = brevoCredentialsSchema.safeParse(credentials ?? {})
    if (!parsed.success) {
      return {
        status: 'unhealthy',
        message: `Brevo credentials invalid: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`,
        details: { reason: 'invalid_credentials' },
      }
    }

    try {
      const response = await fetchWithTimeout('https://api.brevo.com/v3/account', {
        headers: { accept: 'application/json', 'api-key': parsed.data.apiKey },
        timeoutMs: 8_000,
      })
      if (!response.ok) {
        return {
          status: 'unhealthy',
          message: `Brevo API rejected the credentials with status ${response.status}`,
          details: { reason: 'api_rejected', status: response.status },
        }
      }
      return {
        status: 'healthy',
        message: 'Brevo API credentials are valid',
        details: { endpoint: 'account' },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Brevo API request failed'
      return {
        status: 'unhealthy',
        message: `Brevo health check failed: ${message}`,
        details: { reason: 'request_failed' },
      }
    }
  },
}
