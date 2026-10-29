import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTpayNotificationUrl } from './callback-url'
import { translateTpayText } from './errors'
import { requestAccessToken, resolveTpayEnvironment, TpayClientError, type TpayEnvironment } from './tpay-client'

export interface TpayHealthCheckResult {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
  checkedAt: Date
}

type UnhealthyReason =
  | 'missing_credentials'
  | 'invalid_environment'
  | 'invalid_notification_url'
  | 'authentication_failed'
  | 'provider_unavailable'

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

async function unhealthy(
  reason: UnhealthyReason,
  details: Record<string, unknown> = {},
  messageKey = 'gateway_tpay.health.unhealthy',
  fallback = 'Tpay connection failed. Check the credentials.',
): Promise<TpayHealthCheckResult> {
  return {
    status: 'unhealthy',
    message: await translateTpayText(messageKey, fallback),
    details: { reason, ...details },
    checkedAt: new Date(),
  }
}

export const tpayHealthCheck = {
  async check(credentials: Record<string, unknown>): Promise<TpayHealthCheckResult> {
    const clientId = readNonEmptyString(credentials.clientId)
    const clientSecret = readNonEmptyString(credentials.clientSecret)
    if (!clientId || !clientSecret) {
      return unhealthy('missing_credentials')
    }

    let environment: TpayEnvironment
    try {
      environment = resolveTpayEnvironment(credentials.environment ?? 'sandbox')
    } catch {
      return unhealthy('invalid_environment')
    }

    let notificationUrl: string | null
    try {
      notificationUrl = await resolveTpayNotificationUrl({ credential: credentials.notificationUrl, environment })
    } catch (error) {
      if (isCrudHttpError(error)) {
        return unhealthy(
          'invalid_notification_url',
          { environment },
          'gateway_tpay.errors.invalidNotificationUrl',
          'The notification URL is invalid.',
        )
      }
      throw error
    }

    try {
      await requestAccessToken({ clientId, clientSecret, environment })
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, { module: 'gateway_tpay', code: 'gateway_tpay.health_check_failed' })
      const authenticationFailed = error instanceof TpayClientError && error.status !== null && error.status < 500
      return unhealthy(authenticationFailed ? 'authentication_failed' : 'provider_unavailable', {
        environment,
        notificationUrlConfigured: notificationUrl !== null,
      })
    }

    return {
      status: 'healthy',
      message: await translateTpayText('gateway_tpay.health.healthy', 'Tpay connection is healthy.'),
      details: { environment, notificationUrlConfigured: notificationUrl !== null },
      checkedAt: new Date(),
    }
  },
}
