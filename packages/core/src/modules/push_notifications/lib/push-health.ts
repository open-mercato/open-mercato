import type { ZodType } from 'zod'
import type { EmailHealthCheck } from '@open-mercato/core/modules/communication_channels/lib/provider-health'
import { isPushFakeProvidersEnabled, PUSH_FAKE_PROVIDERS_ENV } from './fake-provider-recorder'

/**
 * Liveness probe for a push provider (FCM/APNs/Expo).
 *
 * A push provider has NO OAuth client — its credentials are a service-account JSON, a `.p8` signing
 * key, or an Expo access token. So this probe validates the tenant-scoped credentials against the
 * provider schema and reports push-appropriate copy, rather than the OAuth-client wording the shared
 * `makeClientConfigHealthCheck` emits (which is correct for the Gmail-style channels but misleading
 * here). It additionally surfaces fake-provider mode: when `OM_PUSH_FAKE_PROVIDERS` is set every send is
 * short-circuited to a recorded no-op, so a plain "credentials valid → healthy" probe would report green
 * while nothing is delivered — this reports `degraded` instead. Pairs with `warnPushFakeProvidersActive`
 * (a one-time log at registration).
 */
export function makePushClientConfigHealthCheck<T>(options: {
  schema: ZodType<T>
  providerLabel: string
  healthyDetails?: (parsed: T) => Record<string, unknown>
}): EmailHealthCheck {
  return {
    async check(credentials) {
      if (isPushFakeProvidersEnabled()) {
        return {
          status: 'degraded',
          message: `${options.providerLabel} is running in FAKE mode (${PUSH_FAKE_PROVIDERS_ENV} is set): pushes are recorded, not delivered. Unset this flag in production.`,
          details: { fakeProviders: true, env: PUSH_FAKE_PROVIDERS_ENV },
        }
      }
      const parsed = options.schema.safeParse(credentials ?? {})
      if (!parsed.success) {
        const first = parsed.error.issues[0]
        return {
          status: 'unhealthy',
          message: `${options.providerLabel} credentials invalid: ${first?.message ?? 'unknown validation error'}`,
          details: { reason: 'invalid_credentials' },
        }
      }
      return {
        status: 'healthy',
        message: `${options.providerLabel} credentials configured`,
        details: { credentialsConfigured: true, ...(options.healthyDetails?.(parsed.data) ?? {}) },
      }
    },
  }
}
