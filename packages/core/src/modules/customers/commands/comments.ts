import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CommandUndoLogEntry } from '@open-mercato/shared/lib/commands/types'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId, normalizeAuthorUserId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerComment } from '../data/entities'
import { commentCreateSchema, commentUpdateSchema, type CommentCreateInput, type CommentUpdateInput } from '../data/validators'
import {
  findScopedCustomerCommandRecord,
  findScopedCustomerCommandTarget,
  ensureOrganizationScope,
  ensureTenantScope,
  requireTimelineParentEntity,
  ensureSameScope,
  extractUndoPayload,
  lockDealInScope,
  resolveParentResourceKind,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { requireInteractionUsersInScope } from '../lib/interactionUsers'
import { CrudHttpError, conflict, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { resolveRedoSnapshot, restoreCreatedRow } from '@open-mercato/shared/lib/commands/redo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const commentCrudIndexer: CrudIndexerConfig<CustomerComment> = {
  entityType: E.customers.customer_comment,
}

const commentCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'comment',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type CommentSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  entityId: string
  entityKind: string | null
  dealId: string | null
  body: string
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
}

type CommentUndoPayload = {
  before?: CommentSnapshot | null
  after?: CommentSnapshot | null
}

type CommentCreateResult = { commentId: string; authorUserId: string | null; updatedAt: string }

async function loadCommentSnapshot(em: EntityManager, id: string, ctx: CommandRuntimeContext): Promise<CommentSnapshot | null> {
  const comment = await findScopedCustomerCommandTarget(
    em,
    CustomerComment,
    { id, deletedAt: null },
    { populate: ['entity'] },
    ctx,
  )
  if (!comment) return null
  ensureTenantScope(ctx, comment.tenantId)
  ensureOrganizationScope(ctx, comment.organizationId)
  const entityRef = comment.entity
  const entityKind = (typeof entityRef === 'object' && entityRef !== null && 'kind' in entityRef)
    ? (entityRef as { kind: string }).kind
    : null
  return {
    id: comment.id,
    organizationId: comment.organizationId,
    tenantId: comment.tenantId,
    entityId: typeof entityRef === 'string' ? entityRef : entityRef.id,
    entityKind,
    dealId: comment.deal ? (typeof comment.deal === 'string' ? comment.deal : comment.deal.id) : null,
    body: comment.body,
    authorUserId: comment.authorUserId ?? null,
    appearanceIcon: comment.appearanceIcon ?? null,
    appearanceColor: comment.appearanceColor ?? null,
  }
}

async function restoreCommentSnapshot(em: EntityManager, before: CommentSnapshot, label: string): Promise<CustomerComment> {
  const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
  let comment!: CustomerComment
  await withAtomicFlush(em, [
    async () => {
      const existing = await findOneWithDecryption(em, CustomerComment, { id: before.id, ...scope }, undefined, scope)
      const entity = await requireTimelineParentEntity(em, before.entityId, scope)
      const deal = await lockDealInScope(em, before.dealId, before.tenantId, before.organizationId)
      if (!existing) {
        comment = em.create(CustomerComment, {
          id: before.id,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          entity,
          deal,
          body: before.body,
          authorUserId: before.authorUserId,
          appearanceIcon: before.appearanceIcon,
          appearanceColor: before.appearanceColor,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(comment)
        return
      }
      existing.entity = entity
      existing.deal = deal
      existing.body = before.body
      existing.authorUserId = before.authorUserId
      existing.appearanceIcon = before.appearanceIcon
      existing.appearanceColor = before.appearanceColor
      comment = existing
    },
  ], { transaction: true, label })
  return comment
}

async function redoCreatedComment(ctx: CommandRuntimeContext, logEntry: CommandUndoLogEntry): Promise<CommentCreateResult> {
  const snapshot = resolveRedoSnapshot<CommentSnapshot>(logEntry)
  if (!snapshot?.id) throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for create command' })
  const scope = { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId }
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  let comment!: CustomerComment
  try {
    await withAtomicFlush(em, [
      async () => {
        const entity = await requireTimelineParentEntity(em, snapshot.entityId, scope)
        const deal = await lockDealInScope(em, snapshot.dealId, snapshot.tenantId, snapshot.organizationId)
        comment = await restoreCreatedRow(
          em,
          CustomerComment,
          snapshot.id,
          () => ({
            id: snapshot.id,
            organizationId: snapshot.organizationId,
            tenantId: snapshot.tenantId,
            body: snapshot.body,
            authorUserId: snapshot.authorUserId,
            appearanceIcon: snapshot.appearanceIcon,
            appearanceColor: snapshot.appearanceColor,
            entity,
            deal,
          }),
          (forkedEm, id) => findOneWithDecryption(forkedEm, CustomerComment, { id, ...scope }, undefined, scope),
        )
      },
    ], { transaction: true, label: 'customers.comments.create.redo' })
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('[internal] Cannot redo: a record with the same unique key already exists.')
    throw err
  }
  const de = (ctx.container.resolve('dataEngine') as DataEngine)
  await emitCrudSideEffects({
    dataEngine: de,
    action: 'created',
    entity: comment,
    identifiers: {
      id: comment.id,
      organizationId: comment.organizationId,
      tenantId: comment.tenantId,
    },
    indexer: commentCrudIndexer,
    events: commentCrudEvents,
  })
  return { commentId: comment.id, authorUserId: comment.authorUserId ?? null, updatedAt: comment.updatedAt.toISOString() }
}

const createCommentCommand: CommandHandler<CommentCreateInput, CommentCreateResult> = {
  id: 'customers.comments.create',
  async execute(rawInput, ctx) {
    const parsed = commentCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const normalizedAuthor = normalizeAuthorUserId(parsed.authorUserId, ctx.auth)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let comment!: CustomerComment
    await withAtomicFlush(em, [
      async () => {
        const entity = await requireTimelineParentEntity(em, parsed.entityId, { tenantId: parsed.tenantId, organizationId: parsed.organizationId })
        ensureSameScope(entity, parsed.organizationId, parsed.tenantId)
        const deal = await lockDealInScope(em, parsed.dealId, parsed.tenantId, parsed.organizationId)
        comment = em.create(CustomerComment, {
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
          entity,
          deal,
          body: parsed.body,
          authorUserId: normalizedAuthor,
          appearanceIcon: parsed.appearanceIcon ?? null,
          appearanceColor: parsed.appearanceColor ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(comment)
      },
    ], { transaction: true, label: 'customers.comments.create' })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: comment,
      identifiers: {
        id: comment.id,
        organizationId: comment.organizationId,
        tenantId: comment.tenantId,
      },
      indexer: commentCrudIndexer,
      events: commentCrudEvents,
    })

    return { commentId: comment.id, authorUserId: comment.authorUserId ?? null, updatedAt: comment.updatedAt.toISOString() }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadCommentSnapshot(em, result.commentId, ctx)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as CommentSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.comments.create', 'Create note'),
      resourceKind: 'customers.comment',
      resourceId: result.commentId,
      parentResourceKind: snapshot?.entityId ? resolveParentResourceKind(snapshot.entityKind) : (snapshot?.dealId ? 'customers.deal' : null),
      parentResourceId: snapshot?.entityId ?? snapshot?.dealId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      relatedResourceKind: snapshot?.dealId ? 'customers.deal' : null,
      relatedResourceId: snapshot?.dealId ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies CommentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const commentId = logEntry?.resourceId ?? null
    if (!commentId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await findScopedCustomerCommandRecord(em, CustomerComment, { id: commentId }, undefined, ctx)
    if (existing) {
      em.remove(existing)
      await em.flush()
    }
  },
  redo: async ({ ctx, logEntry }) => redoCreatedComment(ctx, logEntry),
}

const updateCommentCommand: CommandHandler<CommentUpdateInput, { commentId: string; updatedAt: string }> = {
  id: 'customers.comments.update',
  async prepare(rawInput, ctx) {
    const parsed = commentUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadCommentSnapshot(em, parsed.id, ctx)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = commentUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let comment!: CustomerComment
    await withAtomicFlush(em, [
      async () => {
        const found = await findScopedCustomerCommandTarget(em, CustomerComment, { id: parsed.id, deletedAt: null }, undefined, ctx)
        if (!found) throw notFound('Comment not found')
        ensureTenantScope(ctx, found.tenantId)
        ensureOrganizationScope(ctx, found.organizationId)

        const canReassignAuthor = ctx.auth?.isSuperAdmin === true && ctx.auth.isApiKey !== true
        const shouldReassignAuthor = canReassignAuthor && parsed.authorUserId !== undefined
        if (shouldReassignAuthor && parsed.authorUserId && parsed.authorUserId !== found.authorUserId) {
          await requireInteractionUsersInScope(em, {
            tenantId: found.tenantId,
            organizationId: found.organizationId,
          }, { authorUserId: parsed.authorUserId })
        }

        const entity = parsed.entityId !== undefined
          ? await requireTimelineParentEntity(em, parsed.entityId, { tenantId: found.tenantId, organizationId: found.organizationId })
          : null
        if (entity) ensureSameScope(entity, found.organizationId, found.tenantId)
        const deal = parsed.dealId !== undefined
          ? await lockDealInScope(em, parsed.dealId, found.tenantId, found.organizationId)
          : null

        if (entity) found.entity = entity
        if (parsed.dealId !== undefined) found.deal = deal
        if (parsed.body !== undefined) found.body = parsed.body
        if (shouldReassignAuthor) found.authorUserId = parsed.authorUserId ?? null
        if (parsed.appearanceIcon !== undefined) found.appearanceIcon = parsed.appearanceIcon ?? null
        if (parsed.appearanceColor !== undefined) found.appearanceColor = parsed.appearanceColor ?? null
        comment = found
      },
    ], { transaction: true, label: 'customers.comments.update' })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: comment,
      identifiers: {
        id: comment.id,
        organizationId: comment.organizationId,
        tenantId: comment.tenantId,
      },
      indexer: commentCrudIndexer,
      events: commentCrudEvents,
    })

    return { commentId: comment.id, updatedAt: comment.updatedAt.toISOString() }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadCommentSnapshot(em, result.commentId, ctx)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as CommentSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as CommentSnapshot | undefined
    const changes =
      afterSnapshot && before
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            afterSnapshot as unknown as Record<string, unknown>,
            ['entityId', 'dealId', 'body', 'authorUserId', 'appearanceIcon', 'appearanceColor']
          )
        : {}
    return {
      actionLabel: translate('customers.audit.comments.update', 'Update note'),
      resourceKind: 'customers.comment',
      resourceId: before.id,
      parentResourceKind: before.entityId ? resolveParentResourceKind(before.entityKind) : (before.dealId ? 'customers.deal' : null),
      parentResourceId: before.entityId ?? before.dealId ?? null,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      relatedResourceKind: (afterSnapshot?.dealId ?? before.dealId) ? 'customers.deal' : null,
      relatedResourceId: afterSnapshot?.dealId ?? before.dealId ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies CommentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CommentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const comment = await restoreCommentSnapshot(em, before, 'customers.comments.update.undo')

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: comment,
      identifiers: {
        id: comment.id,
        organizationId: comment.organizationId,
        tenantId: comment.tenantId,
      },
      indexer: commentCrudIndexer,
      events: commentCrudEvents,
    })
  },
}

const deleteCommentCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { commentId: string }> =
  {
    id: 'customers.comments.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Comment id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadCommentSnapshot(em, id, ctx)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Comment id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const comment = await findScopedCustomerCommandTarget(em, CustomerComment, { id, deletedAt: null }, undefined, ctx)
      if (!comment) throw notFound('Comment not found')
      ensureTenantScope(ctx, comment.tenantId)
      ensureOrganizationScope(ctx, comment.organizationId)
      em.remove(comment)
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: comment,
        identifiers: {
          id: comment.id,
          organizationId: comment.organizationId,
          tenantId: comment.tenantId,
        },
        indexer: commentCrudIndexer,
        events: commentCrudEvents,
      })
      return { commentId: comment.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as CommentSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.comments.delete', 'Delete note'),
        resourceKind: 'customers.comment',
        resourceId: before.id,
        parentResourceKind: before.entityId ? resolveParentResourceKind(before.entityKind) : (before.dealId ? 'customers.deal' : null),
        parentResourceId: before.entityId ?? before.dealId ?? null,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        relatedResourceKind: before.dealId ? 'customers.deal' : null,
        relatedResourceId: before.dealId ?? null,
        payload: {
          undo: {
            before,
          } satisfies CommentUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<CommentUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const comment = await restoreCommentSnapshot(em, before, 'customers.comments.delete.undo')

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity: comment,
        identifiers: {
          id: comment.id,
          organizationId: comment.organizationId,
          tenantId: comment.tenantId,
        },
        indexer: commentCrudIndexer,
        events: commentCrudEvents,
      })
    },
  }

registerCommand(createCommentCommand)
registerCommand(updateCommentCommand)
registerCommand(deleteCommentCommand)
