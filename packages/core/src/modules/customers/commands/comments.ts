import { registerCommand } from '@open-mercato/shared/lib/commands'
import { normalizeAuthorUserId } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerComment } from '../data/entities'
import { commentCreateSchema, commentUpdateSchema, type CommentCreateInput, type CommentUpdateInput } from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  requireTimelineParentEntity,
  ensureSameScope,
  requireDealInScope,
  resolveParentResourceKind,
} from './shared'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { makeCommentCommandSet } from '@open-mercato/shared/lib/commands/timeline'
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

async function loadCommentSnapshot(em: EntityManager, id: string): Promise<CommentSnapshot | null> {
  const comment = await em.findOne(CustomerComment, { id }, { populate: ['entity'] })
  if (!comment) return null
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

const commentCommands = makeCommentCommandSet<
  CustomerComment,
  CommentSnapshot,
  CommentCreateInput,
  CommentUpdateInput
>({
  commandIds: {
    create: 'customers.comments.create',
    update: 'customers.comments.update',
    delete: 'customers.comments.delete',
  },
  resourceKind: 'customers.comment',
  auditLabels: {
    create: ['customers.audit.comments.create', 'Create note'],
    update: ['customers.audit.comments.update', 'Update note'],
    delete: ['customers.audit.comments.delete', 'Delete note'],
  },
  changeKeys: ['entityId', 'dealId', 'body', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
  messages: { notFound: 'Comment not found', idRequired: 'Comment id required' },
  entityClass: CustomerComment,
  indexer: commentCrudIndexer,
  events: commentCrudEvents,
  schemas: { create: commentCreateSchema, update: commentUpdateSchema },

  loadSnapshot: (em, id) => loadCommentSnapshot(em, id),
  seedFromSnapshot: (snapshot) => ({
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    body: snapshot.body,
    authorUserId: snapshot.authorUserId,
    appearanceIcon: snapshot.appearanceIcon,
    appearanceColor: snapshot.appearanceColor,
  }),
  assignFromSnapshot: (comment, snapshot) => {
    comment.body = snapshot.body
    comment.authorUserId = snapshot.authorUserId
    comment.appearanceIcon = snapshot.appearanceIcon
    comment.appearanceColor = snapshot.appearanceColor
  },
  findRowForWrite: (em, id) => em.findOne(CustomerComment, { id }),
  // Redo reads through the decryption helper with the snapshot's own scope.
  findRowForRestore: ({ em, id, snapshot }) =>
    findOneWithDecryption(
      em,
      CustomerComment,
      { id },
      undefined,
      { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId },
    ),

  resolveParentForCreate: async ({ em, parsed, ctx }) => {
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const entity = await requireTimelineParentEntity(em, parsed.entityId, { tenantId: parsed.tenantId, organizationId: parsed.organizationId })
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)
    const deal = await requireDealInScope(em, parsed.dealId, parsed.tenantId, parsed.organizationId)
    return {
      relations: { entity, deal },
      scope: { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    }
  },
  resolveParentForRestore: async ({ em, snapshot }) => ({
    entity: await requireTimelineParentEntity(em, snapshot.entityId, { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId }),
    deal: await requireDealInScope(em, snapshot.dealId, snapshot.tenantId, snapshot.organizationId),
  }),
  resolveAuthorForCreate: ({ parsed, ctx }) => normalizeAuthorUserId(parsed.authorUserId, ctx.auth),

  buildCreateData: ({ parsed, relations, authorUserId }) => ({
    organizationId: parsed.organizationId,
    tenantId: parsed.tenantId,
    ...relations,
    body: parsed.body,
    authorUserId,
    appearanceIcon: parsed.appearanceIcon ?? null,
    appearanceColor: parsed.appearanceColor ?? null,
  }),
  applyUpdateFields: async ({ em, ctx, entity, parsed }) => {
    if (parsed.entityId !== undefined) {
      const parent = await requireTimelineParentEntity(em, parsed.entityId, { tenantId: entity.tenantId, organizationId: entity.organizationId })
      ensureSameScope(parent, entity.organizationId, entity.tenantId)
      entity.entity = parent
    }
    if (parsed.dealId !== undefined) {
      entity.deal = await requireDealInScope(em, parsed.dealId, entity.tenantId, entity.organizationId)
    }
    if (parsed.body !== undefined) entity.body = parsed.body
    if (parsed.authorUserId !== undefined) entity.authorUserId = parsed.authorUserId ?? null
    if (parsed.appearanceIcon !== undefined) entity.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) entity.appearanceColor = parsed.appearanceColor ?? null
  },

  // Parent is the timeline entity, or the deal when no entity kind resolves. Parent comes
  // from `before` and the related deal from `after`, so the log records where the comment
  // was and which deal it now belongs to.
  logMeta: ({ before, after }) => {
    const parent = before ?? after
    return {
      parentResourceKind: parent?.entityId
        ? resolveParentResourceKind(parent.entityKind)
        : (parent?.dealId ? 'customers.deal' : null),
      parentResourceId: parent?.entityId ?? parent?.dealId ?? null,
      relatedResourceKind: (after?.dealId ?? before?.dealId) ? 'customers.deal' : null,
      relatedResourceId: after?.dealId ?? before?.dealId ?? null,
    }
  },
  ensureRowInScope: (ctx, comment) => {
    ensureTenantScope(ctx, comment.tenantId)
    ensureOrganizationScope(ctx, comment.organizationId)
  },
  resourceIdOf: (result) => (result as { commentId: string }).commentId,
  buildResult: {
    create: (comment) => ({ commentId: comment.id, authorUserId: comment.authorUserId ?? null }),
    update: (comment) => ({ commentId: comment.id }),
    delete: (comment) => ({ commentId: comment.id }),
  },
})

registerCommand(commentCommands.create)
registerCommand(commentCommands.update)
registerCommand(commentCommands.delete)
