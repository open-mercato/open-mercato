import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { fetchWithTimeout } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { mailjetCredentialsSchema } from './credentials'

type HealthCheckResult = {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
}

export const channelMailjetHealthCheck = {
  async check(
    credentials: Record<string, unknown> | null,
    _scope: IntegrationScope,
  ): Promise<HealthCheckResult> {
    const parsed = mailjetCredentialsSchema.safeParse(credentials ?? {})
    if (!parsed.success) {
      return {
        status: 'unhealthy',
        message: `Mailjet credentials invalid: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`,
        details: { reason: 'invalid_credentials' },
      }
    }

    const authorization = Buffer.from(
      `${parsed.data.apiKey}:${parsed.data.secretKey}`,
      'utf8',
    ).toString('base64')
    try {
      const response = await fetchWithTimeout('https://api.mailjet.com/v3/REST/myprofile', {
        headers: { accept: 'application/json', authorization: `Basic ${authorization}` },
        timeoutMs: 8_000,
      })
      if (!response.ok) {
        return {
          status: 'unhealthy',
          message: `Mailjet API rejected the credentials with status ${response.status}`,
          details: { reason: 'api_rejected', status: response.status },
        }
      }
      return {
        status: 'healthy',
        message: 'Mailjet API credentials are valid',
        details: { endpoint: 'myprofile' },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mailjet API request failed'
      return {
        status: 'unhealthy',
        message: `Mailjet health check failed: ${message}`,
        details: { reason: 'request_failed' },
      }
    }
  },
}
