import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { makeCommentCommandSet } from '@open-mercato/shared/lib/commands/timeline'
import { ResourcesResourceComment } from '../data/entities'
import {
  resourcesResourceCommentCreateSchema,
  resourcesResourceCommentUpdateSchema,
  type ResourcesResourceCommentCreateInput,
  type ResourcesResourceCommentUpdateInput,
} from '../data/validators'
import { resourcesResourceCommentCrudEvents } from '../lib/crud'
import { ensureOrganizationScope, ensureTenantScope, requireResource, resolveResourceAuthorUserId } from './shared'
import { E } from '#generated/entities.ids.generated'

const commentCrudIndexer: CrudIndexerConfig<ResourcesResourceComment> = {
  entityType: E.resources.resources_resource_comment,
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

const commentCommands = makeCommentCommandSet<
  ResourcesResourceComment,
  CommentSnapshot,
  ResourcesResourceCommentCreateInput,
  ResourcesResourceCommentUpdateInput
>({
  commandIds: {
    create: 'resources.resource-comments.create',
    update: 'resources.resource-comments.update',
    delete: 'resources.resource-comments.delete',
  },
  resourceKind: 'resources.resource_comment',
  auditLabels: {
    create: ['resources.audit.resourceComments.create', 'Create note'],
    update: ['resources.audit.resourceComments.update', 'Update note'],
    delete: ['resources.audit.resourceComments.delete', 'Delete note'],
  },
  changeKeys: ['resourceId', 'body', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
  messages: { notFound: 'Comment not found', idRequired: 'Comment id required' },
  entityClass: ResourcesResourceComment,
  indexer: commentCrudIndexer,
  events: resourcesResourceCommentCrudEvents,
  schemas: { create: resourcesResourceCommentCreateSchema, update: resourcesResourceCommentUpdateSchema },

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
  findRowForWrite: (em, id) => em.findOne(ResourcesResourceComment, { id }),

  resolveParentForCreate: async ({ em, parsed, ctx }) => {
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const resource = await requireResource(em, parsed.entityId, 'Resource not found')
    ensureTenantScope(ctx, resource.tenantId)
    ensureOrganizationScope(ctx, resource.organizationId)
    return {
      relations: { resource },
      scope: { tenantId: resource.tenantId, organizationId: resource.organizationId },
    }
  },
  resolveParentForRestore: async ({ em, snapshot }) => ({
    resource: await requireResource(em, snapshot.resourceId, 'Resource not found'),
  }),
  resolveAuthorForCreate: ({ em, parsed, ctx, parentScope }) =>
    resolveResourceAuthorUserId(em, parsed.authorUserId, ctx, parentScope),

  buildCreateData: ({ parsed, relations, authorUserId }) => ({
    organizationId: parsed.organizationId,
    tenantId: parsed.tenantId,
    ...relations,
    body: parsed.body,
    authorUserId,
    appearanceIcon: parsed.appearanceIcon ?? null,
    appearanceColor: parsed.appearanceColor ?? null,
  }),
  // No `authorUserId` branch here: per #4012 a resource comment keeps its original author
  // on update even when one is supplied.
  applyUpdateFields: async ({ em, ctx, entity, parsed }) => {
    if (parsed.entityId !== undefined) {
      const resource = await requireResource(em, parsed.entityId, 'Resource not found')
      ensureTenantScope(ctx, resource.tenantId)
      ensureOrganizationScope(ctx, resource.organizationId)
      entity.resource = resource
    }
    if (parsed.body !== undefined) entity.body = parsed.body
    if (parsed.appearanceIcon !== undefined) entity.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) entity.appearanceColor = parsed.appearanceColor ?? null
  },

  logMeta: ({ before, after }) => ({
    parentResourceKind: 'resources.resource',
    parentResourceId: (before ?? after)?.resourceId ?? null,
  }),
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
