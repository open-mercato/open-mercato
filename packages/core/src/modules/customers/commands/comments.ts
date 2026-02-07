import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerComment } from '../data/entities'
import { commentCreateSchema, commentUpdateSchema, type CommentCreateInput, type CommentUpdateInput } from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  requireCustomerEntity,
  ensureSameScope,
  extractUndoPayload,
  requireDealInScope,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'

const commentCrudIndexer: CrudIndexerConfig<CustomerComment> = {
  entityType: E.customers.customer_comment,
}

type CommentSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  entityId: string
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

async function loadCommentSnapshot(em: EntityManager, id: string): Promise<CommentSnapshot | null> {
  const comment = await em.findOne(CustomerComment, { id })
  if (!comment) return null
  return {
    id: comment.id,
    organizationId: comment.organizationId,
    tenantId: comment.tenantId,
    entityId: typeof comment.entity === 'string' ? comment.entity : comment.entity.id,
    dealId: comment.deal ? (typeof comment.deal === 'string' ? comment.deal : comment.deal.id) : null,
    body: comment.body,
    authorUserId: comment.authorUserId ?? null,
    appearanceIcon: comment.appearanceIcon ?? null,
    appearanceColor: comment.appearanceColor ?? null,
  }
}

const createCommentCommand: CommandHandler<CommentCreateInput, { commentId: string; authorUserId: string | null }> = {
  id: 'customers.comments.create',
  async execute(rawInput, ctx) {
    const parsed = commentCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const authSub = ctx.auth?.isApiKey ? null : ctx.auth?.sub ?? null
    const normalizedAuthor = (() => {
      if (parsed.authorUserId) return parsed.authorUserId
      if (!authSub) return null
      const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
      return uuidRegex.test(authSub) ? authSub : null
    })()

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)
    const deal = await requireDealInScope(em, parsed.dealId, parsed.tenantId, parsed.organizationId)

    const comment = em.create(CustomerComment, {
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
    await em.flush()

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
    })

    return { commentId: comment.id, authorUserId: comment.authorUserId ?? null }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadCommentSnapshot(em, result.commentId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as CommentSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.comments.create', 'Create note'),
      resourceKind: 'customers.comment',
      resourceId: result.commentId,
      parentResourceKind: snapshot?.entityId ? 'customers.person' : (snapshot?.dealId ? 'customers.deal' : null),
      parentResourceId: snapshot?.entityId ?? snapshot?.dealId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
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
    const existing = await em.findOne(CustomerComment, { id: commentId })
    if (existing) {
      em.remove(existing)
      await em.flush()
    }
  },
}

const updateCommentCommand: CommandHandler<CommentUpdateInput, { commentId: string }> = {
  id: 'customers.comments.update',
  async prepare(rawInput, ctx) {
    const parsed = commentUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadCommentSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = commentUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const comment = await em.findOne(CustomerComment, { id: parsed.id })
    if (!comment) throw new CrudHttpError(404, { error: 'Comment not found' })
    ensureTenantScope(ctx, comment.tenantId)
    ensureOrganizationScope(ctx, comment.organizationId)

    if (parsed.entityId !== undefined) {
      const entity = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
      ensureSameScope(entity, comment.organizationId, comment.tenantId)
      comment.entity = entity
    }
    if (parsed.dealId !== undefined) {
      comment.deal = await requireDealInScope(em, parsed.dealId, comment.tenantId, comment.organizationId)
    }
    if (parsed.body !== undefined) comment.body = parsed.body
    if (parsed.authorUserId !== undefined) comment.authorUserId = parsed.authorUserId ?? null
    if (parsed.appearanceIcon !== undefined) comment.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) comment.appearanceColor = parsed.appearanceColor ?? null

    await em.flush()

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
    })

    return { commentId: comment.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadCommentSnapshot(em, result.commentId)
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
      parentResourceKind: before.entityId ? 'customers.person' : (before.dealId ? 'customers.deal' : null),
      parentResourceId: before.entityId ?? before.dealId ?? null,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
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
    let comment = await em.findOne(CustomerComment, { id: before.id })
    const entity = await requireCustomerEntity(em, before.entityId, undefined, 'Customer not found')
    const deal = await requireDealInScope(em, before.dealId, before.tenantId, before.organizationId)

    if (!comment) {
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
    } else {
      comment.entity = entity
      comment.deal = deal
      comment.body = before.body
      comment.authorUserId = before.authorUserId
      comment.appearanceIcon = before.appearanceIcon
      comment.appearanceColor = before.appearanceColor
    }
    await em.flush()

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
    })
  },
}

const deleteCommentCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { commentId: string }> =
  {
    id: 'customers.comments.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Comment id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadCommentSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Comment id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const comment = await em.findOne(CustomerComment, { id })
      if (!comment) throw new CrudHttpError(404, { error: 'Comment not found' })
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
        parentResourceKind: before.entityId ? 'customers.person' : (before.dealId ? 'customers.deal' : null),
        parentResourceId: before.entityId ?? before.dealId ?? null,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
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
      const entity = await requireCustomerEntity(em, before.entityId, undefined, 'Customer not found')
      const deal = await requireDealInScope(em, before.dealId, before.tenantId, before.organizationId)
      let comment = await em.findOne(CustomerComment, { id: before.id })
      if (!comment) {
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
      } else {
        comment.entity = entity
        comment.deal = deal
        comment.body = before.body
        comment.authorUserId = before.authorUserId
        comment.appearanceIcon = before.appearanceIcon
        comment.appearanceColor = before.appearanceColor
      }
      await em.flush()

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
      })
    },
  }

registerCommand(createCommentCommand)
registerCommand(updateCommentCommand)
registerCommand(deleteCommentCommand)
