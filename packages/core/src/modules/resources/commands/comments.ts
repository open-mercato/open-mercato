import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { ResourcesResourceComment } from '../data/entities'
import {
  resourcesResourceCommentCreateSchema,
  resourcesResourceCommentUpdateSchema,
  type ResourcesResourceCommentCreateInput,
  type ResourcesResourceCommentUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload, requireResource } from './shared'
import { E } from '#generated/entities.ids.generated'

const commentCrudIndexer: CrudIndexerConfig<ResourcesResourceComment> = {
  entityType: E.resources.resources_resource_comment,
  cacheAliases: [],
}

type CommentSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  resourceId: string
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
  const comment = await em.findOne(ResourcesResourceComment, { id })
  if (!comment) return null
  return {
    id: comment.id,
    organizationId: comment.organizationId,
    tenantId: comment.tenantId,
    resourceId: typeof comment.resource === 'string' ? comment.resource : comment.resource.id,
    body: comment.body,
    authorUserId: comment.authorUserId ?? null,
    appearanceIcon: comment.appearanceIcon ?? null,
    appearanceColor: comment.appearanceColor ?? null,
  }
}

const createCommentCommand: CommandHandler<
  ResourcesResourceCommentCreateInput,
  { commentId: string; authorUserId: string | null }
> = {
  id: 'resources.resource-comments.create',
  async execute(rawInput, ctx) {
    const parsed = resourcesResourceCommentCreateSchema.parse(rawInput)
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
    const resource = await requireResource(em, parsed.entityId, 'Resource not found')
    ensureTenantScope(ctx, resource.tenantId)
    ensureOrganizationScope(ctx, resource.organizationId)

    const comment = em.create(ResourcesResourceComment, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      resource,
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
    const em = (ctx.container.resolve('em') as EntityManager)
    return await loadCommentSnapshot(em, result.commentId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadCommentSnapshot(em, result.commentId)
    return {
      actionLabel: translate('resources.audit.resourceComments.create', 'Create note'),
      resourceKind: 'resources.resource_comment',
      resourceId: result.commentId,
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
    const existing = await em.findOne(ResourcesResourceComment, { id: commentId })
    if (existing) {
      em.remove(existing)
      await em.flush()
    }
  },
}

const updateCommentCommand: CommandHandler<ResourcesResourceCommentUpdateInput, { commentId: string }> = {
  id: 'resources.resource-comments.update',
  async prepare(rawInput, ctx) {
    const parsed = resourcesResourceCommentUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadCommentSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = resourcesResourceCommentUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const comment = await em.findOne(ResourcesResourceComment, { id: parsed.id })
    if (!comment) throw new CrudHttpError(404, { error: 'Comment not found' })
    ensureTenantScope(ctx, comment.tenantId)
    ensureOrganizationScope(ctx, comment.organizationId)

    if (parsed.entityId !== undefined) {
      const resource = await requireResource(em, parsed.entityId, 'Resource not found')
      ensureTenantScope(ctx, resource.tenantId)
      ensureOrganizationScope(ctx, resource.organizationId)
      comment.resource = resource
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
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as CommentSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const afterSnapshot = await loadCommentSnapshot(em, before.id)
    const changes =
      afterSnapshot && before
        ? buildChanges(
            before as Record<string, unknown>,
            afterSnapshot as Record<string, unknown>,
            ['resourceId', 'body', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
          )
        : {}
    return {
      actionLabel: translate('resources.audit.resourceComments.update', 'Update note'),
      resourceKind: 'resources.resource_comment',
      resourceId: before.id,
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
    let comment = await em.findOne(ResourcesResourceComment, { id: before.id })
    const resource = await requireResource(em, before.resourceId, 'Resource not found')

    if (!comment) {
      comment = em.create(ResourcesResourceComment, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        resource,
        body: before.body,
        authorUserId: before.authorUserId,
        appearanceIcon: before.appearanceIcon,
        appearanceColor: before.appearanceColor,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(comment)
    } else {
      comment.resource = resource
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

const deleteCommentCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { commentId: string }> = {
  id: 'resources.resource-comments.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Comment id required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadCommentSnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Comment id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const comment = await em.findOne(ResourcesResourceComment, { id })
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
      actionLabel: translate('resources.audit.resourceComments.delete', 'Delete note'),
      resourceKind: 'resources.resource_comment',
      resourceId: before.id,
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
    const resource = await requireResource(em, before.resourceId, 'Resource not found')
    let comment = await em.findOne(ResourcesResourceComment, { id: before.id })
    if (!comment) {
      comment = em.create(ResourcesResourceComment, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        resource,
        body: before.body,
        authorUserId: before.authorUserId,
        appearanceIcon: before.appearanceIcon,
        appearanceColor: before.appearanceColor,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(comment)
    } else {
      comment.resource = resource
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
