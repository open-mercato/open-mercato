import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../data/entities.js'
import { calculateNextRun } from '../lib/nextRunCalculator.js'
import type {
  ScheduleCreateInput,
  ScheduleUpdateInput,
} from '../data/validators.js'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

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
 * Ensure tenant/org scope for security
 */
function ensureTenantScope(ctx: any, tenantId: string | null | undefined) {
  if (tenantId && ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) {
    throw new Error('Tenant mismatch')
  }
}

/**
 * CREATE SCHEDULE COMMAND
 */
const createScheduleCommand: CommandHandler<ScheduleCreateInput, { id: string }> = {
  id: 'scheduler.jobs.create',

  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    if (input.organizationId) ensureOrganizationScope(ctx, input.organizationId)

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
      createdByUserId: (ctx.auth?.userId as string | undefined) ?? null,
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
    const payload = logEntry.payload as any
    const after = payload?.undo?.after as ScheduleSnapshot | undefined
    if (!after) return

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const schedule = await em.findOne(ScheduledJob, { id: after.id })

    if (schedule) {
      await em.remove(schedule).flush()
    }
  },
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
    schedule.updatedByUserId = (ctx.auth?.userId as string | undefined) ?? null

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
    const payload = logEntry.payload as any
    const before = payload?.undo?.before as ScheduleSnapshot | undefined
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
      schedule.nextRunAt = before.nextRunAt
      schedule.lastRunAt = before.lastRunAt
      schedule.updatedAt = new Date()

      await em.flush()
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

    // Soft delete
    schedule.deletedAt = new Date()
    schedule.updatedAt = new Date()
    schedule.updatedByUserId = (ctx.auth?.userId as string | undefined) ?? null

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
    const payload = logEntry.payload as any
    const before = payload?.undo?.before as ScheduleSnapshot | undefined
    if (!before) return

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const schedule = await em.findOne(ScheduledJob, { id: before.id })

    if (schedule) {
      // Restore by clearing deletedAt
      schedule.deletedAt = null
      schedule.updatedAt = new Date()
      await em.flush()
    }
  },
}

// Register all commands
registerCommand(createScheduleCommand)
registerCommand(updateScheduleCommand)
registerCommand(deleteScheduleCommand)
