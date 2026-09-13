import { registerCommand } from '@open-mercato/shared/lib/commands'
import { normalizeAuthorUserId } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { makeActivityCommandSet, type ActivitySnapshotEnvelope } from '@open-mercato/shared/lib/commands/timeline'
import { StaffTeamMemberActivity } from '../data/entities'
import {
  staffTeamMemberActivityCreateSchema,
  staffTeamMemberActivityUpdateSchema,
  type StaffTeamMemberActivityCreateInput,
  type StaffTeamMemberActivityUpdateInput,
} from '../data/validators'
import { staffTeamMemberActivityCrudEvents } from '../lib/crud'
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

const ACTIVITY_ENTITY_ID = E.staff.staff_team_member_activity

const activityCrudIndexer: CrudIndexerConfig<StaffTeamMemberActivity> = {
  entityType: ACTIVITY_ENTITY_ID,
}

type ActivityRow = {
  id: string
  organizationId: string
  tenantId: string
  memberId: string
  activityType: string
  subject: string | null
  body: string | null
  occurredAt: Date | null
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
}

type ActivitySnapshot = ActivitySnapshotEnvelope<ActivityRow>

async function loadActivitySnapshot(em: EntityManager, id: string, scope?: StaffSnapshotScope | null): Promise<ActivitySnapshot | null> {
  const activity = await em.findOne(StaffTeamMemberActivity, scopedStaffSnapshotWhere(id, scope))
  if (!activity) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: ACTIVITY_ENTITY_ID,
    recordId: activity.id,
    tenantId: activity.tenantId,
    organizationId: activity.organizationId,
  })
  return {
    activity: {
      id: activity.id,
      organizationId: activity.organizationId,
      tenantId: activity.tenantId,
      memberId: typeof activity.member === 'string' ? activity.member : activity.member.id,
      activityType: activity.activityType,
      subject: activity.subject ?? null,
      body: activity.body ?? null,
      occurredAt: activity.occurredAt ?? null,
      authorUserId: activity.authorUserId ?? null,
      appearanceIcon: activity.appearanceIcon ?? null,
      appearanceColor: activity.appearanceColor ?? null,
    },
    custom,
  }
}

const activityCommands = makeActivityCommandSet<
  StaffTeamMemberActivity,
  ActivityRow,
  StaffTeamMemberActivityCreateInput,
  StaffTeamMemberActivityUpdateInput
>({
  commandIds: {
    create: 'staff.team-member-activities.create',
    update: 'staff.team-member-activities.update',
    delete: 'staff.team-member-activities.delete',
  },
  resourceKind: 'staff.team_member_activity',
  parentResourceKind: 'staff.teamMember',
  auditLabels: {
    create: ['staff.audit.teamMemberActivities.create', 'Create activity'],
    update: ['staff.audit.teamMemberActivities.update', 'Update activity'],
    delete: ['staff.audit.teamMemberActivities.delete', 'Delete activity'],
  },
  changeKeys: ['memberId', 'activityType', 'subject', 'body', 'occurredAt', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
  messages: {
    notFound: 'Activity not found',
    idRequired: 'Activity id required',
    redoUnavailable: '[internal] redo snapshot unavailable for activity create',
  },
  entityClass: StaffTeamMemberActivity,
  indexer: activityCrudIndexer,
  events: staffTeamMemberActivityCrudEvents,
  schemas: { create: staffTeamMemberActivityCreateSchema, update: staffTeamMemberActivityUpdateSchema },
  customFieldEntityId: ACTIVITY_ENTITY_ID,

  // Every staff snapshot read and row lookup carries tenant/org scope (#3977).
  loadSnapshot: (em, id, ctx) => loadActivitySnapshot(em, id, staffSnapshotScopeFromContext(ctx)),
  findRowForWrite: (em, id, ctx) =>
    em.findOne(StaffTeamMemberActivity, applyScopeToWhere<StaffTeamMemberActivity>({ id }, commandActorScope(ctx))),
  findRowForRestore: ({ em, id, row }) =>
    em.findOne(StaffTeamMemberActivity, scopedStaffSnapshotWhere(id, staffSnapshotScopeFromSnapshot(row))),
  createUndoTargetId: ({ logEntryResourceId, after }) => after?.activity.id ?? logEntryResourceId,

  seedFromSnapshot: (row) => ({
    id: row.id,
    organizationId: row.organizationId,
    tenantId: row.tenantId,
    activityType: row.activityType,
    subject: row.subject,
    body: row.body,
    occurredAt: row.occurredAt ?? null,
    authorUserId: row.authorUserId,
    appearanceIcon: row.appearanceIcon,
    appearanceColor: row.appearanceColor,
  }),
  assignFromSnapshot: (activity, row) => {
    activity.activityType = row.activityType
    activity.subject = row.subject
    activity.body = row.body
    activity.occurredAt = row.occurredAt ?? null
    activity.authorUserId = row.authorUserId
    activity.appearanceIcon = row.appearanceIcon
    activity.appearanceColor = row.appearanceColor
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
  resolveParentForRestore: async ({ em, row }) => ({
    member: await requireTeamMember(
      em,
      row.memberId,
      explicitStaffCommandScope(row.tenantId, row.organizationId),
      'Team member not found',
    ),
  }),
  resolveAuthorForCreate: ({ parsed, ctx }) => normalizeAuthorUserId(parsed.authorUserId, ctx.auth),

  buildCreateData: ({ parsed, relations, authorUserId }) => ({
    organizationId: parsed.organizationId,
    tenantId: parsed.tenantId,
    ...relations,
    activityType: parsed.activityType,
    subject: parsed.subject ?? null,
    body: parsed.body ?? null,
    occurredAt: parsed.occurredAt ?? null,
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
    if (parsed.activityType !== undefined) entity.activityType = parsed.activityType
    if (parsed.subject !== undefined) entity.subject = parsed.subject ?? null
    if (parsed.body !== undefined) entity.body = parsed.body ?? null
    if (parsed.occurredAt !== undefined) entity.occurredAt = parsed.occurredAt ?? null
    if (parsed.authorUserId !== undefined) entity.authorUserId = parsed.authorUserId ?? null
    if (parsed.appearanceIcon !== undefined) entity.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) entity.appearanceColor = parsed.appearanceColor ?? null
  },

  // A redo plain-sets the post-change values; undos rebuild `before`, clearing any key
  // the update had added.
  customFieldRestoreValues: ({ kind, before, after }) => {
    if (kind === 'create-redo') return after?.custom ?? {}
    if (kind === 'update-undo') return buildCustomFieldResetMap(before?.custom, after?.custom)
    return buildCustomFieldResetMap(before?.custom, undefined)
  },

  parentIdOf: (row) => row.memberId ?? null,
  ensureRowInScope: (ctx, activity) => {
    ensureTenantScope(ctx, activity.tenantId)
    ensureOrganizationScope(ctx, activity.organizationId)
  },
  buildResult: {
    create: (activity) => ({ activityId: activity.id, authorUserId: activity.authorUserId ?? null }),
    update: (activity) => ({ activityId: activity.id }),
    delete: (activity) => ({ activityId: activity.id }),
  },
})

registerCommand(activityCommands.create)
registerCommand(activityCommands.update)
registerCommand(activityCommands.delete)
