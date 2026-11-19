import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { smtpCredentialsSchema } from './credentials'
import { credentialsToConnection, getSmtpTransport } from './transport'

type HealthCheckResult = {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
}

const PROBE_TIMEOUT_MS = 8_000

export const channelSmtpHealthCheck = {
  async check(
    credentials: Record<string, unknown> | null,
    _scope: IntegrationScope,
  ): Promise<HealthCheckResult> {
    const parsed = smtpCredentialsSchema.safeParse(credentials ?? {})
    if (!parsed.success) {
      return {
        status: 'unhealthy',
        message: `SMTP credentials invalid: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`,
        details: { reason: 'invalid_credentials' },
      }
    }

    // `verify()` opens the connection, negotiates TLS and runs SMTP AUTH, so it
    // proves the same things a send needs without putting a message on the wire.
    // Kept inside the hub's 10s health budget via the transport's own timeouts.
    const connection = { ...credentialsToConnection(parsed.data), timeoutMs: PROBE_TIMEOUT_MS }
    try {
      await getSmtpTransport().verify(connection)
      return {
        status: 'healthy',
        message: 'SMTP relay accepted the credentials',
        details: { host: connection.host, port: connection.port, tls: connection.tls },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SMTP connection failed'
      return {
        status: 'unhealthy',
        message: `SMTP health check failed: ${message}`,
        details: { reason: 'connection_failed', host: connection.host, port: connection.port },
      }
    }
  },
}
