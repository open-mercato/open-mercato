import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ListIntegrationLogsQuery } from '../data/validators'
import { IntegrationLog } from '../data/entities'

type IntegrationScope = {
  organizationId: string
  tenantId: string
}

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
      await em.persistAndFlush(row)
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

      const [items, total] = await em.findAndCount(
        IntegrationLog,
        where,
        {
          orderBy: { createdAt: 'DESC' },
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        },
      )

      const decrypted = await findWithDecryption(em, IntegrationLog, { id: { $in: items.map((item) => item.id) } }, {}, scope)
      const byId = new Map(decrypted.map((item) => [item.id, item]))
      return { items: items.map((item) => byId.get(item.id) ?? item), total }
    },

    async pruneOlderThan(days: number, scope: IntegrationScope): Promise<number> {
      const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const old = await em.find(IntegrationLog, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        createdAt: { $lt: threshold },
      })
      if (!old.length) return 0

      for (const row of old) {
        em.remove(row)
      }
      await em.flush()
      return old.length
    },
  }
}

export type IntegrationLogService = ReturnType<typeof createIntegrationLogService>
