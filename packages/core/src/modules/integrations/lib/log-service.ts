import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { ListIntegrationLogsQuery } from '../data/validators'
import { IntegrationLog } from '../data/entities'

export type IntegrationLogAnalytics = {
  lastActivityAt: string | null
  totalCount: number
  errorCount: number
  errorRate: number
  dailyCounts: number[]
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function buildUtcDayKeys(windowDays: number): string[] {
  const end = startOfUtcDay(new Date())
  const keys: string[] = []
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const t = new Date(end)
    t.setUTCDate(t.getUTCDate() - offset)
    keys.push(t.toISOString().slice(0, 10))
  }
  return keys
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

    async aggregateAnalytics(
      integrationIds: string[],
      scope: IntegrationScope,
      windowDays = 30,
    ): Promise<Map<string, IntegrationLogAnalytics>> {
      const dayKeys = buildUtcDayKeys(windowDays)
      const windowStartUtc = `${dayKeys[0]}T00:00:00.000Z`

      const empty = (): IntegrationLogAnalytics => ({
        lastActivityAt: null,
        totalCount: 0,
        errorCount: 0,
        errorRate: 0,
        dailyCounts: dayKeys.map(() => 0),
      })

      const result = new Map<string, IntegrationLogAnalytics>()
      for (const id of integrationIds) {
        result.set(id, empty())
      }
      if (integrationIds.length === 0) {
        return result
      }

      const conn = em.getConnection()
      const inList = integrationIds.map(() => '?').join(', ')

      type AggRow = {
        integration_id: string
        last_activity: Date | string | null
        total_count: string | number
        error_count: string | number | null
      }

      const aggRows = await conn.execute<AggRow[]>(
        `select integration_id,
                max(created_at) as last_activity,
                count(*)::int as total_count,
                coalesce(sum(case when level = 'error' then 1 else 0 end), 0)::int as error_count
         from integration_logs
         where organization_id = ? and tenant_id = ?
           and integration_id in (${inList})
           and created_at >= ?
         group by integration_id`,
        [scope.organizationId, scope.tenantId, ...integrationIds, windowStartUtc],
      )

      for (const row of aggRows) {
        const entry = result.get(row.integration_id)
        if (!entry) continue
        const total = Number(row.total_count)
        const errors = Number(row.error_count ?? 0)
        entry.totalCount = total
        entry.errorCount = errors
        entry.errorRate = total > 0 ? errors / total : 0
        if (row.last_activity) {
          const d = row.last_activity instanceof Date ? row.last_activity : new Date(row.last_activity)
          entry.lastActivityAt = d.toISOString()
        }
      }

      type DailyRow = { integration_id: string; day: string | Date; cnt: string | number }

      const dailyRows = await conn.execute<DailyRow[]>(
        `select integration_id,
                (created_at at time zone 'UTC')::date::text as day,
                count(*)::int as cnt
         from integration_logs
         where organization_id = ? and tenant_id = ?
           and integration_id in (${inList})
           and created_at >= ?
         group by integration_id, (created_at at time zone 'UTC')::date`,
        [scope.organizationId, scope.tenantId, ...integrationIds, windowStartUtc],
      )

      const dayIndex = new Map(dayKeys.map((key, index) => [key, index]))
      for (const row of dailyRows) {
        const entry = result.get(row.integration_id)
        if (!entry) continue
        const dayKey = typeof row.day === 'string' ? row.day : row.day.toISOString().slice(0, 10)
        const idx = dayIndex.get(dayKey)
        if (idx === undefined) continue
        entry.dailyCounts[idx] = Number(row.cnt)
      }

      return result
    },
  }
}

export type IntegrationLogService = ReturnType<typeof createIntegrationLogService>
