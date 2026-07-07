import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../data/entities.js'
import { calculateNextRun } from '../lib/nextRunCalculator.js'
import type {
  ScheduleCreateInput,
  ScheduleUpdateInput,
} from '../data/validators.js'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { BullMQSchedulerService } from '../services/bullmqSchedulerService.js'

/**
 * Snapshot of a schedule for undo/redo
 */
type ScheduleSnapshot = {
  id: string
  name: string
  description: string | null
  scopeType: 'system' | 'organization' | 'tenant'
  organizationId: string | null
  tenantId: string | null
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  targetType: 'queue' | 'command'
  targetQueue: string | null
  targetCommand: string | null
  targetPayload: Record<string, unknown> | null
  requireFeature: string | null
  isEnabled: boolean
  sourceType: 'user' | 'module'
  sourceModule: string | null
  nextRunAt: Date | null
  lastRunAt: Date | null
}

/**
 * Load a schedule snapshot
 */
async function loadScheduleSnapshot(
  em: EntityManager,
  scheduleId: string
): Promise<ScheduleSnapshot | null> {
  const schedule = await em.findOne(ScheduledJob, { id: scheduleId })
  if (!schedule) return null

    return {
    id: schedule.id,
    name: schedule.name,
    description: schedule.description ?? null,
    scopeType: schedule.scopeType,
    organizationId: schedule.organizationId ?? null,
    tenantId: schedule.tenantId ?? null,
    scheduleType: schedule.scheduleType,
    scheduleValue: schedule.scheduleValue,
    timezone: schedule.timezone,
    targetType: schedule.targetType,
    targetQueue: schedule.targetQueue ?? null,
    targetCommand: schedule.targetCommand ?? null,
    targetPayload: schedule.targetPayload ?? null,
    requireFeature: schedule.requireFeature ?? null,
    isEnabled: schedule.isEnabled,
    sourceType: schedule.sourceType,
    sourceModule: schedule.sourceModule ?? null,
    nextRunAt: schedule.nextRunAt ?? null,
    lastRunAt: schedule.lastRunAt ?? null,
  }
}

/**
 * Snapshots are persisted as JSON (in the action log's command payload), so Date
 * fields come back as ISO strings on undo. Coerce them to Date before writing
 * them onto the entity, otherwise MikroORM throws while flushing a Date column.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

function resolveCommandActorUserId(ctx: CommandRuntimeContext): string | null {
  const auth = ctx.auth
  if (!auth) return null
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId.trim()
  if (auth.isApiKey) return null
  return typeof auth.sub === 'string' && auth.sub.trim().length > 0 ? auth.sub.trim() : null
}

/**
 * Build a full create seed (including the original id and Date-coerced timestamps)
 * from a snapshot. Shared by `materializeScheduleFromSnapshot` (delete-undo) and the
 * create command's id-preserving `redo`.
 */
function scheduleSeedFromSnapshot(snapshot: ScheduleSnapshot): Record<string, unknown> {
  const now = new Date()
  return {
    id: snapshot.id,
    name: snapshot.name,
    description: snapshot.description,
    scopeType: snapshot.scopeType,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    scheduleType: snapshot.scheduleType,
    scheduleValue: snapshot.scheduleValue,
    timezone: snapshot.timezone,
    targetType: snapshot.targetType,
    targetQueue: snapshot.targetQueue,
    targetCommand: snapshot.targetCommand,
    targetPayload: snapshot.targetPayload,
    requireFeature: snapshot.requireFeature,
    isEnabled: snapshot.isEnabled,
    sourceType: snapshot.sourceType,
    sourceModule: snapshot.sourceModule,
    nextRunAt: toDate(snapshot.nextRunAt),
    lastRunAt: toDate(snapshot.lastRunAt),
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Re-create a ScheduledJob entity from a snapshot, preserving its original id.
 * Used by delete-undo when the row was hard-removed rather than soft-deleted.
 */
function materializeScheduleFromSnapshot(em: EntityManager, snapshot: ScheduleSnapshot): ScheduledJob {
  return em.create(ScheduledJob, scheduleSeedFromSnapshot(snapshot) as never)
}

/**
 * Trigger BullMQ sync after undo operations.
 * Best-effort: if BullMQ service is unavailable (e.g. local strategy), this is a no-op.
 */
async function syncBullMQAfterUndo(ctx: CommandRuntimeContext, schedule: ScheduledJob | null): Promise<void> {
  try {
    if (!ctx.container?.resolve) return
    const bullmqService = ctx.container.resolve<BullMQSchedulerService>('bullmqSchedulerService')
    if (!bullmqService) return

    if (schedule && schedule.isEnabled && !schedule.deletedAt) {
      await bullmqService.register(schedule, { skipNextRunUpdate: true })
    } else if (schedule) {
      await bullmqService.unregister(schedule.id)
    }
  } catch {
    // Best-effort: BullMQ service may not be registered (local strategy)
  }
}

/**
 * Ensure tenant/org scope for security
 */
function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string | null | undefined) {
  if (tenantId && ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) {
    throw new Error('Tenant mismatch')
  }
}

// Super-admin status is the immutable `isSuperAdmin` flag derived from
// RoleAcl/UserAcl at session resolution. Never compare role names to a string
// like 'superadmin' — role names are tenant-mutable and trivially spoofable.
function isSuperAdminActor(ctx: CommandRuntimeContext): boolean {
  return ctx.auth?.isSuperAdmin === true
}

// `ensureTenantScope` is a no-op for system-scoped jobs (tenantId === null), so a
// `scheduler.jobs.manage` holder could otherwise update/delete a system schedule
// belonging to the whole deployment. System-scoped jobs MUST be super-admin only,
// mirroring the create route's system-scope gate.
function ensureCanManageSystemScopedJob(
  ctx: CommandRuntimeContext,
  job: { scopeType?: string | null; tenantId?: string | null },
): void {
  const isSystemScoped = job.scopeType === 'system' || job.tenantId == null
  if (!isSystemScoped) return
  if (isSuperAdminActor(ctx)) return
  throw new CrudHttpError(403, {
    error: 'System-scoped scheduled jobs can only be managed by a super administrator.',
  })
}

/**
 * CREATE SCHEDULE COMMAND
 */
const createScheduleCommand: CommandHandler<ScheduleCreateInput, { id: string }> = {
  id: 'scheduler.jobs.create',

  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    if (input.organizationId) ensureOrganizationScope(ctx, input.organizationId)
    ensureCanManageSystemScopedJob(ctx, { scopeType: input.scopeType, tenantId: input.tenantId })

    const em = ctx.container.resolve<EntityManager>('em').fork()

    // Calculate next run time
    const nextRunAt = calculateNextRun(
      input.scheduleType,
      input.scheduleValue,
      input.timezone || 'UTC'
    )

    if (!nextRunAt) {
      throw new Error('Failed to calculate next run time')
    }

    // Create schedule
    const schedule = em.create(ScheduledJob, {
      name: input.name,
      description: input.description ?? null,
      scopeType: input.scopeType,
      organizationId: input.organizationId ?? null,
      tenantId: input.tenantId ?? null,
      scheduleType: input.scheduleType,
      scheduleValue: input.scheduleValue,
      timezone: input.timezone ?? 'UTC',
      targetType: input.targetType,
      targetQueue: input.targetQueue ?? null,
      targetCommand: input.targetCommand ?? null,
      targetPayload: input.targetPayload ?? null,
      requireFeature: input.requireFeature ?? null,
      isEnabled: input.isEnabled ?? true,
      sourceType: input.sourceType ?? 'user',
      sourceModule: input.sourceModule ?? null,
      nextRunAt,
      createdByUserId: resolveCommandActorUserId(ctx),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    em.persist(schedule)
    await em.flush()

    return { id: schedule.id }
  },

  async captureAfter(_input, result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return await loadScheduleSnapshot(em, result.id)
  },

  async buildLog({ result, ctx, snapshots }) {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as ScheduleSnapshot | undefined

    return {
      actionLabel: translate('scheduler.audit.create', 'Create schedule'),
      resourceKind: 'scheduler.job',
      resourceId: result.id,
      tenantId: after?.tenantId || null,
      organizationId: after?.organizationId || null,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<UndoPayload<ScheduleSnapshot>>(logEntry)?.after
    if (!after) return

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const schedule = await em.findOne(ScheduledJob, { id: after.id })

    if (schedule) {
      await em.remove(schedule).flush()
      await syncBullMQAfterUndo(ctx, schedule)
    }
  },

  redo: makeCreateRedo<ScheduledJob, ScheduleSnapshot, ScheduleCreateInput, { id: string }>({
    entityClass: ScheduledJob,
    getSnapshotId: (snapshot) => snapshot.id,
    seedFromSnapshot: scheduleSeedFromSnapshot,
    buildResult: (entity) => ({ id: entity.id }),
    afterRestore: async ({ ctx, entity }) => {
      await syncBullMQAfterUndo(ctx, entity)
    },
  }),
}

/**
 * UPDATE SCHEDULE COMMAND
 */
const updateScheduleCommand: CommandHandler<ScheduleUpdateInput, { ok: boolean }> = {
  id: 'scheduler.jobs.update',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    const before = await loadScheduleSnapshot(em, input.id)
    return { before }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const schedule = await em.findOne(ScheduledJob, { id: input.id, deletedAt: null })
    if (!schedule) {
      throw new Error('Schedule not found')
    }

    ensureTenantScope(ctx, schedule.tenantId)
    if (schedule.organizationId) ensureOrganizationScope(ctx, schedule.organizationId)
    ensureCanManageSystemScopedJob(ctx, schedule)

    // Update fields
    if (input.name !== undefined) schedule.name = input.name
    if (input.description !== undefined) schedule.description = input.description ?? null
    if (input.scheduleType !== undefined) schedule.scheduleType = input.scheduleType
    if (input.scheduleValue !== undefined) schedule.scheduleValue = input.scheduleValue
    if (input.timezone !== undefined) schedule.timezone = input.timezone
    if (input.targetPayload !== undefined) schedule.targetPayload = input.targetPayload ?? null
    if (input.requireFeature !== undefined) schedule.requireFeature = input.requireFeature || null
    if (input.isEnabled !== undefined) schedule.isEnabled = input.isEnabled
    
    // Handle target type changes - clear stale values when switching between queue and command
    if (input.targetType !== undefined) {
      schedule.targetType = input.targetType
      
      if (input.targetType === 'queue') {
        // Switching to queue: set new queue and clear command
        if (input.targetQueue !== undefined) schedule.targetQueue = input.targetQueue
        schedule.targetCommand = null
      } else if (input.targetType === 'command') {
        // Switching to command: set new command and clear queue
        if (input.targetCommand !== undefined) schedule.targetCommand = input.targetCommand
        schedule.targetQueue = null
      }
    } else {
      // targetType not changing, but allow updating individual target fields
      if (input.targetQueue !== undefined) schedule.targetQueue = input.targetQueue
      if (input.targetCommand !== undefined) schedule.targetCommand = input.targetCommand
    }

    // Recalculate next run if schedule changed
    if (input.scheduleType !== undefined || input.scheduleValue !== undefined || input.timezone !== undefined) {
      const nextRunAt = calculateNextRun(
        schedule.scheduleType,
        schedule.scheduleValue,
        schedule.timezone
      )
      if (nextRunAt) {
        schedule.nextRunAt = nextRunAt
      }
    }

    schedule.updatedAt = new Date()
    schedule.updatedByUserId = resolveCommandActorUserId(ctx)

    await em.flush()

    return { ok: true }
  },

  async captureAfter(input, _result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return await loadScheduleSnapshot(em, input.id)
  },

  async buildLog({ input, ctx, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as ScheduleSnapshot | undefined
    const after = snapshots.after as ScheduleSnapshot | undefined

    return {
      actionLabel: translate('scheduler.audit.update', 'Update schedule'),
      resourceKind: 'scheduler.job',
      resourceId: input.id,
      tenantId: after?.tenantId || null,
      organizationId: after?.organizationId || null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<ScheduleSnapshot>>(logEntry)?.before
    if (!before) return

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const schedule = await em.findOne(ScheduledJob, { id: before.id })

    if (schedule) {
      // Restore all fields
      schedule.name = before.name
      schedule.description = before.description
      schedule.scopeType = before.scopeType
      schedule.organizationId = before.organizationId
      schedule.tenantId = before.tenantId
      schedule.scheduleType = before.scheduleType
      schedule.scheduleValue = before.scheduleValue
      schedule.timezone = before.timezone
      schedule.targetType = before.targetType
      schedule.targetQueue = before.targetQueue
      schedule.targetCommand = before.targetCommand
      schedule.targetPayload = before.targetPayload
      schedule.requireFeature = before.requireFeature
      schedule.isEnabled = before.isEnabled
      schedule.sourceType = before.sourceType
      schedule.sourceModule = before.sourceModule
      schedule.nextRunAt = toDate(before.nextRunAt)
      schedule.lastRunAt = toDate(before.lastRunAt)
      schedule.updatedAt = new Date()

      await em.flush()
      await syncBullMQAfterUndo(ctx, schedule)
    }
  },
}

/**
 * DELETE SCHEDULE COMMAND
 */
const deleteScheduleCommand: CommandHandler<{ id: string }, { ok: boolean }> = {
  id: 'scheduler.jobs.delete',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    const before = await loadScheduleSnapshot(em, input.id)
    return { before }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const schedule = await em.findOne(ScheduledJob, { id: input.id, deletedAt: null })
    if (!schedule) {
      throw new Error('Schedule not found')
    }

    ensureTenantScope(ctx, schedule.tenantId)
    if (schedule.organizationId) ensureOrganizationScope(ctx, schedule.organizationId)
    ensureCanManageSystemScopedJob(ctx, schedule)

    // Soft delete
    schedule.deletedAt = new Date()
    schedule.updatedAt = new Date()
    schedule.updatedByUserId = resolveCommandActorUserId(ctx)

    await em.flush()

    return { ok: true }
  },

  async buildLog({ input, ctx, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as ScheduleSnapshot | undefined

    return {
      actionLabel: translate('scheduler.audit.delete', 'Delete schedule'),
      resourceKind: 'scheduler.job',
      resourceId: input.id,
      tenantId: before?.tenantId || null,
      organizationId: before?.organizationId || null,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<ScheduleSnapshot>>(logEntry)?.before
    if (!before) return

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const existing = await em.findOne(ScheduledJob, { id: before.id })

    // Soft-deleted rows are restored by clearing `deletedAt`. A hard-removed row
    // (no surviving record) is re-materialized from the snapshot so undo is
    // robust to either deletion strategy — mirroring the sales reference undo.
    const schedule = existing ?? materializeScheduleFromSnapshot(em, before)
    if (existing) {
      schedule.deletedAt = null
      schedule.updatedAt = new Date()
    }
    await em.flush()
    await syncBullMQAfterUndo(ctx, schedule)
  },
}

// Register all commands
registerCommand(createScheduleCommand)
registerCommand(updateScheduleCommand)
registerCommand(deleteScheduleCommand)
