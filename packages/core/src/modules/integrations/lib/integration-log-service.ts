import type { EntityManager } from '@mikro-orm/core'
import { IntegrationLog } from '../data/entities'

type IntegrationLogLevel = 'debug' | 'info' | 'warning' | 'error'

type IntegrationLogScope = {
  tenantId: string
  organizationId?: string | null
}

type IntegrationLogWriter = {
  debug: (code: string, message: string, details?: Record<string, unknown>) => Promise<void>
  info: (code: string, message: string, details?: Record<string, unknown>) => Promise<void>
  warning: (code: string, message: string, details?: Record<string, unknown>) => Promise<void>
  error: (code: string, message: string, details?: Record<string, unknown>) => Promise<void>
}

export type IntegrationLogService = {
  write: (
    integrationId: string,
    scope: IntegrationLogScope,
    input: { level: IntegrationLogLevel; code: string; message: string; details?: Record<string, unknown>; correlationId?: string | null },
  ) => Promise<void>
  scoped: (integrationId: string, correlationId: string | null | undefined, scope: IntegrationLogScope) => IntegrationLogWriter
}

export function createIntegrationLogService(em: EntityManager): IntegrationLogService {
  const write: IntegrationLogService['write'] = async (integrationId, scope, input) => {
    const row = em.create(IntegrationLog, {
      integrationId,
      correlationId: input.correlationId ?? null,
      level: input.level,
      code: input.code,
      message: input.message,
      detailsJson: input.details ?? null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
    })
    await em.persistAndFlush(row)
  }

  const scoped: IntegrationLogService['scoped'] = (integrationId, correlationId, scope) => ({
    debug: async (code, message, details) => write(integrationId, scope, { level: 'debug', code, message, details, correlationId }),
    info: async (code, message, details) => write(integrationId, scope, { level: 'info', code, message, details, correlationId }),
    warning: async (code, message, details) => write(integrationId, scope, { level: 'warning', code, message, details, correlationId }),
    error: async (code, message, details) => write(integrationId, scope, { level: 'error', code, message, details, correlationId }),
  })

  return { write, scoped }
}
