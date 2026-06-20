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
 * skip the SMTP `verify` round-trip to keep the check cheap. The probe passes a
 * tighter 8s connect/greeting timeout (below the hub's 10s health-check budget)
 * so a slow/unreachable host fails fast as `unhealthy` here with an actionable
 * reason, rather than losing the race to the hub's generic timeout; polling is
 * unaffected (it uses the default 15s connect + 60s socket timeouts).
 * Auth/connection failures surface as `unhealthy`; a clean LOGIN is `healthy`.
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
      const result = await getImapClient().connectAndValidate({
        ...credentialsToConnection(parsed.data),
        connectTimeoutMs: 8_000,
      })
      return {
        status: 'healthy',
        message: 'IMAP login succeeded',
        details: { capabilities: result.capabilities },
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'IMAP login failed'
      // Strip the internal-only marker so a policy/diagnostic string never
      // reaches an operator-facing health message, and distinguish a
      // transport-policy rejection (cleartext not opted in) from a real login
      // failure so operators get an actionable reason code.
      const message = raw.replace(/^\[internal\]\s*/, '')
      const isTransportPolicy = /cleartext transport/i.test(message)
      return {
        status: 'unhealthy',
        message: isTransportPolicy
          ? `IMAP transport not allowed: ${message}`
          : `IMAP login failed: ${message}`,
        details: { reason: isTransportPolicy ? 'insecure_transport' : 'imap_login_failed' },
      }
    }
  },
}
