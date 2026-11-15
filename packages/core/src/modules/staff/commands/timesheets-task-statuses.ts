/**
 * Kanban column commands for the per-project boards of screen 6 (D-1).
 *
 * Columns are project configuration rather than task data, which is why every
 * write here is guarded by `staff.timesheets.projects.manage` at the route while
 * the board itself only needs `…tasks.view` to read them.
 *
 * The board carries three invariants no caller is trusted with:
 *
 *  1. A project always has at least one column. Deleting the last one is refused
 *     — a project with an empty board cannot accept a task and no screen exists
 *     that would put a column back.
 *  2. Exactly one column is `is_default` and at least one is `is_done`. New tasks
 *     land on the default; the drawer's subtask tick sends the first done column.
 *     Both are repaired here, never taken on faith from the request.
 *  3. A column that still holds tasks is not deleted. The refusal names the count
 *     and stops there: it does NOT accept a move-target and does NOT relocate the
 *     cards itself, because moving them belongs to the task status endpoint that
 *     owns the task's `closed_at`, its index document and its status_changed
 *     event. Emptying the column first is the caller's job.
 */

import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { StaffTimeProject, StaffTimeTask, StaffTimeTaskStatus } from '../data/entities'
import {
  staffTimeTaskStatusCreateSchema,
  staffTimeTaskStatusUpdateSchema,
  staffTimeTaskStatusReorderSchema,
  type StaffTimeTaskStatusCreateInput,
  type StaffTimeTaskStatusUpdateInput,
} from '../data/validators'
import { deriveTaskStatusSlug } from '../lib/timesheets-tasks/statusSlug'
import { nextStatusPosition, planStatusReorder } from '../lib/timesheets-tasks/statusPositions'
import {
  applyScopeToWhere,
  commandActorScope,
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  scopedStaffSnapshotWhere,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffCommandScope,
  type StaffSnapshotScope,
} from './shared'

const logger = createLogger('staff').child({ component: 'timesheets-task-statuses' })

export const staffTimeTaskStatusCommandIds = {
  create: 'staff.timesheets.task_statuses.create',
  update: 'staff.timesheets.task_statuses.update',
  delete: 'staff.timesheets.task_statuses.delete',
  reorder: 'staff.timesheets.task_statuses.reorder',
} as const

export const TASK_STATUS_LAST_COLUMN_CODE = 'task_status_last_column'
export const TASK_STATUS_HAS_TASKS_CODE = 'task_status_has_tasks'
export const TASK_STATUS_DEFAULT_REQUIRED_CODE = 'task_status_default_required'
export const TASK_STATUS_DONE_REQUIRED_CODE = 'task_status_done_required'
export const TASK_STATUS_SLUG_DUPLICATE_CODE = 'task_status_slug_duplicate'
export const TASK_STATUS_UNKNOWN_IDS_CODE = 'task_status_unknown_ids'

const taskStatusCrudIndexer: CrudIndexerConfig<StaffTimeTaskStatus> = {
  entityType: 'staff:staff_time_task_status',
}

// The board declares no CRUD event ids of its own in `events.ts`: a column write is
// a configuration change the board re-reads, so these commands queue index and
// cache side effects only. Task movement keeps its own `time_task.status_changed`.

type Translate = (key: string, fallback: string) => string

type TaskStatusSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  name: string
  slug: string
  color: string | null
  position: number
  isDefault: boolean
  isDone: boolean
  deletedAt: string | null
}

/**
 * The sibling columns' ordering flags as they stood before the write. Every one of
 * these commands can move a neighbour — promoting a new default, re-spacing the
 * board after a compaction, handing `is_done` to a survivor — so undo has to be
 * able to put the whole board back, not just the row that was addressed.
 */
type TaskStatusBoardRow = {
  id: string
  position: number
  isDefault: boolean
  isDone: boolean
}

type TaskStatusUndoPayload = {
  before?: TaskStatusSnapshot | null
  after?: TaskStatusSnapshot | null
  boardBefore?: TaskStatusBoardRow[] | null
}

function toSnapshot(status: StaffTimeTaskStatus): TaskStatusSnapshot {
  return {
    id: status.id,
    tenantId: status.tenantId,
    organizationId: status.organizationId,
    timeProjectId: status.timeProjectId,
    name: status.name,
    slug: status.slug,
    color: status.color ?? null,
    position: status.position,
    isDefault: status.isDefault,
    isDone: status.isDone,
    deletedAt: status.deletedAt ? status.deletedAt.toISOString() : null,
  }
}

function toBoardRow(status: StaffTimeTaskStatus): TaskStatusBoardRow {
  return {
    id: status.id,
    position: status.position,
    isDefault: status.isDefault,
    isDone: status.isDone,
  }
}

async function loadTaskStatusSnapshot(
  em: EntityManager,
  id: string,
  scope?: StaffSnapshotScope | null,
): Promise<TaskStatusSnapshot | null> {
  const status = await em.findOne(StaffTimeTaskStatus, scopedStaffSnapshotWhere(id, scope))
  return status ? toSnapshot(status) : null
}

function boardWhere(timeProjectId: string, scope: StaffCommandScope) {
  return applyScopeToWhere<StaffTimeTaskStatus>({ timeProjectId, deletedAt: null }, scope)
}

async function loadBoard(
  em: EntityManager,
  timeProjectId: string,
  scope: StaffCommandScope,
): Promise<StaffTimeTaskStatus[]> {
  const statuses = await em.find(StaffTimeTaskStatus, boardWhere(timeProjectId, scope))
  return statuses.sort((left, right) => left.position - right.position || (left.id < right.id ? -1 : 1))
}

async function loadBoardSnapshot(
  em: EntityManager,
  timeProjectId: string,
  scope?: StaffSnapshotScope | null,
): Promise<TaskStatusBoardRow[]> {
  const statuses = await em.find(StaffTimeTaskStatus, {
    timeProjectId,
    deletedAt: null,
    ...snapshotScopeWhere(scope),
  })
  return statuses.map(toBoardRow)
}

function snapshotScopeWhere(scope?: StaffSnapshotScope | null): { tenantId?: string; organizationId?: string } {
  const where: { tenantId?: string; organizationId?: string } = {}
  if (scope?.tenantId) where.tenantId = scope.tenantId
  if (scope?.organizationId) where.organizationId = scope.organizationId
  return where
}

function slugDuplicateError(translate: Translate, slug: string): CrudHttpError {
  const message = translate(
    'staff.time_tracking.taskStatuses.errors.slugDuplicate',
    'A column with this slug already exists on this project.',
  )
  return new CrudHttpError(409, {
    code: TASK_STATUS_SLUG_DUPLICATE_CODE,
    error: message,
    slug,
    fieldErrors: { slug: message },
  })
}

function notFoundError(translate: Translate): CrudHttpError {
  return new CrudHttpError(404, {
    error: translate(
      'staff.time_tracking.taskStatuses.errors.notFound',
      'Task status not found or not accessible.',
    ),
  })
}

function projectNotFoundError(translate: Translate): CrudHttpError {
  const message = translate('staff.timesheets.errors.projectNotFound', 'Time project not found or not accessible.')
  return new CrudHttpError(422, {
    error: message,
    fieldErrors: { timeProjectId: message },
  })
}

/**
 * Applies invariant 2 to a board that is about to be written: the caller's wish is
 * honoured where it can be, and repaired where it cannot. A board can never end up
 * with two defaults or with nothing terminal.
 */
function normalizeBoardFlags(board: StaffTimeTaskStatus[], preferredDefaultId: string | null): void {
  if (board.length === 0) return
  const defaults = board.filter((status) => status.isDefault)
  const preferred = preferredDefaultId ? board.find((status) => status.id === preferredDefaultId) ?? null : null
  const winner = preferred ?? defaults[0] ?? board[0]
  for (const status of board) status.isDefault = status.id === winner.id
  if (!board.some((status) => status.isDone)) {
    board[board.length - 1].isDone = true
  }
}

async function requireProject(
  em: EntityManager,
  timeProjectId: string,
  scope: StaffCommandScope,
  translate: Translate,
): Promise<void> {
  const project = await em.findOne(
    StaffTimeProject,
    applyScopeToWhere<StaffTimeProject>({ id: timeProjectId, deletedAt: null }, scope),
    { fields: ['id'] },
  )
  if (!project) throw projectNotFoundError(translate)
}

async function restoreBoard(
  em: EntityManager,
  boardBefore: TaskStatusBoardRow[] | null | undefined,
  scope: StaffSnapshotScope | null,
): Promise<StaffTimeTaskStatus[]> {
  if (!boardBefore || boardBefore.length === 0) return []
  const ids = boardBefore.map((row) => row.id)
  const statuses = await em.find(StaffTimeTaskStatus, {
    id: { $in: ids },
    ...snapshotScopeWhere(scope),
  })
  const byId = new Map(statuses.map((status) => [status.id, status]))
  const restored: StaffTimeTaskStatus[] = []
  for (const row of boardBefore) {
    const status = byId.get(row.id)
    if (!status) continue
    status.position = row.position
    status.isDefault = row.isDefault
    status.isDone = row.isDone
    status.updatedAt = new Date()
    restored.push(status)
  }
  return restored
}

const createTaskStatusCommand: CommandHandler<StaffTimeTaskStatusCreateInput, { taskStatusId: string }> = {
  id: staffTimeTaskStatusCommandIds.create,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeTaskStatusCreateSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const boardBefore = await loadBoardSnapshot(em, parsed.data.timeProjectId, staffSnapshotScopeFromContext(ctx))
    return { before: { boardBefore } }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeTaskStatusCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)
    const { translate } = await resolveTranslations()

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let board: StaffTimeTaskStatus[] = []
    let created: StaffTimeTaskStatus | null = null

    try {
      // The board is read inside the transaction that writes the new column, so a
      // concurrent create cannot slip a second default past the repair below.
      await withAtomicFlush(
        em,
        [
          async () => {
            await requireProject(em, parsed.timeProjectId, scope, translate)
            board = await loadBoard(em, parsed.timeProjectId, scope)
          },
          () => {
            const takenSlugs = board.map((status) => status.slug.toLowerCase())
            const slug = parsed.slug ? parsed.slug.toLowerCase() : deriveTaskStatusSlug(parsed.name, takenSlugs)
            if (takenSlugs.includes(slug)) throw slugDuplicateError(translate, slug)

            const isFirstColumn = board.length === 0
            created = em.create(StaffTimeTaskStatus, {
              tenantId: parsed.tenantId,
              organizationId: parsed.organizationId,
              timeProjectId: parsed.timeProjectId,
              name: parsed.name,
              slug,
              color: parsed.color ?? null,
              position: parsed.position ?? nextStatusPosition(board.map((status) => status.position)),
              // The first column of a board is necessarily both the landing column
              // and the terminal one, whatever the request asked for.
              isDefault: isFirstColumn ? true : parsed.isDefault ?? false,
              isDone: isFirstColumn ? true : parsed.isDone ?? false,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            })
            em.persist(created)
            normalizeBoardFlags([...board, created], created.isDefault ? created.id : null)
          },
        ],
        { transaction: true, label: staffTimeTaskStatusCommandIds.create },
      )
    } catch (err) {
      if (isUniqueViolation(err)) throw slugDuplicateError(translate, parsed.slug ?? parsed.name)
      throw err
    }

    const record = created as StaffTimeTaskStatus | null
    if (!record) throw notFoundError(translate)

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: record,
      identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      indexer: taskStatusCrudIndexer,
    })

    return { taskStatusId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTaskStatusSnapshot(em, result.taskStatusId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, snapshots, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTaskStatusSnapshot(em, result.taskStatusId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    const boardBefore = (snapshots.before as { boardBefore?: TaskStatusBoardRow[] } | undefined)?.boardBefore ?? null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.task_statuses.create', 'Create task status'),
      resourceKind: 'staff.timesheets.task_status',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
          boardBefore,
        } satisfies TaskStatusUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaskStatusUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const snapshotScope = staffSnapshotScopeFromSnapshot(after)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const status = await em.findOne(StaffTimeTaskStatus, scopedStaffSnapshotWhere(after.id, snapshotScope))
    if (!status) return

    await withAtomicFlush(
      em,
      [
        () => {
          status.deletedAt = new Date()
          status.updatedAt = new Date()
        },
        // The board is re-read here, so it has to be its own phase.
        () => restoreBoard(em, payload?.boardBefore, snapshotScope),
      ],
      { transaction: true, label: `${staffTimeTaskStatusCommandIds.create}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: status,
      identifiers: { id: status.id, organizationId: status.organizationId, tenantId: status.tenantId },
      indexer: taskStatusCrudIndexer,
    })
  },
}

const updateTaskStatusCommand: CommandHandler<StaffTimeTaskStatusUpdateInput, { taskStatusId: string }> = {
  id: staffTimeTaskStatusCommandIds.update,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeTaskStatusUpdateSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const scope = staffSnapshotScopeFromContext(ctx)
    const before = await loadTaskStatusSnapshot(em, parsed.data.id, scope)
    if (!before) return {}
    const boardBefore = await loadBoardSnapshot(em, before.timeProjectId, scope)
    return { before: { snapshot: before, boardBefore } }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeTaskStatusUpdateSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)

    const status = await em.findOne(
      StaffTimeTaskStatus,
      applyScopeToWhere<StaffTimeTaskStatus>({ id: parsed.id, deletedAt: null }, scope),
    )
    if (!status) throw notFoundError(translate)
    ensureTenantScope(ctx, status.tenantId)
    ensureOrganizationScope(ctx, status.organizationId)

    let board: StaffTimeTaskStatus[] = []

    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            board = await loadBoard(em, status.timeProjectId, scope)
          },
          () => {
            if (parsed.name !== undefined) status.name = parsed.name
            if (parsed.color !== undefined) status.color = parsed.color ?? null

            if (parsed.isDefault === false && status.isDefault) {
              // Unsetting the only default would leave new tasks with nowhere to
              // land; promoting another column is the caller's move to make.
              throw new CrudHttpError(409, {
                code: TASK_STATUS_DEFAULT_REQUIRED_CODE,
                error: translate(
                  'staff.time_tracking.taskStatuses.errors.defaultRequired',
                  'A project needs one default column. Mark another column as the default instead.',
                ),
              })
            }
            if (parsed.isDone === false && status.isDone && board.filter((row) => row.isDone).length <= 1) {
              throw new CrudHttpError(409, {
                code: TASK_STATUS_DONE_REQUIRED_CODE,
                error: translate(
                  'staff.time_tracking.taskStatuses.errors.doneRequired',
                  'A project needs at least one done column. Mark another column as done first.',
                ),
              })
            }
            if (parsed.isDone !== undefined) status.isDone = parsed.isDone
            if (parsed.isDefault === true) status.isDefault = true

            if (parsed.position !== undefined) {
              // A single-column drag is expressed as a one-row reorder, so the rare
              // "no integer fits here" drop compacts the board instead of writing a
              // position that collides with its neighbour.
              const plan = planStatusReorder(
                board.map((row) => ({ id: row.id, position: row.position })),
                [{ id: status.id, position: parsed.position }],
              )
              const byId = new Map(board.map((row) => [row.id, row]))
              for (const update of plan.updates) {
                const target = byId.get(update.id)
                if (!target) continue
                target.position = update.position
                target.updatedAt = new Date()
              }
              if (plan.compacted) {
                logger.debug('Compacted task status board', {
                  timeProjectId: status.timeProjectId,
                  updates: plan.updates.length,
                })
              }
            }

            normalizeBoardFlags(board, parsed.isDefault === true ? status.id : null)
            status.updatedAt = new Date()
          },
        ],
        { transaction: true, label: staffTimeTaskStatusCommandIds.update },
      )
    } catch (err) {
      if (isUniqueViolation(err)) throw slugDuplicateError(translate, status.slug)
      throw err
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: status,
      identifiers: { id: status.id, organizationId: status.organizationId, tenantId: status.tenantId },
      indexer: taskStatusCrudIndexer,
    })

    return { taskStatusId: status.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const prepared = snapshots.before as
      | { snapshot?: TaskStatusSnapshot; boardBefore?: TaskStatusBoardRow[] }
      | undefined
    const before = prepared?.snapshot
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadTaskStatusSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const changes = buildChanges(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      ['name', 'color', 'position', 'isDefault', 'isDone'],
    )
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.task_statuses.update', 'Update task status'),
      resourceKind: 'staff.timesheets.task_status',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: {
          before,
          after,
          boardBefore: prepared?.boardBefore ?? null,
        } satisfies TaskStatusUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaskStatusUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const snapshotScope = staffSnapshotScopeFromSnapshot(before)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const status = await em.findOne(StaffTimeTaskStatus, scopedStaffSnapshotWhere(before.id, snapshotScope))
    if (!status) return

    await withAtomicFlush(
      em,
      [
        () => {
          status.name = before.name
          status.color = before.color ?? null
          status.updatedAt = new Date()
        },
        // Positions and flags belong to the whole board, and restoring them
        // re-reads the sibling rows.
        () => restoreBoard(em, payload?.boardBefore, snapshotScope),
      ],
      { transaction: true, label: `${staffTimeTaskStatusCommandIds.update}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: status,
      identifiers: { id: status.id, organizationId: status.organizationId, tenantId: status.tenantId },
      indexer: taskStatusCrudIndexer,
    })
  },
}

const deleteTaskStatusCommand: CommandHandler<{ id?: string }, { taskStatusId: string }> = {
  id: staffTimeTaskStatusCommandIds.delete,
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const scope = staffSnapshotScopeFromContext(ctx)
    const before = await loadTaskStatusSnapshot(em, id, scope)
    if (!before) return {}
    const boardBefore = await loadBoardSnapshot(em, before.timeProjectId, scope)
    return { before: { snapshot: before, boardBefore } }
  },
  async execute(input, ctx) {
    const { translate } = await resolveTranslations()
    const id = input?.id
    if (!id) {
      throw new CrudHttpError(400, {
        error: translate('staff.time_tracking.taskStatuses.errors.idRequired', 'Task status id is required.'),
      })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const status = await em.findOne(
      StaffTimeTaskStatus,
      applyScopeToWhere<StaffTimeTaskStatus>({ id, deletedAt: null }, scope),
    )
    if (!status) throw notFoundError(translate)
    ensureTenantScope(ctx, status.tenantId)
    ensureOrganizationScope(ctx, status.organizationId)

    let survivors: StaffTimeTaskStatus[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          const board = await loadBoard(em, status.timeProjectId, scope)
          survivors = board.filter((row) => row.id !== status.id)
          if (survivors.length === 0) {
            throw new CrudHttpError(409, {
              code: TASK_STATUS_LAST_COLUMN_CODE,
              error: translate(
                'staff.time_tracking.taskStatuses.errors.lastColumn',
                'A project needs at least one column. Add another column before removing this one.',
              ),
            })
          }
          const taskCount = await em.count(
            StaffTimeTask,
            applyScopeToWhere<StaffTimeTask>({ taskStatusId: status.id, deletedAt: null }, scope),
          )
          if (taskCount > 0) {
            throw new CrudHttpError(409, {
              code: TASK_STATUS_HAS_TASKS_CODE,
              error: translate(
                'staff.time_tracking.taskStatuses.errors.hasTasks',
                'This column still holds tasks. Move them to another column before removing it.',
              ),
              taskCount,
            })
          }
        },
        () => {
          status.deletedAt = new Date()
          status.updatedAt = new Date()
          // Removing the landing or the terminal column hands the role to a
          // survivor rather than refusing the delete — an empty column should
          // always be removable.
          normalizeBoardFlags(survivors, null)
        },
      ],
      { transaction: true, label: staffTimeTaskStatusCommandIds.delete },
    )

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: status,
      identifiers: { id: status.id, organizationId: status.organizationId, tenantId: status.tenantId },
      indexer: taskStatusCrudIndexer,
    })

    return { taskStatusId: status.id }
  },
  buildLog: async ({ snapshots }) => {
    const prepared = snapshots.before as
      | { snapshot?: TaskStatusSnapshot; boardBefore?: TaskStatusBoardRow[] }
      | undefined
    const before = prepared?.snapshot
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.task_statuses.delete', 'Delete task status'),
      resourceKind: 'staff.timesheets.task_status',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
          boardBefore: prepared?.boardBefore ?? null,
        } satisfies TaskStatusUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaskStatusUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const snapshotScope = staffSnapshotScopeFromSnapshot(before)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let status = await em.findOne(StaffTimeTaskStatus, scopedStaffSnapshotWhere(before.id, snapshotScope))

    await withAtomicFlush(
      em,
      [
        () => {
          if (!status) {
            status = em.create(StaffTimeTaskStatus, {
              id: before.id,
              tenantId: before.tenantId,
              organizationId: before.organizationId,
              timeProjectId: before.timeProjectId,
              name: before.name,
              slug: before.slug,
              color: before.color ?? null,
              position: before.position,
              isDefault: before.isDefault,
              isDone: before.isDone,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            })
            em.persist(status)
            return
          }
          status.name = before.name
          status.slug = before.slug
          status.color = before.color ?? null
          status.position = before.position
          status.isDefault = before.isDefault
          status.isDone = before.isDone
          status.deletedAt = null
          status.updatedAt = new Date()
        },
        () => restoreBoard(em, payload?.boardBefore, snapshotScope),
      ],
      { transaction: true, label: `${staffTimeTaskStatusCommandIds.delete}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: status,
      identifiers: {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
      },
      indexer: taskStatusCrudIndexer,
    })
  },
}

/**
 * Batch reorder for a whole-board drag. The single-column case travels through
 * `update` (the PUT the spec's contract table describes); this one exists for the
 * board that restates several columns at once and for the compaction that follows
 * a drop with no room left between neighbours.
 */
const reorderTaskStatusCommandSchema = staffTimeTaskStatusReorderSchema.extend({
  timeProjectId: z.string().uuid(),
})

export type StaffTimeTaskStatusReorderCommandInput = z.infer<typeof reorderTaskStatusCommandSchema>

const reorderTaskStatusesCommand: CommandHandler<
  StaffTimeTaskStatusReorderCommandInput,
  { timeProjectId: string; updatedIds: string[]; compacted: boolean }
> = {
  id: staffTimeTaskStatusCommandIds.reorder,
  async prepare(rawInput, ctx) {
    const parsed = reorderTaskStatusCommandSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const boardBefore = await loadBoardSnapshot(em, parsed.data.timeProjectId, staffSnapshotScopeFromContext(ctx))
    return { before: { timeProjectId: parsed.data.timeProjectId, boardBefore } }
  },
  async execute(rawInput, ctx) {
    const parsed = reorderTaskStatusCommandSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)

    let board: StaffTimeTaskStatus[] = []
    let updatedIds: string[] = []
    let compacted = false

    await withAtomicFlush(
      em,
      [
        async () => {
          await requireProject(em, parsed.timeProjectId, scope, translate)
          board = await loadBoard(em, parsed.timeProjectId, scope)
        },
        () => {
          const plan = planStatusReorder(
            board.map((row) => ({ id: row.id, position: row.position })),
            parsed.statuses,
          )
          if (plan.unknownIds.length > 0) {
            // Ids from another project (or already deleted) must never be written
            // through this project's reorder.
            throw new CrudHttpError(422, {
              code: TASK_STATUS_UNKNOWN_IDS_CODE,
              error: translate(
                'staff.time_tracking.taskStatuses.errors.unknownIds',
                'Some columns do not belong to this project.',
              ),
              unknownIds: plan.unknownIds,
            })
          }
          const byId = new Map(board.map((row) => [row.id, row]))
          for (const update of plan.updates) {
            const target = byId.get(update.id)
            if (!target) continue
            target.position = update.position
            target.updatedAt = new Date()
          }
          updatedIds = plan.updates.map((update) => update.id)
          compacted = plan.compacted
        },
      ],
      { transaction: true, label: staffTimeTaskStatusCommandIds.reorder },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    for (const status of board) {
      if (!updatedIds.includes(status.id)) continue
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: status,
        identifiers: { id: status.id, organizationId: status.organizationId, tenantId: status.tenantId },
        indexer: taskStatusCrudIndexer,
      })
    }

    return { timeProjectId: parsed.timeProjectId, updatedIds, compacted }
  },
  buildLog: async ({ result, snapshots, ctx }) => {
    const prepared = snapshots.before as
      | { timeProjectId?: string; boardBefore?: TaskStatusBoardRow[] }
      | undefined
    const boardBefore = prepared?.boardBefore ?? null
    if (!boardBefore || boardBefore.length === 0) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = staffSnapshotScopeFromContext(ctx)
    const boardAfter = await loadBoardSnapshot(em, result.timeProjectId, scope)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.task_statuses.reorder', 'Reorder task statuses'),
      resourceKind: 'staff.timesheets.task_status',
      resourceId: result.timeProjectId,
      tenantId: scope?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      snapshotBefore: { statuses: boardBefore },
      snapshotAfter: { statuses: boardAfter },
      payload: {
        undo: {
          boardBefore,
        } satisfies TaskStatusUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaskStatusUndoPayload>(logEntry)
    const boardBefore = payload?.boardBefore
    if (!boardBefore || boardBefore.length === 0) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshotScope = staffSnapshotScopeFromContext(ctx)
    let restored: StaffTimeTaskStatus[] = []
    await withAtomicFlush(
      em,
      [
        async () => {
          restored = await restoreBoard(em, boardBefore, snapshotScope)
        },
      ],
      {
        transaction: true,
        label: `${staffTimeTaskStatusCommandIds.reorder}.undo`,
      },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    for (const status of restored) {
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'updated',
        entity: status,
        identifiers: { id: status.id, organizationId: status.organizationId, tenantId: status.tenantId },
        indexer: taskStatusCrudIndexer,
      })
    }
  },
}

registerCommand(createTaskStatusCommand)
registerCommand(updateTaskStatusCommand)
registerCommand(deleteTaskStatusCommand)
registerCommand(reorderTaskStatusesCommand)
