import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { makeActivityCommandSet, type ActivitySnapshotEnvelope } from '@open-mercato/shared/lib/commands/timeline'
import { ResourcesResourceActivity } from '../data/entities'
import {
  resourcesResourceActivityCreateSchema,
  resourcesResourceActivityUpdateSchema,
  type ResourcesResourceActivityCreateInput,
  type ResourcesResourceActivityUpdateInput,
} from '../data/validators'
import { resourcesResourceActivityCrudEvents } from '../lib/crud'
import { ensureOrganizationScope, ensureTenantScope, requireResource, resolveResourceAuthorUserId } from './shared'
import { E } from '#generated/entities.ids.generated'

const ACTIVITY_ENTITY_ID = E.resources.resources_resource_activity

const activityCrudIndexer: CrudIndexerConfig<ResourcesResourceActivity> = {
  entityType: ACTIVITY_ENTITY_ID,
}

type ActivityRow = {
  id: string
  organizationId: string
  tenantId: string
  resourceId: string
  activityType: string
  subject: string | null
  body: string | null
  occurredAt: Date | null
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
}

type ActivitySnapshot = ActivitySnapshotEnvelope<ActivityRow>

async function loadActivitySnapshot(em: EntityManager, id: string): Promise<ActivitySnapshot | null> {
  const activity = await em.findOne(ResourcesResourceActivity, { id })
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
      resourceId: typeof activity.resource === 'string' ? activity.resource : activity.resource.id,
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
  ResourcesResourceActivity,
  ActivityRow,
  ResourcesResourceActivityCreateInput,
  ResourcesResourceActivityUpdateInput
>({
  commandIds: {
    create: 'resources.resource-activities.create',
    update: 'resources.resource-activities.update',
    delete: 'resources.resource-activities.delete',
  },
  resourceKind: 'resources.resource_activity',
  parentResourceKind: 'resources.resource',
  auditLabels: {
    create: ['resources.audit.resourceActivities.create', 'Create activity'],
    update: ['resources.audit.resourceActivities.update', 'Update activity'],
    delete: ['resources.audit.resourceActivities.delete', 'Delete activity'],
  },
  changeKeys: ['resourceId', 'activityType', 'subject', 'body', 'occurredAt', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
  messages: {
    notFound: 'Activity not found',
    idRequired: 'Activity id required',
    redoUnavailable: '[internal] redo snapshot unavailable for activity create',
  },
  entityClass: ResourcesResourceActivity,
  indexer: activityCrudIndexer,
  events: resourcesResourceActivityCrudEvents,
  schemas: { create: resourcesResourceActivityCreateSchema, update: resourcesResourceActivityUpdateSchema },
  customFieldEntityId: ACTIVITY_ENTITY_ID,

  loadSnapshot: (em, id) => loadActivitySnapshot(em, id),
  findRowForWrite: (em, id) => em.findOne(ResourcesResourceActivity, { id }),
  findRowForRestore: ({ em, id }) => em.findOne(ResourcesResourceActivity, { id }),
  createUndoTargetId: ({ logEntryResourceId }) => logEntryResourceId,

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
    const resource = await requireResource(em, parsed.entityId, 'Resource not found')
    ensureTenantScope(ctx, resource.tenantId)
    ensureOrganizationScope(ctx, resource.organizationId)
    return {
      relations: { resource },
      scope: { tenantId: resource.tenantId, organizationId: resource.organizationId },
    }
  },
  resolveParentForRestore: async ({ em, row }) => ({
    resource: await requireResource(em, row.resourceId, 'Resource not found'),
  }),
  resolveAuthorForCreate: ({ em, parsed, ctx, parentScope }) =>
    resolveResourceAuthorUserId(em, parsed.authorUserId, ctx, parentScope),

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
  // No `authorUserId` branch here: per #4012 a resource activity keeps its original
  // author on update even when one is supplied.
  applyUpdateFields: async ({ em, ctx, entity, parsed }) => {
    if (parsed.entityId !== undefined) {
      const resource = await requireResource(em, parsed.entityId, 'Resource not found')
      ensureTenantScope(ctx, resource.tenantId)
      ensureOrganizationScope(ctx, resource.organizationId)
      entity.resource = resource
    }
    if (parsed.activityType !== undefined) entity.activityType = parsed.activityType
    if (parsed.subject !== undefined) entity.subject = parsed.subject ?? null
    if (parsed.body !== undefined) entity.body = parsed.body ?? null
    if (parsed.occurredAt !== undefined) entity.occurredAt = parsed.occurredAt ?? null
    if (parsed.appearanceIcon !== undefined) entity.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) entity.appearanceColor = parsed.appearanceColor ?? null
  },

  // A redo rebuilds `after` through the reset map so array-valued fields normalize;
  // undos rebuild `before`, clearing any key the update had added.
  customFieldRestoreValues: ({ kind, before, after }) => {
    if (kind === 'create-redo') return buildCustomFieldResetMap(after?.custom, undefined)
    if (kind === 'update-undo') return buildCustomFieldResetMap(before?.custom, after?.custom)
    return buildCustomFieldResetMap(before?.custom, undefined)
  },

  parentIdOf: (row) => row.resourceId ?? null,
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
