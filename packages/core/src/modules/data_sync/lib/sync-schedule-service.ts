import { randomUUID } from 'node:crypto'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncSchedule } from '../data/entities'

type SyncScope = {
  organizationId: string
  tenantId: string
}

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    description?: string
    scopeType: 'organization'
    organizationId: string
    tenantId: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue'
    targetQueue: string
    targetPayload: Record<string, unknown>
    requireFeature?: string
    sourceType: 'module'
    sourceModule: string
    isEnabled?: boolean
  }) => Promise<void>
  unregister: (scheduleId: string) => Promise<void>
}

export function createSyncScheduleService(em: EntityManager, schedulerService?: SchedulerServiceLike) {
  function requireScheduler(): SchedulerServiceLike {
    if (!schedulerService) {
      throw new Error('Scheduler module is not available')
    }
    return schedulerService
  }

  function buildScheduleName(row: SyncSchedule): string {
    return `Data sync: ${row.integrationId} ${row.entityType} ${row.direction}`
  }

  function buildScheduleDescription(row: SyncSchedule): string {
    return `Scheduled ${row.direction} for ${row.integrationId} (${row.entityType})`
  }

  async function getById(id: string, scope: SyncScope): Promise<SyncSchedule | null> {
    return findOneWithDecryption(
      em,
      SyncSchedule,
      {
        id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
  }

  async function getByKey(
    integrationId: string,
    entityType: string,
    direction: 'import' | 'export',
    scope: SyncScope,
  ): Promise<SyncSchedule | null> {
    return findOneWithDecryption(
      em,
      SyncSchedule,
      {
        integrationId,
        entityType,
        direction,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
  }

  return {
    getById,
    getByKey,

    async listSchedules(query: {
      integrationId?: string
      entityType?: string
      direction?: 'import' | 'export'
      page: number
      pageSize: number
    }, scope: SyncScope): Promise<{ items: SyncSchedule[]; total: number }> {
      const where: FilterQuery<SyncSchedule> = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      }

      if (query.integrationId) where.integrationId = query.integrationId
      if (query.entityType) where.entityType = query.entityType
      if (query.direction) where.direction = query.direction

      const [items, total] = await findAndCountWithDecryption(
        em,
        SyncSchedule,
        where,
        {
          orderBy: { createdAt: 'DESC' },
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        },
        scope,
      )

      return { items, total }
    },

    async saveSchedule(input: {
      id?: string
      integrationId: string
      entityType: string
      direction: 'import' | 'export'
      scheduleType: 'cron' | 'interval'
      scheduleValue: string
      timezone: string
      fullSync: boolean
      isEnabled: boolean
    }, scope: SyncScope): Promise<SyncSchedule> {
      const existing = input.id
        ? await getById(input.id, scope)
        : await getByKey(input.integrationId, input.entityType, input.direction, scope)

      const row = existing ?? em.create(SyncSchedule, {
        id: randomUUID(),
        integrationId: input.integrationId,
        entityType: input.entityType,
        direction: input.direction,
        scheduleType: input.scheduleType,
        scheduleValue: input.scheduleValue,
        timezone: input.timezone,
        fullSync: input.fullSync,
        isEnabled: input.isEnabled,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })

      row.integrationId = input.integrationId
      row.entityType = input.entityType
      row.direction = input.direction
      row.scheduleType = input.scheduleType
      row.scheduleValue = input.scheduleValue
      row.timezone = input.timezone
      row.fullSync = input.fullSync
      row.isEnabled = input.isEnabled
      row.scheduledJobId = row.scheduledJobId ?? row.id

      if (!existing) {
        em.persist(row)
      }

      await em.flush()

      await requireScheduler().register({
        id: row.scheduledJobId,
        name: buildScheduleName(row),
        description: buildScheduleDescription(row),
        scopeType: 'organization',
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        scheduleType: row.scheduleType,
        scheduleValue: row.scheduleValue,
        timezone: row.timezone,
        targetType: 'queue',
        targetQueue: 'data-sync-scheduled',
        targetPayload: {
          scheduleId: row.id,
          scope,
        },
        requireFeature: 'data_sync.run',
        sourceType: 'module',
        sourceModule: 'data_sync',
        isEnabled: row.isEnabled,
      })

      return row
    },

    async deleteSchedule(id: string, scope: SyncScope): Promise<boolean> {
      const row = await getById(id, scope)
      if (!row) return false

      const scheduledJobId = row.scheduledJobId ?? row.id
      await requireScheduler().unregister(scheduledJobId)

      row.deletedAt = new Date()
      row.isEnabled = false
      await em.flush()
      return true
    },
  }
}

export type SyncScheduleService = ReturnType<typeof createSyncScheduleService>
