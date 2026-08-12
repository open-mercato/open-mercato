/**
 * "Is this tenant's HTTP agent configuration usable?"
 *
 * Registered in `di.ts` under the exact name `integration.ts` declares in
 * `healthCheck.service`; a mismatch there makes the hub's `container.resolve`
 * throw and the integration report permanently unhealthy.
 *
 * ─── WHY THIS PROBE DOES NOT CALL THE PROVIDER ───────────────────────────────
 *
 * The voice connector's health check GETs a conversation and reads the status
 * code, because ElevenLabs has a documented read endpoint that costs nothing. Here
 * the ONLY endpoint the operator declared is the START url, and the only verb it
 * declares is POST — which is precisely the request that starts a real run. A
 * health check that placed one would be a health check with a side effect in
 * somebody else's system, on a schedule. A HEAD or GET against it would prove
 * nothing either: a 405 is the expected answer from a correctly configured
 * POST-only endpoint and is indistinguishable from a misconfigured path.
 *
 * So the probe answers the questions it CAN answer honestly, which are also the
 * two that actually break in practice:
 *
 *   1. does the credential record parse — all required fields, a usable result
 *      path, a template that is valid JSON;
 *   2. would the outbound URL guard let the request out at all — protocol, host,
 *      DNS, private-range. This is a real network check (it resolves the host) and
 *      it catches the commonest deployment failure, a start URL pointing at
 *      something only reachable from a developer's laptop.
 */

import {
  resolveSafeOutboundUrl,
  UnsafeOutboundUrlError,
  type HostLookup,
} from '@open-mercato/shared/lib/url-safety'
import { isAllowPrivateUrlsEnabled } from './api'
import { describeCredentialsForLog, parseGenericHttpCredentials } from './credentials'

type HealthCheckStatus = 'healthy' | 'degraded' | 'unhealthy'

type HealthCheckResult = {
  status: HealthCheckStatus
  message?: string
  details?: Record<string, unknown>
}

export function createGenericHttpAgentHealthCheck(deps?: {
  lookupHost?: HostLookup
  allowPrivate?: boolean
}): { check(credentials: Record<string, unknown> | null): Promise<HealthCheckResult> } {
  return {
    async check(credentials) {
      let parsed: ReturnType<typeof parseGenericHttpCredentials>
      try {
        parsed = parseGenericHttpCredentials(credentials)
      } catch (error) {
        // The parser's messages name FIELDS and never values, so surfacing one is
        // safe and is exactly what an operator needs.
        return {
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'Credentials are not usable.',
          details: { reason: 'invalid_credentials' },
        }
      }

      try {
        await resolveSafeOutboundUrl(parsed.startUrl, {
          subject: 'HTTP agent start URL',
          allowPrivate: deps?.allowPrivate ?? isAllowPrivateUrlsEnabled(),
          lookupHost: deps?.lookupHost,
        })
      } catch (error) {
        if (error instanceof UnsafeOutboundUrlError) {
          return {
            status: 'unhealthy',
            message: `The configured start URL cannot be reached safely: ${error.message}`,
            details: { reason: error.reason },
          }
        }
        const message = error instanceof Error ? error.message : 'Unknown error'
        return {
          status: 'unhealthy',
          message: `The configured start URL could not be checked: ${message}`,
          details: { reason: 'lookup_failed' },
        }
      }

      return {
        status: 'healthy',
        message:
          'The HTTP agent configuration is complete and its start URL resolves to a permitted address. The endpoint itself is not called, because the only request it accepts starts a real run.',
        // Non-secret configuration only, echoed back so a "healthy but nothing
        // works" report is diagnosable at a glance — the commonest cause is a
        // signature scheme or result path that does not match the provider.
        details: { ...describeCredentialsForLog(parsed), resultPath: parsed.resultPath },
      }
    },
  }
}

export const genericHttpAgentHealthCheck = createGenericHttpAgentHealthCheck()
