import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createGusClient, type GusRequest } from './client'
import { resolveGusConfig } from './config'

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
  checkedAt: Date
}

type HealthMessageKey = 'missingKey' | 'connected' | 'unavailable'

const HEALTH_MESSAGE_FALLBACKS: Record<HealthMessageKey, string> = {
  missingKey: 'The production environment requires an API key.',
  connected: 'Connected to GUS REGON ({environment}).',
  unavailable: 'Could not connect to GUS REGON. Check the API key and the environment.',
}

async function translateHealthMessage(key: HealthMessageKey, params?: Record<string, string>): Promise<string> {
  const fallback = HEALTH_MESSAGE_FALLBACKS[key]
  try {
    const { translate } = await resolveTranslations()
    return translate(`gus_regon.health.${key}`, fallback, params)
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'gus_regon', code: 'gus_regon.translation_unavailable' })
    return params ? fallback.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match) : fallback
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^\[internal\]\s*/, '') : String(error)
}

/**
 * Health check wired through `integration.ts → healthCheck.service`.
 * A successful `Zaloguj` proves the endpoint is reachable and the key is valid.
 * The login session is released without awaiting, so logout never eats into the
 * platform health-check timeout.
 */
export function createGusRegonHealthCheck(request?: GusRequest) {
  return {
    async check(credentials: Record<string, unknown>): Promise<HealthCheckResult> {
      const config = resolveGusConfig(credentials)
      if (!config) {
        return {
          status: 'unhealthy',
          message: await translateHealthMessage('missingKey'),
          details: { environment: 'production', reason: 'missing_api_key' },
          checkedAt: new Date(),
        }
      }
      const client = createGusClient(config, request)
      try {
        const sid = await client.login()
        void client.logout(sid).catch(() => undefined)
        return {
          status: 'healthy',
          message: await translateHealthMessage('connected', { environment: config.environment }),
          details: { environment: config.environment },
          checkedAt: new Date(),
        }
      } catch (error) {
        getTelemetryRuntime()?.reportError(error, { module: 'gus_regon', code: 'gus_regon.health_check_failed' })
        return {
          status: 'unhealthy',
          message: await translateHealthMessage('unavailable'),
          details: { environment: config.environment, reason: 'login_unsuccessful', error: describeError(error) },
          checkedAt: new Date(),
        }
      }
    },
  }
}

export const gusRegonHealthCheck = createGusRegonHealthCheck()
