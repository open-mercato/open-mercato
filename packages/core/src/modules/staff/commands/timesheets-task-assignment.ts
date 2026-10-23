import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember, StaffTimeTask, StaffTimeTaskStatus } from '../data/entities'
import {
  isActiveProjectAssigner,
  resolveAssignmentGraceDaysFromContainer,
} from '../lib/time-tracking/projectAssignment'
import {
  TASK_LIST_CACHE_RESOURCE,
  emitTaskAssigneeChanged,
  taskCrudEvents,
  taskCrudIndexer,
} from './timesheets-tasks'
import {
  applyScopeToWhere,
  commandActorScope,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
} from './shared'

export const staffTimeTaskAssignmentCommandIds = {
  claim: 'staff.timesheets.tasks.claim',
  release: 'staff.timesheets.tasks.release',
} as const

export const TASK_ALREADY_CLAIMED_CODE = 'task_already_claimed'
export const TASK_NOT_CLAIMABLE_CODE = 'task_not_claimable'
export const TASK_NOT_ASSIGNER_CODE = 'task_not_assigner'
export const TASK_NOT_ASSIGNEE_CODE = 'task_not_assignee'
export const TASK_ASSIGNMENT_CHANGED_CODE = 'task_assignment_changed'

const assignmentInputSchema = z.object({ id: z.string().uuid() })

export type StaffTimeTaskAssignmentInput = z.infer<typeof assignmentInputSchema>

export type StaffTimeTaskAssignmentResult = {
  taskId: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  assigneeStaffMemberId: string | null
  updatedAt: string | null
}

type AssignmentUndoPayload = {
  taskId: string
  tenantId: string
  organizationId: string
  previousAssigneeStaffMemberId: string | null
  nextAssigneeStaffMemberId: string | null
}

type Translate = (key: string, fallback: string) => string

function notFound(translate: Translate): CrudHttpError {
  return new CrudHttpError(404, {
    error: translate('staff.time_tracking.tasks.errors.notFound', 'Task not found or not accessible.'),
  })
}

function notClaimable(translate: Translate): CrudHttpError {
  return new CrudHttpError(422, {
    code: TASK_NOT_CLAIMABLE_CODE,
    error: translate('staff.timesheets.errors.taskNotClaimable', 'A finished task cannot be claimed.'),
  })
}

function alreadyClaimed(translate: Translate): CrudHttpError {
  return new CrudHttpError(409, {
    code: TASK_ALREADY_CLAIMED_CODE,
    error: translate('staff.timesheets.errors.taskAlreadyClaimed', 'Someone else already took this task.'),
  })
}

async function loadDoneStatusIds(em: EntityManager, task: StaffTimeTask): Promise<string[]> {
  const statuses = await em.find(
    StaffTimeTaskStatus,
    { timeProjectId: task.timeProjectId, tenantId: task.tenantId, organizationId: task.organizationId, isDone: true },
    { fields: ['id'] },
  )
  return statuses.map((status) => status.id)
}

async function resolveActorStaffMemberId(em: EntityManager, ctx: CommandRuntimeContext, task: StaffTimeTask): Promise<string | null> {
  const userId = ctx.auth?.sub ?? null
  if (!userId) return null
  const member = await findOneWithDecryption(
    em,
    StaffTeamMember,
    { userId, tenantId: task.tenantId, organizationId: task.organizationId, deletedAt: null },
    undefined,
    { tenantId: task.tenantId, organizationId: task.organizationId },
  )
  return member?.id ?? null
}

async function loadScopedTask(em: EntityManager, ctx: CommandRuntimeContext, id: string, translate: Translate): Promise<StaffTimeTask> {
  const task = await em.findOne(
    StaffTimeTask,
    applyScopeToWhere<StaffTimeTask>({ id, deletedAt: null }, commandActorScope(ctx)),
  )
  if (!task) throw notFound(translate)
  ensureTenantScope(ctx, task.tenantId)
  ensureOrganizationScope(ctx, task.organizationId)
  return task
}

async function emitTaskSideEffects(ctx: CommandRuntimeContext, task: StaffTimeTask, undo = false): Promise<void> {
  const params = {
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action: 'updated' as const,
    entity: task,
    identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
    events: taskCrudEvents,
    indexer: taskCrudIndexer,
  }
  if (undo) await emitCrudUndoSideEffects(params)
  else await emitCrudSideEffects(params)
}

/**
 * The conditional UPDATE is the only moment this writer owns the row, so the outcome is
 * built from what it wrote rather than re-read: a later writer may already have replaced
 * the assignee, and reporting or undoing their value would be wrong.
 */
function captureWrittenState(
  em: EntityManager,
  task: StaffTimeTask,
  assigneeStaffMemberId: string | null,
  updatedAt: Date,
): StaffTimeTask {
  em.clear()
  task.assigneeStaffMemberId = assigneeStaffMemberId
  task.updatedAt = updatedAt
  return task
}

function toResult(task: StaffTimeTask): StaffTimeTaskAssignmentResult {
  return {
    taskId: task.id,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    timeProjectId: task.timeProjectId,
    assigneeStaffMemberId: task.assigneeStaffMemberId ?? null,
    updatedAt: task.updatedAt ? task.updatedAt.toISOString() : null,
  }
}

async function restoreAssignee(
  ctx: CommandRuntimeContext,
  payload: AssignmentUndoPayload,
): Promise<void> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const where = {
    id: payload.taskId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    assigneeStaffMemberId: payload.nextAssigneeStaffMemberId,
    deletedAt: null,
  }
  const current = await em.findOne(StaffTimeTask, where)
  if (!current) return
  const now = new Date()
  const affected = await em.nativeUpdate(
    StaffTimeTask,
    where,
    { assigneeStaffMemberId: payload.previousAssigneeStaffMemberId, updatedAt: now },
  )
  if (affected === 0) return
  const task = captureWrittenState(em, current, payload.previousAssigneeStaffMemberId, now)
  await emitTaskSideEffects(ctx, task, true)
  emitTaskAssigneeChanged(task, payload.nextAssigneeStaffMemberId, 'manual', ctx.auth?.sub ?? null)
}

const claimTaskCommand: CommandHandler<StaffTimeTaskAssignmentInput, StaffTimeTaskAssignmentResult> = {
  id: staffTimeTaskAssignmentCommandIds.claim,
  async execute(rawInput, ctx) {
    const parsed = assignmentInputSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await loadScopedTask(em, ctx, parsed.id, translate)
    const scope = { tenantId: task.tenantId, organizationId: task.organizationId }

    const staffMemberId = await resolveActorStaffMemberId(em, ctx, task)
    const graceDays = await resolveAssignmentGraceDaysFromContainer(ctx.container, task.tenantId)
    const isAssigner = staffMemberId
      ? await isActiveProjectAssigner(em, scope, task.timeProjectId, staffMemberId, { graceDays })
      : false
    if (!staffMemberId || !isAssigner) {
      throw new CrudHttpError(403, {
        code: TASK_NOT_ASSIGNER_CODE,
        error: translate('staff.timesheets.errors.notAssigner', 'Only active assigners of this project can claim tasks.'),
      })
    }

    const doneStatusIds = await loadDoneStatusIds(em, task)
    if (doneStatusIds.includes(task.taskStatusId)) throw notClaimable(translate)
    if (task.assigneeStaffMemberId) throw alreadyClaimed(translate)

    const now = new Date()
    const affected = await em.nativeUpdate(
      StaffTimeTask,
      {
        id: task.id,
        tenantId: task.tenantId,
        organizationId: task.organizationId,
        assigneeStaffMemberId: null,
        deletedAt: null,
        ...(doneStatusIds.length > 0 ? { taskStatusId: { $nin: doneStatusIds } } : {}),
      },
      { assigneeStaffMemberId: staffMemberId, updatedAt: now },
    )
    if (affected === 0) {
      em.clear()
      const current = await em.findOne(StaffTimeTask, { id: task.id, tenantId: task.tenantId, organizationId: task.organizationId, deletedAt: null })
      if (!current) throw notFound(translate)
      if (!current.assigneeStaffMemberId && doneStatusIds.includes(current.taskStatusId)) throw notClaimable(translate)
      throw alreadyClaimed(translate)
    }
    const claimed = captureWrittenState(em, task, staffMemberId, now)
    await emitTaskSideEffects(ctx, claimed)
    emitTaskAssigneeChanged(claimed, null, 'claim', ctx.auth?.sub ?? null)
    return toResult(claimed)
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tasks.claim', 'Claim task'),
      resourceKind: 'staff.timesheets.task',
      resourceId: result.taskId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      context: { cacheAliases: [TASK_LIST_CACHE_RESOURCE] },
      payload: {
        undo: {
          taskId: result.taskId,
          tenantId: result.tenantId,
          organizationId: result.organizationId,
          previousAssigneeStaffMemberId: null,
          nextAssigneeStaffMemberId: result.assigneeStaffMemberId,
        } satisfies AssignmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AssignmentUndoPayload>(logEntry)
    if (!payload?.taskId) return
    await restoreAssignee(ctx, payload)
  },
}

const releaseTaskCommand: CommandHandler<StaffTimeTaskAssignmentInput, StaffTimeTaskAssignmentResult & { previousAssigneeStaffMemberId: string | null }> = {
  id: staffTimeTaskAssignmentCommandIds.release,
  async execute(rawInput, ctx) {
    const parsed = assignmentInputSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await loadScopedTask(em, ctx, parsed.id, translate)
    const staffMemberId = await resolveActorStaffMemberId(em, ctx, task)
    if (!staffMemberId || task.assigneeStaffMemberId !== staffMemberId) {
      throw new CrudHttpError(403, {
        code: TASK_NOT_ASSIGNEE_CODE,
        error: translate('staff.timesheets.errors.notAssignee', 'Only the current assignee can release this task.'),
      })
    }
    const now = new Date()
    const affected = await em.nativeUpdate(
      StaffTimeTask,
      { id: task.id, tenantId: task.tenantId, organizationId: task.organizationId, assigneeStaffMemberId: staffMemberId, deletedAt: null },
      { assigneeStaffMemberId: null, updatedAt: now },
    )
    if (affected === 0) {
      throw new CrudHttpError(409, {
        code: TASK_ASSIGNMENT_CHANGED_CODE,
        error: translate('staff.timesheets.errors.taskChanged', 'The task changed while you were releasing it. Refresh and try again.'),
      })
    }
    const released = captureWrittenState(em, task, null, now)
    await emitTaskSideEffects(ctx, released)
    emitTaskAssigneeChanged(released, staffMemberId, 'release', ctx.auth?.sub ?? null)
    return { ...toResult(released), previousAssigneeStaffMemberId: staffMemberId }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tasks.release', 'Release task'),
      resourceKind: 'staff.timesheets.task',
      resourceId: result.taskId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      context: { cacheAliases: [TASK_LIST_CACHE_RESOURCE] },
      payload: {
        undo: {
          taskId: result.taskId,
          tenantId: result.tenantId,
          organizationId: result.organizationId,
          previousAssigneeStaffMemberId: result.previousAssigneeStaffMemberId,
          nextAssigneeStaffMemberId: null,
        } satisfies AssignmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AssignmentUndoPayload>(logEntry)
    if (!payload?.taskId) return
    await restoreAssignee(ctx, payload)
  },
}

registerCommand(claimTaskCommand)
registerCommand(releaseTaskCommand)
