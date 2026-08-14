/**
 * Task commands for the Kanban board of screen 6 and the drawer of screen 7 (D-2).
 *
 * A subtask is not a second entity — it is a task with `parent_task_id` set, carrying
 * its own status, assignee and time entries. Everything that follows from that is
 * enforced here rather than trusted from the request:
 *
 *  1. **Depth is capped at one.** Creating or re-parenting under a task that itself has
 *     a parent is refused with `400 subtask_depth_exceeded`, and a task that already
 *     holds children may not become one. The board therefore renders exactly the
 *     top-level tasks and the drawer exactly one level below them.
 *  2. **Soft-deleting a parent soft-deletes its children in the same transaction.**
 *     Time entries are deliberately left alone: they keep pointing at the deleted task
 *     so a closed report still resolves its line labels.
 *  3. **A task lives in exactly one project (§2).** Moving one between projects would
 *     invalidate its reference, its column and every report line quoting it, so the
 *     request is refused instead of silently ignored.
 *  4. **Done-ness has one source of truth** — the status column's `is_done`. There is
 *     no `is_done` on the task; landing on a terminal column stamps `closed_at` and
 *     leaving one clears it.
 *
 * `title` is the only field a caller must supply beyond scoping and the project
 * (US-C1): the status defaults to the project's `is_default` column and the assignee
 * to the creator, both overridable.
 *
 * The rollup (`ownMinutes` / `loggedMinutes` / `childCount`) is NOT computed here — it
 * is a read-side concern owned by `lib/time-tracking/rollup.ts`.
 */

import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { StaffTeamMember, StaffTimeProject, StaffTimeTask, StaffTimeTaskStatus } from '../data/entities'
import {
  staffTimeTaskCreateSchema,
  staffTimeTaskStatusChangeSchema,
  staffTimeTaskUpdateSchema,
  type StaffTimeTaskCreateInput,
  type StaffTimeTaskUpdateInput,
} from '../data/validators'
import { emitStaffEvent } from '../events'
import { nextStatusPosition } from '../lib/timesheets-tasks/statusPositions'
import {
  allocateTaskReference,
  isTaskReferenceConflict,
  withTaskReferenceRetry,
} from '../lib/timesheets-tasks/taskReference'
import {
  SUBTASK_DEPTH_EXCEEDED_CODE,
  planTaskSoftDelete,
  rejectTaskParent,
  type TaskParentRejection,
} from '../lib/timesheets-tasks/taskHierarchy'
import {
  applyScopeToWhere,
  commandActorScope,
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  scopeForDecryption,
  scopedStaffSnapshotWhere,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffCommandScope,
  type StaffSnapshotScope,
} from './shared'

export const staffTimeTaskCommandIds = {
  create: 'staff.timesheets.tasks.create',
  update: 'staff.timesheets.tasks.update',
  delete: 'staff.timesheets.tasks.delete',
  statusChange: 'staff.timesheets.tasks.status_change',
} as const

/**
 * Resource kind the board's drag endpoint presents to the mutation-guard registry
 * and to the command-level optimistic lock. It matches the entity naming the other
 * hand-written timesheets routes use (`staff.timesheets.time_entry`,
 * `staff.timesheets.time_project`) so an `OM_OPTIMISTIC_LOCK` allow-list can name
 * it. The audit `resourceKind` stays `staff.timesheets.task`, which is what the
 * other task commands already write.
 */
export const STAFF_TIME_TASK_RESOURCE_KIND = 'staff.timesheets.time_task'

export const TASK_DEPTH_EXCEEDED_CODE = SUBTASK_DEPTH_EXCEEDED_CODE
export const TASK_PARENT_SELF_CODE = 'task_parent_self'
export const TASK_PARENT_PROJECT_MISMATCH_CODE = 'task_parent_project_mismatch'
export const TASK_PROJECT_MOVE_UNSUPPORTED_CODE = 'task_project_move_unsupported'
export const TASK_STATUS_MISSING_CODE = 'task_status_missing'
export const TASK_REFERENCE_CONFLICT_CODE = 'task_reference_conflict'

const logger = createLogger('staff').child({ component: 'commands/timesheets-tasks' })

const taskCrudIndexer: CrudIndexerConfig<StaffTimeTask> = {
  entityType: 'staff:staff_time_task',
}

/**
 * `staff.timesheets.time_task.{created,updated,deleted}` from `events.ts`. The
 * lifecycle `…status_changed` event belongs to the dedicated status endpoint that
 * owns the drag-and-drop move, not to these generic writes.
 */
const taskCrudEvents: CrudEventsConfig<StaffTimeTask> = {
  module: 'staff',
  entity: 'timesheets.time_task',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type Translate = (key: string, fallback: string) => string

type TaskSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  parentTaskId: string | null
  taskStatusId: string
  sequenceNumber: number
  reference: string
  title: string
  description: string | null
  assigneeStaffMemberId: string | null
  position: number
  createdByUserId: string | null
  closedAt: string | null
  deletedAt: string | null
}

type TaskUndoPayload = {
  before?: TaskSnapshot | null
  after?: TaskSnapshot | null
  /** Children the delete took with it, so undo can put the whole set back. */
  cascadedChildren?: TaskSnapshot[] | null
}

const DIFFED_FIELDS = [
  'parentTaskId',
  'taskStatusId',
  'title',
  'description',
  'assigneeStaffMemberId',
  'position',
  'closedAt',
] as const

function toSnapshot(task: StaffTimeTask): TaskSnapshot {
  return {
    id: task.id,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    timeProjectId: task.timeProjectId,
    parentTaskId: task.parentTaskId ?? null,
    taskStatusId: task.taskStatusId,
    sequenceNumber: task.sequenceNumber,
    reference: task.reference,
    title: task.title,
    description: task.description ?? null,
    assigneeStaffMemberId: task.assigneeStaffMemberId ?? null,
    position: task.position,
    createdByUserId: task.createdByUserId ?? null,
    closedAt: task.closedAt ? task.closedAt.toISOString() : null,
    deletedAt: task.deletedAt ? task.deletedAt.toISOString() : null,
  }
}

function snapshotScopeWhere(scope?: StaffSnapshotScope | null): { tenantId?: string; organizationId?: string } {
  const where: { tenantId?: string; organizationId?: string } = {}
  if (scope?.tenantId) where.tenantId = scope.tenantId
  if (scope?.organizationId) where.organizationId = scope.organizationId
  return where
}

async function loadTaskSnapshot(
  em: EntityManager,
  id: string,
  scope?: StaffSnapshotScope | null,
): Promise<TaskSnapshot | null> {
  const task = await em.findOne(StaffTimeTask, scopedStaffSnapshotWhere(id, scope))
  return task ? toSnapshot(task) : null
}

async function loadChildSnapshots(
  em: EntityManager,
  parentTaskId: string,
  scope?: StaffSnapshotScope | null,
): Promise<TaskSnapshot[]> {
  const children = await em.find(StaffTimeTask, {
    parentTaskId,
    deletedAt: null,
    ...snapshotScopeWhere(scope),
  })
  return children.map(toSnapshot)
}

function notFoundError(translate: Translate): CrudHttpError {
  return new CrudHttpError(404, {
    error: translate('staff.time_tracking.tasks.errors.notFound', 'Task not found or not accessible.'),
  })
}

function projectNotFoundError(translate: Translate): CrudHttpError {
  const message = translate('staff.timesheets.errors.projectNotFound', 'Time project not found or not accessible.')
  return new CrudHttpError(422, { error: message, fieldErrors: { timeProjectId: message } })
}

function statusNotFoundError(translate: Translate): CrudHttpError {
  const message = translate(
    'staff.time_tracking.tasks.errors.statusNotFound',
    'That column does not belong to this project.',
  )
  return new CrudHttpError(422, { error: message, fieldErrors: { taskStatusId: message } })
}

function statusMissingError(translate: Translate): CrudHttpError {
  return new CrudHttpError(422, {
    code: TASK_STATUS_MISSING_CODE,
    error: translate(
      'staff.time_tracking.tasks.errors.statusMissing',
      'This project has no columns yet, so a task cannot be placed on its board.',
    ),
  })
}

function parentNotFoundError(translate: Translate): CrudHttpError {
  const message = translate(
    'staff.time_tracking.tasks.errors.parentNotFound',
    'Parent task not found or not accessible.',
  )
  return new CrudHttpError(422, { error: message, fieldErrors: { parentTaskId: message } })
}

function assigneeNotFoundError(translate: Translate): CrudHttpError {
  const message = translate(
    'staff.timesheets.errors.staffMemberNotFound',
    'Staff member not found or not accessible.',
  )
  return new CrudHttpError(422, { error: message, fieldErrors: { assigneeStaffMemberId: message } })
}

/**
 * The one refusal the drawer has to be able to explain: nesting is one level deep, so
 * a subtask can neither gain a subtask nor be handed to another subtask.
 */
function parentRejectionError(translate: Translate, rejection: TaskParentRejection): CrudHttpError {
  if (rejection === 'self_parent') {
    const message = translate(
      'staff.time_tracking.tasks.errors.parentSelf',
      'A task cannot be its own subtask.',
    )
    return new CrudHttpError(400, {
      code: TASK_PARENT_SELF_CODE,
      error: message,
      fieldErrors: { parentTaskId: message },
    })
  }
  if (rejection === 'parent_project_mismatch') {
    const message = translate(
      'staff.time_tracking.tasks.errors.parentProjectMismatch',
      'A subtask must stay in the same project as its parent.',
    )
    return new CrudHttpError(422, {
      code: TASK_PARENT_PROJECT_MISMATCH_CODE,
      error: message,
      fieldErrors: { parentTaskId: message },
    })
  }
  const message = translate(
    'staff.time_tracking.tasks.errors.subtaskDepthExceeded',
    'Subtasks are one level deep. A subtask cannot have subtasks of its own.',
  )
  return new CrudHttpError(400, {
    code: TASK_DEPTH_EXCEEDED_CODE,
    error: message,
    fieldErrors: { parentTaskId: message },
  })
}

function referenceConflictError(translate: Translate): CrudHttpError {
  return new CrudHttpError(409, {
    code: TASK_REFERENCE_CONFLICT_CODE,
    error: translate(
      'staff.time_tracking.tasks.errors.referenceConflict',
      'Could not allocate a task number right now. Try again.',
    ),
  })
}

async function requireProject(
  em: EntityManager,
  timeProjectId: string,
  scope: StaffCommandScope,
  translate: Translate,
): Promise<StaffTimeProject> {
  const project = await em.findOne(
    StaffTimeProject,
    applyScopeToWhere<StaffTimeProject>({ id: timeProjectId, deletedAt: null }, scope),
  )
  if (!project) throw projectNotFoundError(translate)
  return project
}

/**
 * The column a task lands on: the requested one when it belongs to this project, and
 * otherwise the project's `is_default` entry point. The board invariants guarantee one
 * exists; the positional fallback only covers a board repaired by hand.
 */
async function resolveTaskStatus(
  em: EntityManager,
  timeProjectId: string,
  requestedStatusId: string | null | undefined,
  scope: StaffCommandScope,
  translate: Translate,
): Promise<StaffTimeTaskStatus> {
  if (requestedStatusId) {
    const status = await em.findOne(
      StaffTimeTaskStatus,
      applyScopeToWhere<StaffTimeTaskStatus>({ id: requestedStatusId, timeProjectId, deletedAt: null }, scope),
    )
    if (!status) throw statusNotFoundError(translate)
    return status
  }
  const board = await em.find(
    StaffTimeTaskStatus,
    applyScopeToWhere<StaffTimeTaskStatus>({ timeProjectId, deletedAt: null }, scope),
  )
  if (board.length === 0) throw statusMissingError(translate)
  const ordered = [...board].sort((left, right) => left.position - right.position)
  return ordered.find((status) => status.isDefault) ?? ordered[0]
}

async function requireParentTask(
  em: EntityManager,
  parentTaskId: string,
  scope: StaffCommandScope,
  translate: Translate,
): Promise<StaffTimeTask> {
  const parent = await em.findOne(
    StaffTimeTask,
    applyScopeToWhere<StaffTimeTask>({ id: parentTaskId, deletedAt: null }, scope),
  )
  if (!parent) throw parentNotFoundError(translate)
  return parent
}

async function resolveStaffMemberIdForUser(
  em: EntityManager,
  userId: string | null | undefined,
  scope: StaffCommandScope,
): Promise<string | null> {
  if (!userId) return null
  const member = await findOneWithDecryption(
    em,
    StaffTeamMember,
    applyScopeToWhere<StaffTeamMember>({ userId, deletedAt: null }, scope),
    undefined,
    scopeForDecryption(scope),
  )
  return member?.id ?? null
}

async function requireStaffMember(
  em: EntityManager,
  staffMemberId: string,
  scope: StaffCommandScope,
  translate: Translate,
): Promise<string> {
  const member = await em.findOne(
    StaffTeamMember,
    applyScopeToWhere<StaffTeamMember>({ id: staffMemberId, deletedAt: null }, scope),
  )
  if (!member) throw assigneeNotFoundError(translate)
  return member.id
}

/**
 * Order within a column, on the same gap grid the columns themselves use: a drop
 * between two cards writes one row instead of renumbering the stack.
 */
async function nextTaskPosition(
  em: EntityManager,
  timeProjectId: string,
  taskStatusId: string,
  scope: StaffCommandScope,
): Promise<number> {
  const siblings = await em.find(
    StaffTimeTask,
    applyScopeToWhere<StaffTimeTask>({ timeProjectId, taskStatusId, deletedAt: null }, scope),
  )
  return nextStatusPosition(siblings.map((task) => task.position))
}

/**
 * The highest number the project has EVER handed out, deleted rows included. The
 * unique index only covers live rows, so a soft-deleted `TT-142` would otherwise let
 * the next task reuse that reference — and a closed report quoting the old one would
 * suddenly read as the new one.
 */
async function readHighestSequenceNumber(
  em: EntityManager,
  timeProjectId: string,
  scope: StaffCommandScope,
): Promise<number> {
  const tasks = await em.find(StaffTimeTask, applyScopeToWhere<StaffTimeTask>({ timeProjectId }, scope))
  return tasks.reduce((highest, task) => Math.max(highest, task.sequenceNumber ?? 0), 0)
}

/**
 * §2: a task lives in exactly one project. The update schema has no `timeProjectId`,
 * so a caller sending one would otherwise have it silently dropped and believe the
 * move succeeded.
 */
function assertNoProjectMove(rawInput: unknown, task: StaffTimeTask, translate: Translate): void {
  if (!rawInput || typeof rawInput !== 'object') return
  const requested = (rawInput as Record<string, unknown>).timeProjectId
  if (requested === undefined || requested === null) return
  if (typeof requested === 'string' && requested === task.timeProjectId) return
  const message = translate(
    'staff.time_tracking.tasks.errors.projectMoveUnsupported',
    'A task cannot be moved to another project. Create it in the target project instead.',
  )
  throw new CrudHttpError(400, {
    code: TASK_PROJECT_MOVE_UNSUPPORTED_CODE,
    error: message,
    fieldErrors: { timeProjectId: message },
  })
}

function applyStatusToTask(task: StaffTimeTask, status: StaffTimeTaskStatus, now: Date): void {
  task.taskStatusId = status.id
  // Done-ness comes from the column, never from a boolean on the task: landing on a
  // terminal column closes it, leaving one re-opens it.
  if (status.isDone) {
    if (!task.closedAt) task.closedAt = now
  } else {
    task.closedAt = null
  }
}

function actorUserId(ctx: CommandRuntimeContext): string | null {
  return typeof ctx.auth?.sub === 'string' ? ctx.auth.sub : null
}

const createTaskCommand: CommandHandler<StaffTimeTaskCreateInput, { taskId: string }> = {
  id: staffTimeTaskCommandIds.create,
  async execute(rawInput, ctx) {
    const parsed = staffTimeTaskCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)
    const { translate } = await resolveTranslations()
    const baseEm = ctx.container.resolve('em') as EntityManager
    const createdByUserId = actorUserId(ctx)

    let record: StaffTimeTask
    try {
      record = await withTaskReferenceRetry(async () => {
        // A fresh fork per attempt: a lost race aborts the transaction, so the retry
        // re-reads the project's highest number rather than reusing a stale max.
        const em = baseEm.fork()
        let created: StaffTimeTask | null = null
        let plan: {
          project: StaffTimeProject
          status: StaffTimeTaskStatus
          parentTaskId: string | null
          assigneeStaffMemberId: string | null
          position: number
          highestSequenceNumber: number
        } | null = null

        await withAtomicFlush(
          em,
          [
            async () => {
              const project = await requireProject(em, parsed.timeProjectId, scope, translate)
              const status = await resolveTaskStatus(em, parsed.timeProjectId, parsed.taskStatusId, scope, translate)

              let parentTaskId: string | null = null
              if (parsed.parentTaskId) {
                const parent = await requireParentTask(em, parsed.parentTaskId, scope, translate)
                const rejection = rejectTaskParent(parent, { timeProjectId: parsed.timeProjectId })
                if (rejection) throw parentRejectionError(translate, rejection)
                parentTaskId = parent.id
              }

              // US-C1: the creator owns the task unless the request says otherwise.
              const assigneeStaffMemberId = parsed.assigneeStaffMemberId
                ? await requireStaffMember(em, parsed.assigneeStaffMemberId, scope, translate)
                : await resolveStaffMemberIdForUser(em, createdByUserId, scope)

              plan = {
                project,
                status,
                parentTaskId,
                assigneeStaffMemberId,
                position:
                  parsed.position ?? (await nextTaskPosition(em, parsed.timeProjectId, status.id, scope)),
                highestSequenceNumber: await readHighestSequenceNumber(em, parsed.timeProjectId, scope),
              }
            },
            () => {
              if (!plan) throw notFoundError(translate)
              const now = new Date()
              const allocation = allocateTaskReference(plan.project.code, plan.highestSequenceNumber)
              created = em.create(StaffTimeTask, {
                tenantId: parsed.tenantId,
                organizationId: parsed.organizationId,
                timeProjectId: parsed.timeProjectId,
                parentTaskId: plan.parentTaskId,
                taskStatusId: plan.status.id,
                sequenceNumber: allocation.sequenceNumber,
                reference: allocation.reference,
                title: parsed.title,
                description: parsed.description ?? null,
                assigneeStaffMemberId: plan.assigneeStaffMemberId,
                position: plan.position,
                createdByUserId,
                closedAt: plan.status.isDone ? now : null,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
              })
              em.persist(created)
            },
          ],
          { transaction: true, label: staffTimeTaskCommandIds.create },
        )

        if (!created) throw notFoundError(translate)
        return created as StaffTimeTask
      })
    } catch (err) {
      // The retry budget ran out — the caller retries rather than getting a duplicate.
      if (isTaskReferenceConflict(err)) throw referenceConflictError(translate)
      throw err
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: record,
      identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
    })

    return { taskId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTaskSnapshot(em, result.taskId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTaskSnapshot(em, result.taskId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tasks.create', 'Create task'),
      resourceKind: 'staff.timesheets.task',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: { after: snapshot } satisfies TaskUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaskUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await em.findOne(StaffTimeTask, scopedStaffSnapshotWhere(after.id, staffSnapshotScopeFromSnapshot(after)))
    if (!task) return
    task.deletedAt = new Date()
    task.updatedAt = new Date()
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
    })
  },
}

const updateTaskCommand: CommandHandler<StaffTimeTaskUpdateInput, { taskId: string }> = {
  id: staffTimeTaskCommandIds.update,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeTaskUpdateSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadTaskSnapshot(em, parsed.data.id, staffSnapshotScopeFromContext(ctx))
    if (!before) return {}
    return { before: { snapshot: before } }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeTaskUpdateSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)

    const task = await em.findOne(
      StaffTimeTask,
      applyScopeToWhere<StaffTimeTask>({ id: parsed.id, deletedAt: null }, scope),
    )
    if (!task) throw notFoundError(translate)
    ensureTenantScope(ctx, task.tenantId)
    ensureOrganizationScope(ctx, task.organizationId)
    assertNoProjectMove(rawInput, task, translate)

    let targetStatus: StaffTimeTaskStatus | null = null
    let targetParentTaskId: string | null | undefined
    let targetAssigneeStaffMemberId: string | null | undefined

    await withAtomicFlush(
      em,
      [
        async () => {
          if (parsed.taskStatusId !== undefined) {
            targetStatus = await resolveTaskStatus(em, task.timeProjectId, parsed.taskStatusId, scope, translate)
          }

          if (parsed.parentTaskId !== undefined) {
            if (parsed.parentTaskId === null) {
              targetParentTaskId = null
            } else {
              const parent = await requireParentTask(em, parsed.parentTaskId, scope, translate)
              const childCount = await em.count(
                StaffTimeTask,
                applyScopeToWhere<StaffTimeTask>({ parentTaskId: task.id, deletedAt: null }, scope),
              )
              const rejection = rejectTaskParent(parent, {
                id: task.id,
                timeProjectId: task.timeProjectId,
                childCount,
              })
              if (rejection) throw parentRejectionError(translate, rejection)
              targetParentTaskId = parent.id
            }
          }

          if (parsed.assigneeStaffMemberId !== undefined) {
            targetAssigneeStaffMemberId = parsed.assigneeStaffMemberId
              ? await requireStaffMember(em, parsed.assigneeStaffMemberId, scope, translate)
              : null
          }
        },
        () => {
          const now = new Date()
          if (parsed.title !== undefined) task.title = parsed.title
          if (parsed.description !== undefined) task.description = parsed.description ?? null
          if (parsed.position !== undefined) task.position = parsed.position
          if (targetParentTaskId !== undefined) task.parentTaskId = targetParentTaskId
          if (targetAssigneeStaffMemberId !== undefined) task.assigneeStaffMemberId = targetAssigneeStaffMemberId
          if (targetStatus) applyStatusToTask(task, targetStatus, now)
          task.updatedAt = now
        },
      ],
      { transaction: true, label: staffTimeTaskCommandIds.update },
    )

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
    })

    return { taskId: task.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = (snapshots.before as { snapshot?: TaskSnapshot } | undefined)?.snapshot
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadTaskSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tasks.update', 'Update task'),
      resourceKind: 'staff.timesheets.task',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        [...DIFFED_FIELDS],
      ),
      payload: {
        undo: { before, after } satisfies TaskUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaskUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await em.findOne(
      StaffTimeTask,
      scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)),
    )
    if (!task) return

    task.parentTaskId = before.parentTaskId
    task.taskStatusId = before.taskStatusId
    task.title = before.title
    task.description = before.description
    task.assigneeStaffMemberId = before.assigneeStaffMemberId
    task.position = before.position
    task.closedAt = before.closedAt ? new Date(before.closedAt) : null
    task.updatedAt = new Date()
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
    })
  },
}

const deleteTaskCommand: CommandHandler<{ id?: string }, { taskId: string; childIds: string[] }> = {
  id: staffTimeTaskCommandIds.delete,
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const scope = staffSnapshotScopeFromContext(ctx)
    const before = await loadTaskSnapshot(em, id, scope)
    if (!before) return {}
    const cascadedChildren = before.parentTaskId ? [] : await loadChildSnapshots(em, before.id, scope)
    return { before: { snapshot: before, cascadedChildren } }
  },
  async execute(input, ctx) {
    const { translate } = await resolveTranslations()
    const id = input?.id
    if (!id) {
      throw new CrudHttpError(400, {
        error: translate('staff.time_tracking.tasks.errors.idRequired', 'Task id is required.'),
      })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const task = await em.findOne(
      StaffTimeTask,
      applyScopeToWhere<StaffTimeTask>({ id, deletedAt: null }, scope),
    )
    if (!task) throw notFoundError(translate)
    ensureTenantScope(ctx, task.tenantId)
    ensureOrganizationScope(ctx, task.organizationId)

    let children: StaffTimeTask[] = []
    let childIds: string[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          // Only a top-level task can carry a cascade; the depth rule guarantees a
          // child has none, so the walk is exactly one level.
          children = task.parentTaskId
            ? []
            : await em.find(
                StaffTimeTask,
                applyScopeToWhere<StaffTimeTask>({ parentTaskId: task.id, deletedAt: null }, scope),
              )
        },
        () => {
          const plan = planTaskSoftDelete(task, children)
          childIds = plan.childIds
          const now = new Date()
          const byId = new Map(children.map((child) => [child.id, child]))
          task.deletedAt = now
          task.updatedAt = now
          for (const childId of childIds) {
            const child = byId.get(childId)
            if (!child) continue
            child.deletedAt = now
            child.updatedAt = now
          }
          // Time entries are untouched on purpose: a closed report still has to
          // resolve this task's label months after it was removed from the board.
        },
      ],
      { transaction: true, label: staffTimeTaskCommandIds.delete },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    for (const removed of [task, ...children.filter((child) => childIds.includes(child.id))]) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'deleted',
        entity: removed,
        identifiers: { id: removed.id, organizationId: removed.organizationId, tenantId: removed.tenantId },
        events: taskCrudEvents,
        indexer: taskCrudIndexer,
      })
    }

    return { taskId: task.id, childIds }
  },
  buildLog: async ({ snapshots }) => {
    const prepared = snapshots.before as
      | { snapshot?: TaskSnapshot; cascadedChildren?: TaskSnapshot[] }
      | undefined
    const before = prepared?.snapshot
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tasks.delete', 'Delete task'),
      resourceKind: 'staff.timesheets.task',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
          cascadedChildren: prepared?.cascadedChildren ?? null,
        } satisfies TaskUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaskUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const snapshotScope = staffSnapshotScopeFromSnapshot(before)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const ids = [before.id, ...(payload?.cascadedChildren ?? []).map((child) => child.id)]
    const restored: StaffTimeTask[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          const tasks = await em.find(StaffTimeTask, {
            id: { $in: ids },
            ...snapshotScopeWhere(snapshotScope),
          })
          restored.push(...tasks)
        },
        () => {
          // Undo restores the whole set the cascade removed, not just the parent.
          for (const task of restored) {
            task.deletedAt = null
            task.updatedAt = new Date()
          }
        },
      ],
      { transaction: true, label: `${staffTimeTaskCommandIds.delete}.undo` },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    for (const task of restored) {
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'created',
        entity: task,
        identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
        events: taskCrudEvents,
        indexer: taskCrudIndexer,
      })
    }
  },
}

/**
 * US-C2: the board drag, and the drawer's subtask tick, which is the same move
 * expressed without a position.
 *
 * It is a command of its own rather than a flavour of `update` for three reasons:
 * the move is the one write on this entity where two people racing the same record
 * is genuinely likely, so it enforces the `updated_at` version and answers 409 on a
 * stale one; the board needs a lifecycle event carrying enough to relocate the card
 * on another client without a refetch; and the column change is the whole payload,
 * so the audit row reads "Move task" instead of a generic update.
 *
 * `closedAt` is NOT re-derived here — `applyStatusToTask` above is the single place
 * that reads the column's `is_done`, shared verbatim with `update`.
 */
const statusChangeInputSchema = staffTimeTaskStatusChangeSchema.extend({
  id: z.string().uuid(),
})

export type StaffTimeTaskStatusChangeCommandInput = z.infer<typeof statusChangeInputSchema>

export type StaffTimeTaskStatusChangeResult = {
  taskId: string
  timeProjectId: string
  previousTaskStatusId: string
  taskStatusId: string
  position: number
  closedAt: string | null
  updatedAt: string | null
}

const STATUS_CHANGE_DIFFED_FIELDS = ['taskStatusId', 'position', 'closedAt'] as const

const statusChangeTaskCommand: CommandHandler<
  StaffTimeTaskStatusChangeCommandInput,
  StaffTimeTaskStatusChangeResult
> = {
  id: staffTimeTaskCommandIds.statusChange,
  async prepare(rawInput, ctx) {
    const parsed = statusChangeInputSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadTaskSnapshot(em, parsed.data.id, staffSnapshotScopeFromContext(ctx))
    if (!before) return {}
    return { before: { snapshot: before } }
  },
  async execute(rawInput, ctx) {
    const parsed = statusChangeInputSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)

    const task = await em.findOne(
      StaffTimeTask,
      applyScopeToWhere<StaffTimeTask>({ id: parsed.id, deletedAt: null }, scope),
    )
    if (!task) throw notFoundError(translate)
    ensureTenantScope(ctx, task.tenantId)
    ensureOrganizationScope(ctx, task.organizationId)

    // Two people dragging the same card is the realistic conflict on this board,
    // so a stale version loses here and the client rolls the card back to the
    // column it came from.
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: STAFF_TIME_TASK_RESOURCE_KIND,
      resourceId: task.id,
      current: task.updatedAt,
      request: ctx.request,
    })

    const previousTaskStatusId = task.taskStatusId
    let targetStatus: StaffTimeTaskStatus | null = null
    let targetPosition = task.position

    await withAtomicFlush(
      em,
      [
        async () => {
          // Refuses a column belonging to another project: `resolveTaskStatus`
          // looks the status up inside this task's project, so a foreign id is a
          // 422 rather than a silent cross-board move.
          targetStatus = await resolveTaskStatus(em, task.timeProjectId, parsed.taskStatusId, scope, translate)
          targetPosition =
            parsed.position ?? (await nextTaskPosition(em, task.timeProjectId, targetStatus.id, scope))
        },
        () => {
          if (!targetStatus) throw notFoundError(translate)
          const now = new Date()
          task.position = targetPosition
          applyStatusToTask(task, targetStatus, now)
          task.updatedAt = now
        },
      ],
      { transaction: true, label: staffTimeTaskCommandIds.statusChange },
    )

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
    })

    const result: StaffTimeTaskStatusChangeResult = {
      taskId: task.id,
      timeProjectId: task.timeProjectId,
      previousTaskStatusId,
      taskStatusId: task.taskStatusId,
      position: task.position,
      closedAt: task.closedAt ? task.closedAt.toISOString() : null,
      updatedAt: task.updatedAt ? task.updatedAt.toISOString() : null,
    }

    // `clientBroadcast: true` (events.ts) puts this on the DOM Event Bridge, so the
    // payload carries everything a second board needs to move the card itself —
    // origin column, destination column and the new slot — without a refetch. The
    // scope fields are what the SSE stream filters its audience on. A failed
    // broadcast must never fail a committed drag.
    void emitStaffEvent('staff.timesheets.time_task.status_changed', {
      id: task.id,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
      ...result,
    }).catch((err) => {
      logger.error('staff.timesheets emit time_task.status_changed failed', { err })
    })

    return result
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = (snapshots.before as { snapshot?: TaskSnapshot } | undefined)?.snapshot
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadTaskSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.tasks.statusChange', 'Move task'),
      resourceKind: 'staff.timesheets.task',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        [...STATUS_CHANGE_DIFFED_FIELDS],
      ),
      payload: {
        undo: { before, after } satisfies TaskUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaskUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await em.findOne(
      StaffTimeTask,
      scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)),
    )
    if (!task) return

    const previousTaskStatusId = task.taskStatusId
    task.taskStatusId = before.taskStatusId
    task.position = before.position
    task.closedAt = before.closedAt ? new Date(before.closedAt) : null
    task.updatedAt = new Date()
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
    })

    void emitStaffEvent('staff.timesheets.time_task.status_changed', {
      id: task.id,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
      taskId: task.id,
      timeProjectId: task.timeProjectId,
      previousTaskStatusId,
      taskStatusId: task.taskStatusId,
      position: task.position,
      closedAt: task.closedAt ? task.closedAt.toISOString() : null,
      updatedAt: task.updatedAt ? task.updatedAt.toISOString() : null,
    }).catch((err) => {
      logger.error('staff.timesheets emit time_task.status_changed failed', { err })
    })
  },
}

registerCommand(createTaskCommand)
registerCommand(updateTaskCommand)
registerCommand(deleteTaskCommand)
registerCommand(statusChangeTaskCommand)
