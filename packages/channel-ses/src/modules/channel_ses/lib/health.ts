import { GetAccountCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { withTimeout } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { sesCredentialsSchema } from './credentials'

type HealthCheckResult = {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
}

export const channelSesHealthCheck = {
  async check(
    credentials: Record<string, unknown> | null,
    _scope: IntegrationScope,
  ): Promise<HealthCheckResult> {
    const parsed = sesCredentialsSchema.safeParse(credentials ?? {})
    if (!parsed.success) {
      return {
        status: 'unhealthy',
        message: `Amazon SES credentials invalid: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`,
        details: { reason: 'invalid_credentials' },
      }
    }

    const client = new SESv2Client({ region: parsed.data.region })
    try {
      const account = await withTimeout(
        (signal) => client.send(new GetAccountCommand({}), { abortSignal: signal }),
        8_000,
        'Amazon SES GetAccount',
      )
      return {
        status: 'healthy',
        message: 'Amazon SES account is reachable',
        details: {
          region: parsed.data.region,
          productionAccessEnabled: account.ProductionAccessEnabled ?? false,
          sendingEnabled: account.SendingEnabled ?? false,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Amazon SES request failed'
      return {
        status: 'unhealthy',
        message: `Amazon SES health check failed: ${message}`,
        details: { reason: 'request_failed', region: parsed.data.region },
      }
    } finally {
      client.destroy()
    }
  },
}
