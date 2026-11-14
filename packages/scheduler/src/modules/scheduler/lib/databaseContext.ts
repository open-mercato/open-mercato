import type { EntityManager } from '@mikro-orm/core'
import { z } from 'zod'
import type { DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { resolveOwnedDatabaseJobContext } from '@open-mercato/shared/lib/db/declarations'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { ScheduledJob } from '../data/entities.js'
import { canDispatchScheduleQueueTarget, sanitizeSchedulerTargetPayload } from './safeQueueTargets.js'

const scheduleScopeSchema = z.discriminatedUnion('scopeType', [
  z.object({ scopeType: z.literal('tenant'), tenantId: z.string().uuid(), organizationId: z.nullish(z.never()) }),
  z.object({ scopeType: z.literal('organization'), tenantId: z.string().uuid(), organizationId: z.string().uuid() }),
  z.object({ scopeType: z.literal('system'), tenantId: z.nullish(z.never()), organizationId: z.nullish(z.never()) }),
])

export function withSchedulerMaintenance<Result>(operation: string, callback: (em: EntityManager) => Promise<Result>): Promise<Result> {
  return runWithFreshDatabaseExecutionContext({ kind: 'maintenance', tenantId: null, source: 'scheduler', operation }, async () => {
    const { getOrm } = await import('@open-mercato/shared/lib/db/mikro')
    const orm = await getOrm()
    const em = orm.em.fork({ clear: true, freshEventManager: true })
    try { return await callback(em) } finally { em.clear() }
  })
}

type ScheduleDatabaseIdentity = Pick<ScheduledJob,
  'id' | 'scopeType' | 'tenantId' | 'organizationId' | 'sourceType' | 'sourceModule'
  | 'createdByUserId' | 'updatedByUserId' | 'targetType' | 'targetQueue' | 'targetPayload'
>

export async function resolveScheduleDatabaseContext(schedule: ScheduleDatabaseIdentity): Promise<DatabaseExecutionContext> {
  const scope = scheduleScopeSchema.parse(schedule)
  if (scope.scopeType !== 'system') {
    return { kind: 'tenant', tenantId: scope.tenantId.toLowerCase(), source: 'scheduler', operation: `schedule:${schedule.id}` }
  }
  if (schedule.sourceType !== 'module' || !schedule.sourceModule || schedule.createdByUserId || schedule.updatedByUserId) {
    throw new Error('[internal] Global schedule requires explicit module ownership')
  }
  const owner = getModules().find((module) => module.id === schedule.sourceModule)
  if (!owner) throw new Error('[internal] Global schedule owner is unavailable')
  if (schedule.targetType !== 'queue' || !schedule.targetQueue || !canDispatchScheduleQueueTarget(schedule)) {
    throw new Error('[internal] Global schedule target requires an explicit database classification')
  }
  const targetQueue = schedule.targetQueue
  const context = await runWithFreshDatabaseExecutionContext({
    kind: 'maintenance', tenantId: null, source: 'scheduler', operation: `scheduler.classify:${schedule.id}`,
  }, () => resolveOwnedDatabaseJobContext(owner.id, {
    queue: targetQueue,
    workerIds: (owner.workers ?? []).filter((worker) => worker.queue === targetQueue).map((worker) => worker.id),
    payload: sanitizeSchedulerTargetPayload(schedule.targetPayload, schedule),
  }))
  if (context.kind !== 'maintenance') throw new Error('[internal] Global schedule owner must explicitly classify maintenance work')
  return { kind: 'maintenance', tenantId: null, source: 'scheduler', operation: `schedule:${schedule.id}` }
}

export function assertScheduleEnvelope(schedule: ScheduledJob, payload: unknown): void {
  const envelope = z.object({
    scheduleId: z.string().uuid(),
    scopeType: z.enum(['system', 'organization', 'tenant']),
    tenantId: z.string().uuid().nullish(),
    organizationId: z.string().uuid().nullish(),
  }).parse(payload)
  if (envelope.scheduleId !== schedule.id || envelope.scopeType !== schedule.scopeType
    || envelope.tenantId !== schedule.tenantId || envelope.organizationId !== schedule.organizationId) {
    throw new Error('[internal] Schedule execution envelope does not match persisted scope')
  }
}

export async function resolvePersistedScheduleDatabaseContext(payload: unknown): Promise<DatabaseExecutionContext> {
  const { scheduleId } = z.object({ scheduleId: z.string().uuid() }).parse(payload)
  return withSchedulerMaintenance('scheduler.execution-discovery', async (em) => {
    const schedule = await em.findOne(ScheduledJob, { id: scheduleId, deletedAt: null })
    if (!schedule) throw new Error('[internal] Schedule execution references a missing schedule')
    assertScheduleEnvelope(schedule, payload)
    return resolveScheduleDatabaseContext(schedule)
  })
}
