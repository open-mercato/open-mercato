/**
 * Task comment commands (T3.4b) — the "Komentarze (2)" thread of screen 7.
 *
 * US-C4 asks for context that lives with the work rather than in chat, so a
 * comment is only useful if the two things rendered next to its body are true:
 * *who* wrote it and *when*. Three decisions follow from that:
 *
 *  1. **`author_user_id` is stamped from the authenticated caller and is never
 *     read from input.** `staffTimeTaskCommentCreateSchema` still declares the
 *     field (it is the shared scoped-create shape), but this command discards
 *     whatever arrives there. Attribution a client can set is not attribution —
 *     it is a free-text field with an authoritative-looking name. Deliberately
 *     stricter than the shared `normalizeAuthorUserId` helper, which lets a
 *     super-admin post on someone else's behalf: on a client-facing thread that
 *     escape hatch would turn the avatar into a claim rather than a fact.
 *  2. **Editing is the author's own comment only**, unless the caller holds
 *     `staff.timesheets.manage_all`. Deleting follows the same rule — a thread
 *     someone else can rewrite is not a record. The manager exemption exists
 *     because a client-facing thread sometimes has to have something removed,
 *     and the grant is checked through `authorizeFeatures` so a wildcard
 *     (`staff.*`, `staff.timesheets.*`) counts the way it does everywhere else.
 *  3. **Delete is soft.** The row keeps its body, its author and its timestamps,
 *     so the audit trail (and undo) survives a comment leaving the thread.
 *
 * The parent task's *project* access is NOT resolved here — it is the route's
 * job (see `api/timesheets/tasks/[id]/comments/route.ts`), because only the
 * route knows the task id the caller addressed. What this file does enforce is
 * that the task exists inside the caller's tenant and organization, so a direct
 * command invocation cannot write a comment onto a foreign row.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertOptimisticLock, readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { StaffTimeTask, StaffTimeTaskComment } from '../data/entities'
import { staffTimeTaskCommentCrudEvents } from '../lib/crud'
import {
  staffTimeTaskCommentCreateSchema,
  staffTimeTaskCommentUpdateSchema,
  type StaffTimeTaskCommentCreateInput,
  type StaffTimeTaskCommentUpdateInput,
} from '../data/validators'
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

export const staffTimeTaskCommentCommandIds = {
  create: 'staff.timesheets.task_comments.create',
  update: 'staff.timesheets.task_comments.update',
  delete: 'staff.timesheets.task_comments.delete',
} as const

/**
 * Resource kind used for the audit log, the mutation-guard registry and the
 * command-level optimistic lock, matching the `staff.timesheets.<entity>` shape
 * the other hand-written timesheets routes present so an `OM_OPTIMISTIC_LOCK`
 * allow-list can name it.
 */
export const STAFF_TIME_TASK_COMMENT_RESOURCE_KIND = 'staff.timesheets.task_comment'

export const TASK_COMMENT_NOT_AUTHOR_CODE = 'task_comment_not_author'

const MANAGE_ALL_FEATURE = 'staff.timesheets.manage_all'

const AUTHOR_UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const commentCrudIndexer: CrudIndexerConfig<StaffTimeTaskComment> = {
  entityType: 'staff:staff_time_task_comment',
}

/**
 * `staff.timesheets.time_task_comment.{created,updated,deleted}` from `events.ts`.
 *
 * The route is hand-written (it must answer 404 rather than an empty page for a
 * task the caller cannot see), so it takes no `events:` config the CRUD factory
 * could read — the command emits the lifecycle events itself. It uses the shared
 * export rather than a local copy so the ids the module publishes and the ids this
 * command emits cannot drift apart.
 */
const commentCrudEvents: CrudEventsConfig<StaffTimeTaskComment> = staffTimeTaskCommentCrudEvents

type Translate = (key: string, fallback: string) => string

type CommentSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  taskId: string
  body: string
  authorUserId: string | null
  createdAt: string | null
  deletedAt: string | null
}

type CommentUndoPayload = {
  before?: CommentSnapshot | null
  after?: CommentSnapshot | null
}

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

function toCommentSnapshot(comment: StaffTimeTaskComment): CommentSnapshot {
  return {
    id: comment.id,
    tenantId: comment.tenantId,
    organizationId: comment.organizationId,
    taskId: comment.taskId,
    body: comment.body,
    authorUserId: comment.authorUserId ?? null,
    createdAt: comment.createdAt ? comment.createdAt.toISOString() : null,
    deletedAt: comment.deletedAt ? comment.deletedAt.toISOString() : null,
  }
}

async function loadCommentSnapshot(
  em: EntityManager,
  id: string,
  scope?: StaffSnapshotScope | null,
): Promise<CommentSnapshot | null> {
  const comment = await em.findOne(StaffTimeTaskComment, scopedStaffSnapshotWhere(id, scope))
  return comment ? toCommentSnapshot(comment) : null
}

function commentNotFoundError(translate: Translate): CrudHttpError {
  return new CrudHttpError(404, {
    error: translate('staff.time_tracking.taskComments.errors.notFound', 'Comment not found or not accessible.'),
  })
}

function taskNotFoundError(translate: Translate): CrudHttpError {
  return new CrudHttpError(404, {
    error: translate('staff.time_tracking.tasks.errors.notFound', 'Task not found or not accessible.'),
  })
}

function notAuthorError(translate: Translate): CrudHttpError {
  return new CrudHttpError(403, {
    code: TASK_COMMENT_NOT_AUTHOR_CODE,
    error: translate(
      'staff.time_tracking.taskComments.errors.notAuthor',
      'You can only edit or delete your own comments.',
    ),
  })
}

/**
 * The comment's author is whoever the request authenticated as — never the
 * `authorUserId` the payload carried. An API key has no human behind it, so it
 * writes an unattributed comment rather than borrowing an identity.
 */
function stampAuthorUserId(ctx: CommandRuntimeContext): string | null {
  const auth = ctx.auth as { isApiKey?: boolean; sub?: string | null } | null | undefined
  if (!auth || auth.isApiKey === true) return null
  const sub = typeof auth.sub === 'string' ? auth.sub.trim() : ''
  if (!sub || !AUTHOR_UUID_REGEX.test(sub)) return null
  return sub
}

/**
 * Wildcard-aware `staff.timesheets.manage_all` check. Reads the grants from
 * `rbacService` rather than the token's feature array so a stale or trimmed
 * browser payload cannot widen the exemption, and fails closed when the grants
 * cannot be read — the caller then falls back to "author only", which is the
 * safe half of the rule.
 */
async function callerCanManageAll(ctx: CommandRuntimeContext): Promise<boolean> {
  if (ctx.auth?.isSuperAdmin === true || ctx.systemActor === true) return true
  const userId = ctx.auth?.sub ?? null
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!userId || !tenantId) return false
  let grantedFeatures: string[] = []
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacServiceLike | undefined
    if (rbac?.getGrantedFeatures) {
      grantedFeatures = (await rbac.getGrantedFeatures(userId, { tenantId, organizationId })) ?? []
    }
  } catch {
    return false
  }
  return authorizeFeatures([MANAGE_ALL_FEATURE], {
    grantedFeatures,
    scopeAllowed: Boolean(tenantId) && Boolean(organizationId),
  })
}

async function requireEditableComment(
  comment: StaffTimeTaskComment,
  ctx: CommandRuntimeContext,
  translate: Translate,
): Promise<void> {
  const actorId = stampAuthorUserId(ctx)
  if (actorId && comment.authorUserId === actorId) return
  if (await callerCanManageAll(ctx)) return
  throw notAuthorError(translate)
}

function assertCommentVersion(ctx: CommandRuntimeContext, comment: StaffTimeTaskComment): void {
  assertOptimisticLock({
    resourceKind: STAFF_TIME_TASK_COMMENT_RESOURCE_KIND,
    resourceId: comment.id,
    expected: readOptimisticLockExpected(ctx.request ?? null),
    current: comment.updatedAt,
  })
}

async function requireTaskInScope(
  em: EntityManager,
  taskId: string,
  scope: StaffCommandScope,
  translate: Translate,
): Promise<StaffTimeTask> {
  const task = await em.findOne(StaffTimeTask, applyScopeToWhere<StaffTimeTask>({ id: taskId, deletedAt: null }, scope))
  if (!task) throw taskNotFoundError(translate)
  return task
}

const createTaskCommentCommand: CommandHandler<
  StaffTimeTaskCommentCreateInput,
  { commentId: string; taskId: string; authorUserId: string | null }
> = {
  id: staffTimeTaskCommentCommandIds.create,
  async execute(rawInput, ctx) {
    const parsed = staffTimeTaskCommentCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)
    const { translate } = await resolveTranslations()
    // `parsed.authorUserId` is intentionally unread — see the file header.
    const authorUserId = stampAuthorUserId(ctx)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let created: StaffTimeTaskComment | null = null

    await withAtomicFlush(
      em,
      [
        () => requireTaskInScope(em, parsed.taskId, scope, translate),
        () => {
          created = em.create(StaffTimeTaskComment, {
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
            taskId: parsed.taskId,
            body: parsed.body,
            authorUserId,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          })
          em.persist(created)
        },
      ],
      { transaction: true, label: staffTimeTaskCommentCommandIds.create },
    )

    const record = created as StaffTimeTaskComment | null
    if (!record) throw commentNotFoundError(translate)

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: record,
      identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      events: commentCrudEvents,
      indexer: commentCrudIndexer,
    })

    return { commentId: record.id, taskId: record.taskId, authorUserId: record.authorUserId ?? null }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadCommentSnapshot(em, result.commentId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, snapshots }) => {
    const snapshot = (snapshots.after as { snapshot?: CommentSnapshot } | undefined)?.snapshot
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.task_comments.create', 'Create task comment'),
      resourceKind: STAFF_TIME_TASK_COMMENT_RESOURCE_KIND,
      resourceId: result.commentId,
      parentResourceKind: 'staff.timesheets.task',
      parentResourceId: snapshot.taskId,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: { after: snapshot } satisfies CommentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CommentUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const comment = await em.findOne(
      StaffTimeTaskComment,
      scopedStaffSnapshotWhere(after.id, staffSnapshotScopeFromSnapshot(after)),
    )
    if (!comment) return

    await withAtomicFlush(
      em,
      [
        () => {
          comment.deletedAt = new Date()
          comment.updatedAt = new Date()
        },
      ],
      { transaction: true, label: `${staffTimeTaskCommentCommandIds.create}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: comment,
      identifiers: { id: comment.id, organizationId: comment.organizationId, tenantId: comment.tenantId },
      events: commentCrudEvents,
      indexer: commentCrudIndexer,
    })
  },
}

const updateTaskCommentCommand: CommandHandler<
  StaffTimeTaskCommentUpdateInput,
  { commentId: string; taskId: string }
> = {
  id: staffTimeTaskCommentCommandIds.update,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeTaskCommentUpdateSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadCommentSnapshot(em, parsed.data.id, staffSnapshotScopeFromContext(ctx))
    if (!before) return {}
    return { before: { snapshot: before } }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeTaskCommentUpdateSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)

    const comment = await em.findOne(
      StaffTimeTaskComment,
      applyScopeToWhere<StaffTimeTaskComment>({ id: parsed.id, deletedAt: null }, scope),
    )
    if (!comment) throw commentNotFoundError(translate)
    ensureTenantScope(ctx, comment.tenantId)
    ensureOrganizationScope(ctx, comment.organizationId)
    assertCommentVersion(ctx, comment)
    await requireEditableComment(comment, ctx, translate)

    await withAtomicFlush(
      em,
      [
        () => {
          comment.body = parsed.body
          comment.updatedAt = new Date()
        },
      ],
      { transaction: true, label: staffTimeTaskCommentCommandIds.update },
    )

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: comment,
      identifiers: { id: comment.id, organizationId: comment.organizationId, tenantId: comment.tenantId },
      events: commentCrudEvents,
      indexer: commentCrudIndexer,
    })

    return { commentId: comment.id, taskId: comment.taskId }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = (snapshots.before as { snapshot?: CommentSnapshot } | undefined)?.snapshot
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadCommentSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.task_comments.update', 'Update task comment'),
      resourceKind: STAFF_TIME_TASK_COMMENT_RESOURCE_KIND,
      resourceId: before.id,
      parentResourceKind: 'staff.timesheets.task',
      parentResourceId: before.taskId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        ['body'],
      ),
      payload: {
        undo: { before, after } satisfies CommentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CommentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const comment = await em.findOne(
      StaffTimeTaskComment,
      scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)),
    )
    if (!comment) return

    await withAtomicFlush(
      em,
      [
        () => {
          comment.body = before.body
          comment.updatedAt = new Date()
        },
      ],
      { transaction: true, label: `${staffTimeTaskCommentCommandIds.update}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: comment,
      identifiers: { id: comment.id, organizationId: comment.organizationId, tenantId: comment.tenantId },
      events: commentCrudEvents,
      indexer: commentCrudIndexer,
    })
  },
}

const deleteTaskCommentCommand: CommandHandler<{ id?: string }, { commentId: string; taskId: string }> = {
  id: staffTimeTaskCommentCommandIds.delete,
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadCommentSnapshot(em, id, staffSnapshotScopeFromContext(ctx))
    if (!before) return {}
    return { before: { snapshot: before } }
  },
  async execute(input, ctx) {
    const { translate } = await resolveTranslations()
    const id = input?.id
    if (!id) {
      throw new CrudHttpError(400, {
        error: translate('staff.time_tracking.taskComments.errors.idRequired', 'Comment id is required.'),
      })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const comment = await em.findOne(
      StaffTimeTaskComment,
      applyScopeToWhere<StaffTimeTaskComment>({ id, deletedAt: null }, scope),
    )
    if (!comment) throw commentNotFoundError(translate)
    ensureTenantScope(ctx, comment.tenantId)
    ensureOrganizationScope(ctx, comment.organizationId)
    assertCommentVersion(ctx, comment)
    await requireEditableComment(comment, ctx, translate)

    // Soft delete: the body, the author and the timestamps stay on the row so
    // the audit trail — and undo — still has something to point at.
    await withAtomicFlush(
      em,
      [
        () => {
          comment.deletedAt = new Date()
          comment.updatedAt = new Date()
        },
      ],
      { transaction: true, label: staffTimeTaskCommentCommandIds.delete },
    )

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: comment,
      identifiers: { id: comment.id, organizationId: comment.organizationId, tenantId: comment.tenantId },
      events: commentCrudEvents,
      indexer: commentCrudIndexer,
    })

    return { commentId: comment.id, taskId: comment.taskId }
  },
  buildLog: async ({ snapshots }) => {
    const before = (snapshots.before as { snapshot?: CommentSnapshot } | undefined)?.snapshot
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.task_comments.delete', 'Delete task comment'),
      resourceKind: STAFF_TIME_TASK_COMMENT_RESOURCE_KIND,
      resourceId: before.id,
      parentResourceKind: 'staff.timesheets.task',
      parentResourceId: before.taskId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies CommentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CommentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let comment = await em.findOne(
      StaffTimeTaskComment,
      scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)),
    )

    await withAtomicFlush(
      em,
      [
        () => {
          if (!comment) {
            comment = em.create(StaffTimeTaskComment, {
              id: before.id,
              tenantId: before.tenantId,
              organizationId: before.organizationId,
              taskId: before.taskId,
              body: before.body,
              authorUserId: before.authorUserId,
              createdAt: before.createdAt ? new Date(before.createdAt) : new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            })
            em.persist(comment)
            return
          }
          comment.body = before.body
          comment.authorUserId = before.authorUserId
          comment.deletedAt = null
          comment.updatedAt = new Date()
        },
      ],
      { transaction: true, label: `${staffTimeTaskCommentCommandIds.delete}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: comment,
      identifiers: { id: before.id, organizationId: before.organizationId, tenantId: before.tenantId },
      events: commentCrudEvents,
      indexer: commentCrudIndexer,
    })
  },
}

registerCommand(createTaskCommentCommand)
registerCommand(updateTaskCommentCommand)
registerCommand(deleteTaskCommentCommand)
