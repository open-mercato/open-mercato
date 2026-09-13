import { registerCommand } from '@open-mercato/shared/lib/commands'
import { normalizeAuthorUserId } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { makeCommentCommandSet } from '@open-mercato/shared/lib/commands/timeline'
import { StaffTeamMemberComment } from '../data/entities'
import {
  staffTeamMemberCommentCreateSchema,
  staffTeamMemberCommentUpdateSchema,
  type StaffTeamMemberCommentCreateInput,
  type StaffTeamMemberCommentUpdateInput,
} from '../data/validators'
import { staffTeamMemberCommentCrudEvents } from '../lib/crud'
import {
  applyScopeToWhere,
  commandActorScope,
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  explicitStaffCommandScope,
  requireTeamMember,
  scopedStaffSnapshotWhere,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffSnapshotScope,
} from './shared'
import { E } from '#generated/entities.ids.generated'

const commentCrudIndexer: CrudIndexerConfig<StaffTeamMemberComment> = {
  entityType: E.staff.staff_team_member_comment,
}

type CommentSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  memberId: string
  body: string
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
}

async function loadCommentSnapshot(em: EntityManager, id: string, scope?: StaffSnapshotScope | null): Promise<CommentSnapshot | null> {
  const comment = await em.findOne(StaffTeamMemberComment, scopedStaffSnapshotWhere(id, scope))
  if (!comment) return null
  return {
    id: comment.id,
    organizationId: comment.organizationId,
    tenantId: comment.tenantId,
    memberId: typeof comment.member === 'string' ? comment.member : comment.member.id,
    body: comment.body,
    authorUserId: comment.authorUserId ?? null,
    appearanceIcon: comment.appearanceIcon ?? null,
    appearanceColor: comment.appearanceColor ?? null,
  }
}

const commentCommands = makeCommentCommandSet<
  StaffTeamMemberComment,
  CommentSnapshot,
  StaffTeamMemberCommentCreateInput,
  StaffTeamMemberCommentUpdateInput
>({
  commandIds: {
    create: 'staff.team-member-comments.create',
    update: 'staff.team-member-comments.update',
    delete: 'staff.team-member-comments.delete',
  },
  resourceKind: 'staff.team_member_comment',
  auditLabels: {
    create: ['staff.audit.teamMemberComments.create', 'Create note'],
    update: ['staff.audit.teamMemberComments.update', 'Update note'],
    delete: ['staff.audit.teamMemberComments.delete', 'Delete note'],
  },
  changeKeys: ['memberId', 'body', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
  messages: { notFound: 'Comment not found', idRequired: 'Comment id required' },
  entityClass: StaffTeamMemberComment,
  indexer: commentCrudIndexer,
  events: staffTeamMemberCommentCrudEvents,
  schemas: { create: staffTeamMemberCommentCreateSchema, update: staffTeamMemberCommentUpdateSchema },

  // Every staff snapshot read and row lookup carries tenant/org scope (#3977).
  loadSnapshot: (em, id, ctx) => loadCommentSnapshot(em, id, staffSnapshotScopeFromContext(ctx)),
  findRowForWrite: (em, id, ctx) =>
    em.findOne(StaffTeamMemberComment, applyScopeToWhere<StaffTeamMemberComment>({ id }, commandActorScope(ctx))),
  findRowForRestore: ({ em, id, snapshot }) =>
    em.findOne(StaffTeamMemberComment, scopedStaffSnapshotWhere(id, staffSnapshotScopeFromSnapshot(snapshot))),

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

  resolveParentForCreate: async ({ em, parsed, ctx }) => {
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const member = await requireTeamMember(
      em,
      parsed.entityId,
      commandInputScope(ctx, parsed.tenantId, parsed.organizationId),
      'Team member not found',
    )
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)
    return {
      relations: { member },
      scope: { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    }
  },
  resolveParentForRestore: async ({ em, snapshot }) => ({
    member: await requireTeamMember(
      em,
      snapshot.memberId,
      explicitStaffCommandScope(snapshot.tenantId, snapshot.organizationId),
      'Team member not found',
    ),
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
      const member = await requireTeamMember(em, parsed.entityId, commandActorScope(ctx), 'Team member not found')
      ensureTenantScope(ctx, member.tenantId)
      ensureOrganizationScope(ctx, member.organizationId)
      entity.member = member
    }
    if (parsed.body !== undefined) entity.body = parsed.body
    if (parsed.authorUserId !== undefined) entity.authorUserId = parsed.authorUserId ?? null
    if (parsed.appearanceIcon !== undefined) entity.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) entity.appearanceColor = parsed.appearanceColor ?? null
  },

  logMeta: ({ before, after }) => ({
    parentResourceKind: 'staff.teamMember',
    parentResourceId: (before ?? after)?.memberId ?? null,
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
