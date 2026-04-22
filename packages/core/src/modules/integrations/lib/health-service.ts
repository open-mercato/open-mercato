import type { AwilixContainer } from 'awilix'
import type { IntegrationStateService } from './state-service'
import type { IntegrationLogService } from './log-service'
import {
  getIntegration,
  getBundle,
  type IntegrationScope,
  type IntegrationHealthCheckConfig,
} from '@open-mercato/shared/modules/integrations/types'

export const HEALTH_CHECK_TIMEOUT_MS = 10_000

export type IntegrationHealthDisplayStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured'

export type HealthCheckRunResult = {
  status: IntegrationHealthDisplayStatus
  message?: string
  details?: Record<string, unknown>
  latencyMs: number | null
  checkedAt: string
}

type ProbeHealthStatus = 'healthy' | 'degraded' | 'unhealthy'

type HealthCheckResult = {
  status: ProbeHealthStatus
  message?: string
  details?: Record<string, unknown>
}

type HealthCheckService = {
  check: (credentials: Record<string, unknown> | null, scope: IntegrationScope) => Promise<HealthCheckResult>
}

export function getEffectiveHealthCheckConfig(integrationId: string): IntegrationHealthCheckConfig | undefined {
  const definition = getIntegration(integrationId)
  if (!definition) return undefined
  return definition.healthCheck ?? (definition.bundleId ? getBundle(definition.bundleId)?.healthCheck : undefined)
}

function isCredentialsEmpty(credentials: Record<string, unknown> | null): boolean {
  if (credentials == null) return true
  return Object.keys(credentials).length === 0
}

function normalizeProbeResult(raw: HealthCheckResult): HealthCheckResult {
  if (raw.status === 'healthy' || raw.status === 'degraded' || raw.status === 'unhealthy') {
    return raw
  }
  return { status: 'unhealthy', message: raw.message ?? 'Invalid health status', details: raw.details }
}

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Health check timed out'))
    }, ms)
  })
}

export function deriveIntegrationHealthStatus(input: {
  hasHealthCheck: boolean
  hasCredentials: boolean
  lastHealthStatus: string | null
  lastHealthCheckedAt: Date | null
}): IntegrationHealthDisplayStatus {
  if (!input.hasHealthCheck || !input.hasCredentials) {
    return 'unconfigured'
  }
  if (
    input.lastHealthStatus === 'healthy'
    || input.lastHealthStatus === 'degraded'
    || input.lastHealthStatus === 'unhealthy'
  ) {
    return input.lastHealthStatus
  }
  return 'unconfigured'
}

export function createHealthService(
  container: AwilixContainer,
  stateService: IntegrationStateService,
  logService: IntegrationLogService,
) {
  return {
    async runHealthCheck(integrationId: string, scope: IntegrationScope): Promise<HealthCheckRunResult> {
      const checkedAt = new Date().toISOString()
      const healthConfig = getEffectiveHealthCheckConfig(integrationId)

      if (!healthConfig?.service) {
        return {
          status: 'unconfigured',
          message: 'No health check configured',
          latencyMs: null,
          checkedAt,
        }
      }

      const credentialsService = container.resolve<{
        resolve: (id: string, scope: IntegrationScope) => Promise<Record<string, unknown> | null>
      }>('integrationCredentialsService')
      const credentials = await credentialsService.resolve(integrationId, scope)

      if (isCredentialsEmpty(credentials)) {
        return {
          status: 'unconfigured',
          message: 'No credentials configured',
          latencyMs: null,
          checkedAt,
        }
      }

      const startedAt = Date.now()
      let result: HealthCheckResult

      try {
        const checker = container.resolve<HealthCheckService>(healthConfig.service)
        const raw = await Promise.race([
          checker.check(credentials, scope),
          timeoutPromise(HEALTH_CHECK_TIMEOUT_MS),
        ])
        result = normalizeProbeResult(raw)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Health check failed'
        result = { status: 'unhealthy', message }
      }

      const latencyMs = Date.now() - startedAt

      await stateService.upsert(
        integrationId,
        {
          lastHealthStatus: result.status,
          lastHealthCheckedAt: new Date(),
          lastHealthLatencyMs: latencyMs,
        },
        scope,
      )

      const logger = logService.scoped(integrationId, scope)
      if (result.status === 'healthy') {
        await logger.info('Health check passed', { status: result.status, ...result.details })
      } else {
        await logger.warn(`Health check: ${result.status}`, {
          status: result.status,
          message: result.message,
          ...result.details,
        })
      }

      return {
        status: result.status,
        message: result.message,
        details: result.details,
        latencyMs,
        checkedAt: new Date().toISOString(),
      }
    },
  }
}

export type IntegrationHealthService = ReturnType<typeof createHealthService>
