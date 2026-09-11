import { randomUUID } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enforceCommandOptimisticLockWithGuards, enforceRecordGoneIsConflict } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { SyncSchedule } from '../data/entities'

const logger = createLogger('data_sync').child({ component: 'sync-schedule-service' })

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
  exists?: (scheduleId: string) => Promise<boolean>
}

async function scheduledJobExists(scheduler: SchedulerServiceLike, scheduledJobId: string): Promise<boolean> {
  // A scheduler substitute that cannot answer keeps the pre-existing behaviour:
  // treat the registration as minted, which compensates rather than stranding an
  // orphan on the create path where this is by far the likelier outcome.
  if (!scheduler.exists) return false
  return scheduler.exists(scheduledJobId)
}

export function createSyncScheduleService(em: EntityManager, schedulerService?: SchedulerServiceLike) {
  function requireScheduler(): SchedulerServiceLike {
    if (!schedulerService) {
      throw new Error('Scheduler module is not available')
    }
    return schedulerService
  }

  function buildScheduleName(row: { integrationId: string; entityType: string; direction: 'import' | 'export' }): string {
    return `Data sync: ${row.integrationId} ${row.entityType} ${row.direction}`
  }

  function buildScheduleDescription(row: { integrationId: string; entityType: string; direction: 'import' | 'export' }): string {
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
      expectedUpdatedAt?: string | null
    }, scope: SyncScope, container?: AwilixContainer): Promise<SyncSchedule> {
      const existing = input.id
        ? await getById(input.id, scope)
        : await getByKey(input.integrationId, input.entityType, input.direction, scope)

      if (existing && container) {
        await enforceCommandOptimisticLockWithGuards(container, {
          resourceKind: 'data_sync.schedule',
          resourceId: existing.id,
          current: existing.updatedAt ?? null,
          expected: input.expectedUpdatedAt ?? null,
        })
      } else if (!existing && input.expectedUpdatedAt) {
        // Concurrent delete-then-edit race: the client edited a schedule that was
        // removed before this keyed upsert ran. Surface the unified conflict
        // instead of silently re-creating it. No-op when no expected version was
        // sent (a genuine create) or when OM_OPTIMISTIC_LOCK is off.
        enforceRecordGoneIsConflict({
          resourceKind: 'data_sync.schedule',
          resourceId: input.id ?? `${input.integrationId}:${input.entityType}:${input.direction}`,
          expected: input.expectedUpdatedAt,
        })
      }

      const id = existing?.id ?? randomUUID()
      const scheduledJobId = existing?.scheduledJobId ?? id
      const scheduler = requireScheduler()
      // Only a registration this call mints may be compensated below. A create
      // mints a fresh id, so no job can already live at it. An update of a row
      // whose scheduledJobId is null is the ambiguous case — deleteSchedule reads
      // that null as "the job lives at row.id", and register() upserts on id — so
      // ask the scheduler instead of assuming, otherwise compensation would
      // delete a job this call merely overwrote.
      const mintsRegistration = existing
        ? !existing.scheduledJobId && !(await scheduledJobExists(scheduler, scheduledJobId))
        : true

      // Validate the schedule (and register it with the scheduler) before writing
      // the SyncSchedule row — an unparseable scheduleValue must not leave a
      // persisted row with no working schedule behind it.
      await scheduler.register({
        id: scheduledJobId,
        name: buildScheduleName(input),
        description: buildScheduleDescription(input),
        scopeType: 'organization',
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        scheduleType: input.scheduleType,
        scheduleValue: input.scheduleValue,
        timezone: input.timezone,
        targetType: 'queue',
        targetQueue: 'data-sync-scheduled',
        targetPayload: {
          scheduleId: id,
          scope,
        },
        requireFeature: 'data_sync.run',
        sourceType: 'module',
        sourceModule: 'data_sync',
        isEnabled: input.isEnabled,
      })

      try {
        const row = existing ?? em.create(SyncSchedule, {
          id,
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
        row.scheduledJobId = scheduledJobId

        if (!existing) {
          em.persist(row)
        }

        await em.flush()

        return row
      } catch (error: unknown) {
        // The registration above is already durable, so a failed write would
        // otherwise strand a live ScheduledJob the data-sync page cannot explain
        // or delete. Only a registration this call minted is compensated: when a
        // job was already there, register() overwrote one we inherited, and
        // SchedulerServiceLike offers no way to restore the previous definition,
        // so unregistering would destroy that job rather than roll anything back.
        if (mintsRegistration) {
          try {
            await scheduler.unregister(scheduledJobId)
          } catch (compensationError: unknown) {
            logger.error('Failed to unregister the scheduled job after a schedule write failure', {
              scheduledJobId,
              scheduleId: id,
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              err: compensationError,
            })
          }
        }
        throw error
      }
    },

    async deleteSchedule(
      id: string,
      scope: SyncScope,
      container?: AwilixContainer,
      expectedUpdatedAt?: string | null,
    ): Promise<boolean> {
      const row = await getById(id, scope)
      if (!row) return false

      if (container) {
        await enforceCommandOptimisticLockWithGuards(container, {
          resourceKind: 'data_sync.schedule',
          resourceId: row.id,
          current: row.updatedAt ?? null,
          expected: expectedUpdatedAt ?? null,
        })
      }

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
