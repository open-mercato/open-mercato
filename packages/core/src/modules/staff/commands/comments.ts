import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { StaffTeamMemberComment } from '../data/entities'
import {
  staffTeamMemberCommentCreateSchema,
  staffTeamMemberCommentUpdateSchema,
  type StaffTeamMemberCommentCreateInput,
  type StaffTeamMemberCommentUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload, requireTeamMember } from './shared'
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

type CommentUndoPayload = {
  before?: CommentSnapshot | null
  after?: CommentSnapshot | null
}

async function loadCommentSnapshot(em: EntityManager, id: string): Promise<CommentSnapshot | null> {
  const comment = await em.findOne(StaffTeamMemberComment, { id })
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

const createCommentCommand: CommandHandler<
  StaffTeamMemberCommentCreateInput,
  { commentId: string; authorUserId: string | null }
> = {
  id: 'staff.team-member-comments.create',
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberCommentCreateSchema.parse(rawInput)
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
    const member = await requireTeamMember(em, parsed.entityId, 'Team member not found')
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)

    const comment = em.create(StaffTeamMemberComment, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      member,
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
      actionLabel: translate('staff.audit.teamMemberComments.create', 'Create note'),
      resourceKind: 'staff.team_member_comment',
      resourceId: result.commentId,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: snapshot?.memberId ?? null,
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
    const existing = await em.findOne(StaffTeamMemberComment, { id: commentId })
    if (existing) {
      em.remove(existing)
      await em.flush()
    }
  },
}

const updateCommentCommand: CommandHandler<StaffTeamMemberCommentUpdateInput, { commentId: string }> = {
  id: 'staff.team-member-comments.update',
  async prepare(rawInput, ctx) {
    const parsed = staffTeamMemberCommentUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadCommentSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberCommentUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const comment = await em.findOne(StaffTeamMemberComment, { id: parsed.id })
    if (!comment) throw new CrudHttpError(404, { error: 'Comment not found' })
    ensureTenantScope(ctx, comment.tenantId)
    ensureOrganizationScope(ctx, comment.organizationId)

    if (parsed.entityId !== undefined) {
      const member = await requireTeamMember(em, parsed.entityId, 'Team member not found')
      ensureTenantScope(ctx, member.tenantId)
      ensureOrganizationScope(ctx, member.organizationId)
      comment.member = member
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
            ['memberId', 'body', 'authorUserId', 'appearanceIcon', 'appearanceColor']
          )
        : {}
    return {
      actionLabel: translate('staff.audit.teamMemberComments.update', 'Update note'),
      resourceKind: 'staff.team_member_comment',
      resourceId: before.id,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: before.memberId ?? null,
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
    let comment = await em.findOne(StaffTeamMemberComment, { id: before.id })
    const member = await requireTeamMember(em, before.memberId, 'Team member not found')

    if (!comment) {
      comment = em.create(StaffTeamMemberComment, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        member,
        body: before.body,
        authorUserId: before.authorUserId,
        appearanceIcon: before.appearanceIcon,
        appearanceColor: before.appearanceColor,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(comment)
    } else {
      comment.member = member
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
    id: 'staff.team-member-comments.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Comment id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadCommentSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Comment id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const comment = await em.findOne(StaffTeamMemberComment, { id })
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
        actionLabel: translate('staff.audit.teamMemberComments.delete', 'Delete note'),
        resourceKind: 'staff.team_member_comment',
        resourceId: before.id,
        parentResourceKind: 'staff.teamMember',
        parentResourceId: before.memberId ?? null,
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
      const member = await requireTeamMember(em, before.memberId, 'Team member not found')
      let comment = await em.findOne(StaffTeamMemberComment, { id: before.id })
      if (!comment) {
        comment = em.create(StaffTeamMemberComment, {
          id: before.id,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          member,
          body: before.body,
          authorUserId: before.authorUserId,
          appearanceIcon: before.appearanceIcon,
          appearanceColor: before.appearanceColor,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(comment)
      } else {
        comment.member = member
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
