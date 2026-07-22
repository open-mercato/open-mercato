import type { ZodType } from 'zod'
import {
  makeClientConfigHealthCheck,
  type EmailHealthCheck,
} from '@open-mercato/core/modules/communication_channels/lib/provider-health'
import { isPushFakeProvidersEnabled, PUSH_FAKE_PROVIDERS_ENV } from './fake-provider-recorder'

/**
 * Liveness probe for a push provider (FCM/APNs/Expo) that additionally surfaces fake-provider mode.
 *
 * When `OM_PUSH_FAKE_PROVIDERS` is set every send is short-circuited to a recorded no-op (see
 * fake-provider-recorder). A plain "credentials valid → healthy" probe would report green while nothing
 * is delivered, so a misplaced flag stays invisible in the admin health panel. This wrapper reports
 * `degraded` with an explicit message whenever the flag is set, and otherwise delegates to the standard
 * config probe. Pairs with `warnPushFakeProvidersActive` (a one-time log at registration).
 */
export function makePushClientConfigHealthCheck<T>(options: {
  schema: ZodType<T>
  providerLabel: string
  healthyDetails?: (parsed: T) => Record<string, unknown>
}): EmailHealthCheck {
  const base = makeClientConfigHealthCheck(options)
  return {
    async check(credentials, scope) {
      if (isPushFakeProvidersEnabled()) {
        return {
          status: 'degraded',
          message: `${options.providerLabel} is running in FAKE mode (${PUSH_FAKE_PROVIDERS_ENV} is set): pushes are recorded, not delivered. Unset this flag in production.`,
          details: { fakeProviders: true, env: PUSH_FAKE_PROVIDERS_ENV },
        }
      }
      return base.check(credentials, scope)
    },
  }
}
