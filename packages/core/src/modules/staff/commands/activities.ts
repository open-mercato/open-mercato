import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { StaffTeamMemberActivity } from '../data/entities'
import {
  staffTeamMemberActivityCreateSchema,
  staffTeamMemberActivityUpdateSchema,
  type StaffTeamMemberActivityCreateInput,
  type StaffTeamMemberActivityUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload, requireTeamMember } from './shared'
import { E } from '#generated/entities.ids.generated'

const activityCrudIndexer: CrudIndexerConfig<StaffTeamMemberActivity> = {
  entityType: E.staff.staff_team_member_activity,
  cacheAliases: [],
}

type ActivitySnapshot = {
  id: string
  organizationId: string
  tenantId: string
  memberId: string
  activityType: string
  subject: string | null
  body: string | null
  occurredAt: string | null
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
}

type ActivityUndoPayload = {
  before?: ActivitySnapshot | null
  after?: ActivitySnapshot | null
}

async function loadActivitySnapshot(em: EntityManager, id: string): Promise<ActivitySnapshot | null> {
  const activity = await em.findOne(StaffTeamMemberActivity, { id })
  if (!activity) return null
  return {
    id: activity.id,
    organizationId: activity.organizationId,
    tenantId: activity.tenantId,
    memberId: typeof activity.member === 'string' ? activity.member : activity.member.id,
    activityType: activity.activityType,
    subject: activity.subject ?? null,
    body: activity.body ?? null,
    occurredAt: activity.occurredAt ? activity.occurredAt.toISOString() : null,
    authorUserId: activity.authorUserId ?? null,
    appearanceIcon: activity.appearanceIcon ?? null,
    appearanceColor: activity.appearanceColor ?? null,
  }
}

const createActivityCommand: CommandHandler<
  StaffTeamMemberActivityCreateInput,
  { activityId: string; authorUserId: string | null }
> = {
  id: 'staff.team-member-activities.create',
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberActivityCreateSchema.parse(rawInput)
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

    const activity = em.create(StaffTeamMemberActivity, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      member,
      activityType: parsed.activityType,
      subject: parsed.subject ?? null,
      body: parsed.body ?? null,
      occurredAt: parsed.occurredAt ?? null,
      authorUserId: normalizedAuthor,
      appearanceIcon: parsed.appearanceIcon ?? null,
      appearanceColor: parsed.appearanceColor ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(activity)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: activity,
      identifiers: {
        id: activity.id,
        organizationId: activity.organizationId,
        tenantId: activity.tenantId,
      },
      indexer: activityCrudIndexer,
    })

    return { activityId: activity.id, authorUserId: activity.authorUserId ?? null }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return await loadActivitySnapshot(em, result.activityId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadActivitySnapshot(em, result.activityId)
    return {
      actionLabel: translate('staff.audit.teamMemberActivities.create', 'Create activity'),
      resourceKind: 'staff.team_member_activity',
      resourceId: result.activityId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies ActivityUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const activityId = logEntry?.resourceId ?? null
    if (!activityId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(StaffTeamMemberActivity, { id: activityId })
    if (existing) {
      em.remove(existing)
      await em.flush()
    }
  },
}

const updateActivityCommand: CommandHandler<StaffTeamMemberActivityUpdateInput, { activityId: string }> = {
  id: 'staff.team-member-activities.update',
  async prepare(rawInput, ctx) {
    const parsed = staffTeamMemberActivityUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadActivitySnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberActivityUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const activity = await em.findOne(StaffTeamMemberActivity, { id: parsed.id })
    if (!activity) throw new CrudHttpError(404, { error: 'Activity not found' })
    ensureTenantScope(ctx, activity.tenantId)
    ensureOrganizationScope(ctx, activity.organizationId)

    if (parsed.entityId !== undefined) {
      const member = await requireTeamMember(em, parsed.entityId, 'Team member not found')
      ensureTenantScope(ctx, member.tenantId)
      ensureOrganizationScope(ctx, member.organizationId)
      activity.member = member
    }
    if (parsed.activityType !== undefined) activity.activityType = parsed.activityType
    if (parsed.subject !== undefined) activity.subject = parsed.subject ?? null
    if (parsed.body !== undefined) activity.body = parsed.body ?? null
    if (parsed.occurredAt !== undefined) activity.occurredAt = parsed.occurredAt ?? null
    if (parsed.authorUserId !== undefined) activity.authorUserId = parsed.authorUserId ?? null
    if (parsed.appearanceIcon !== undefined) activity.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) activity.appearanceColor = parsed.appearanceColor ?? null

    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: activity,
      identifiers: {
        id: activity.id,
        organizationId: activity.organizationId,
        tenantId: activity.tenantId,
      },
      indexer: activityCrudIndexer,
    })

    return { activityId: activity.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as ActivitySnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const afterSnapshot = await loadActivitySnapshot(em, before.id)
    const changes =
      afterSnapshot && before
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            afterSnapshot as unknown as Record<string, unknown>,
            ['memberId', 'activityType', 'subject', 'body', 'occurredAt', 'authorUserId', 'appearanceIcon', 'appearanceColor']
          )
        : {}
    return {
      actionLabel: translate('staff.audit.teamMemberActivities.update', 'Update activity'),
      resourceKind: 'staff.team_member_activity',
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
        } satisfies ActivityUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ActivityUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let activity = await em.findOne(StaffTeamMemberActivity, { id: before.id })
    const member = await requireTeamMember(em, before.memberId, 'Team member not found')

    if (!activity) {
      activity = em.create(StaffTeamMemberActivity, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        member,
        activityType: before.activityType,
        subject: before.subject,
        body: before.body,
        occurredAt: before.occurredAt ? new Date(before.occurredAt) : null,
        authorUserId: before.authorUserId,
        appearanceIcon: before.appearanceIcon,
        appearanceColor: before.appearanceColor,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(activity)
    } else {
      activity.member = member
      activity.activityType = before.activityType
      activity.subject = before.subject
      activity.body = before.body
      activity.occurredAt = before.occurredAt ? new Date(before.occurredAt) : null
      activity.authorUserId = before.authorUserId
      activity.appearanceIcon = before.appearanceIcon
      activity.appearanceColor = before.appearanceColor
    }
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: activity,
      identifiers: {
        id: activity.id,
        organizationId: activity.organizationId,
        tenantId: activity.tenantId,
      },
      indexer: activityCrudIndexer,
    })
  },
}

const deleteActivityCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { activityId: string }> =
  {
    id: 'staff.team-member-activities.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Activity id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadActivitySnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Activity id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const activity = await em.findOne(StaffTeamMemberActivity, { id })
      if (!activity) throw new CrudHttpError(404, { error: 'Activity not found' })
      ensureTenantScope(ctx, activity.tenantId)
      ensureOrganizationScope(ctx, activity.organizationId)
      em.remove(activity)
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: activity,
        identifiers: {
          id: activity.id,
          organizationId: activity.organizationId,
          tenantId: activity.tenantId,
        },
        indexer: activityCrudIndexer,
      })
      return { activityId: activity.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as ActivitySnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('staff.audit.teamMemberActivities.delete', 'Delete activity'),
        resourceKind: 'staff.team_member_activity',
        resourceId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies ActivityUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<ActivityUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const member = await requireTeamMember(em, before.memberId, 'Team member not found')
      let activity = await em.findOne(StaffTeamMemberActivity, { id: before.id })
      if (!activity) {
        activity = em.create(StaffTeamMemberActivity, {
          id: before.id,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          member,
          activityType: before.activityType,
          subject: before.subject,
          body: before.body,
          occurredAt: before.occurredAt ? new Date(before.occurredAt) : null,
          authorUserId: before.authorUserId,
          appearanceIcon: before.appearanceIcon,
          appearanceColor: before.appearanceColor,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(activity)
      } else {
        activity.member = member
        activity.activityType = before.activityType
        activity.subject = before.subject
        activity.body = before.body
        activity.occurredAt = before.occurredAt ? new Date(before.occurredAt) : null
        activity.authorUserId = before.authorUserId
        activity.appearanceIcon = before.appearanceIcon
        activity.appearanceColor = before.appearanceColor
      }
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity: activity,
        identifiers: {
          id: activity.id,
          organizationId: activity.organizationId,
          tenantId: activity.tenantId,
        },
        indexer: activityCrudIndexer,
      })
    },
  }

registerCommand(createActivityCommand)
registerCommand(updateActivityCommand)
registerCommand(deleteActivityCommand)
