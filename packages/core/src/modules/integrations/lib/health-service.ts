import type { AwilixContainer } from 'awilix'
import type { IntegrationStateService } from './state-service'
import type { IntegrationLogService } from './log-service'
import { getIntegration, getBundle, type IntegrationScope } from '@open-mercato/shared/modules/integrations/types'

type HealthCheckResult = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message?: string
  details?: Record<string, unknown>
}

type HealthCheckService = {
  check: (credentials: Record<string, unknown> | null, scope: IntegrationScope) => Promise<HealthCheckResult>
}

export function createHealthService(
  container: AwilixContainer,
  stateService: IntegrationStateService,
  logService: IntegrationLogService,
) {
  return {
    async runHealthCheck(integrationId: string, scope: IntegrationScope): Promise<HealthCheckResult> {
      const definition = getIntegration(integrationId)
      const healthConfig = definition?.healthCheck ?? (definition?.bundleId ? getBundle(definition.bundleId)?.healthCheck : undefined)

      if (!healthConfig?.service) {
        return { status: 'unhealthy', message: 'No health check configured' }
      }

      let result: HealthCheckResult
      try {
        const checker = container.resolve<HealthCheckService>(healthConfig.service)
        const credentialsService = container.resolve<{ resolve: (id: string, scope: IntegrationScope) => Promise<Record<string, unknown> | null> }>('integrationCredentialsService')
        const credentials = await credentialsService.resolve(integrationId, scope)
        result = await checker.check(credentials, scope)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Health check failed'
        result = { status: 'unhealthy', message }
      }

      await stateService.upsert(integrationId, {
        lastHealthStatus: result.status,
        lastHealthCheckedAt: new Date(),
      }, scope)

      const logger = logService.scoped(integrationId, scope)
      if (result.status === 'healthy') {
        await logger.info(`Health check passed`, { status: result.status, ...result.details })
      } else {
        await logger.warn(`Health check: ${result.status}`, { status: result.status, message: result.message, ...result.details })
      }

      return result
    },
  }
}

export type IntegrationHealthService = ReturnType<typeof createHealthService>
