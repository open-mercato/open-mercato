import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { ListIntegrationLogsQuery } from '../data/validators'
import { IntegrationLog } from '../data/entities'

type LogInput = {
  integrationId: string
  runId?: string | null
  scopeEntityType?: string | null
  scopeEntityId?: string | null
  level: 'info' | 'warn' | 'error'
  message: string
  code?: string | null
  payload?: Record<string, unknown> | null
}

export function createIntegrationLogService(em: EntityManager) {
  return {
    async write(input: LogInput, scope: IntegrationScope): Promise<IntegrationLog> {
      const row = em.create(IntegrationLog, {
        integrationId: input.integrationId,
        runId: input.runId,
        scopeEntityType: input.scopeEntityType,
        scopeEntityId: input.scopeEntityId,
        level: input.level,
        message: input.message,
        code: input.code,
        payload: input.payload,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      await em.persist(row).flush()
      return row
    },

    scoped(integrationId: string, scope: IntegrationScope) {
      return {
        info: (message: string, payload?: Record<string, unknown>) => this.write({ integrationId, level: 'info', message, payload }, scope),
        warn: (message: string, payload?: Record<string, unknown>) => this.write({ integrationId, level: 'warn', message, payload }, scope),
        error: (message: string, payload?: Record<string, unknown>) => this.write({ integrationId, level: 'error', message, payload }, scope),
      }
    },

    async query(query: ListIntegrationLogsQuery, scope: IntegrationScope): Promise<{ items: IntegrationLog[]; total: number }> {
      const where: FilterQuery<IntegrationLog> = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      }

      if (query.integrationId) where.integrationId = query.integrationId
      if (query.level) where.level = query.level
      if (query.runId) where.runId = query.runId
      if (query.entityType) where.scopeEntityType = query.entityType
      if (query.entityId) where.scopeEntityId = query.entityId

      const items = await findWithDecryption(
        em,
        IntegrationLog,
        where,
        {
          orderBy: { createdAt: 'DESC' },
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        },
        scope,
      )
      const total = await em.count(IntegrationLog, where)
      return { items, total }
    },

    async pruneOlderThan(days: number, scope: IntegrationScope): Promise<number> {
      const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const deletedCount = await em.nativeDelete(IntegrationLog, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        createdAt: { $lt: threshold },
      })
      return deletedCount
    },
  }
}

export type IntegrationLogService = ReturnType<typeof createIntegrationLogService>
