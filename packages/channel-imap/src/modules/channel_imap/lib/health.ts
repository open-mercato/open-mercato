import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { imapCredentialsSchema } from './credentials'
import { credentialsToConnection, getImapClient } from './imap-client'

export type HealthCheckStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthCheckResult {
  status: HealthCheckStatus
  message?: string
  details?: Record<string, unknown>
}

/**
 * Liveness probe for the IMAP/SMTP integration. The hub resolves it by the
 * service name declared in `integration.ts` (`channelImapHealthCheck`) and
 * passes the tenant/user-scoped `IntegrationCredentials` row — the full
 * IMAP+SMTP connection blob.
 *
 * Unlike the OAuth channels, IMAP credentials carry everything needed for a
 * real probe, so we do a cheap LOGIN: open the IMAP connection, read
 * capabilities, log out. We deliberately probe IMAP only (the inbound side) and
 * skip the SMTP `verify` round-trip to keep the check cheap and well within the
 * hub's 10s budget. Auth/connection failures surface as `unhealthy`; a clean
 * LOGIN is `healthy`.
 */
export const channelImapHealthCheck = {
  async check(
    credentials: Record<string, unknown> | null,
    _scope: IntegrationScope,
  ): Promise<HealthCheckResult> {
    const parsed = imapCredentialsSchema.safeParse(credentials ?? {})
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return {
        status: 'unhealthy',
        message: `IMAP credentials invalid: ${first?.message ?? 'unknown validation error'}`,
        details: { reason: 'invalid_credentials' },
      }
    }
    try {
      const result = await getImapClient().connectAndValidate(credentialsToConnection(parsed.data))
      return {
        status: 'healthy',
        message: 'IMAP login succeeded',
        details: { capabilities: result.capabilities },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IMAP login failed'
      return {
        status: 'unhealthy',
        message: `IMAP login failed: ${message}`,
        details: { reason: 'imap_login_failed' },
      }
    }
  },
}
