import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  loadCustomFieldSnapshot,
  diffCustomFieldChanges,
  buildCustomFieldResetMap,
  type CustomFieldChangeSet,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { reviveSnapshotDates } from '@open-mercato/shared/lib/commands/undo'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { reviveSnapshotDates } from '@open-mercato/shared/lib/commands/undo'
import { ResourcesResourceActivity } from '../data/entities'
import {
  resourcesResourceActivityCreateSchema,
  resourcesResourceActivityUpdateSchema,
  type ResourcesResourceActivityCreateInput,
  type ResourcesResourceActivityUpdateInput,
} from '../data/validators'
import { resourcesResourceActivityCrudEvents } from '../lib/crud'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload, requireResource, resolveResourceAuthorUserId } from './shared'
import { E } from '#generated/entities.ids.generated'

const ACTIVITY_ENTITY_ID = E.resources.resources_resource_activity
const activityCrudIndexer: CrudIndexerConfig<ResourcesResourceActivity> = {
  entityType: E.resources.resources_resource_activity,
}

type ActivitySnapshot = {
  activity: {
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
    createdAt?: Date
  }
  custom?: Record<string, unknown>
}

type ActivityUndoPayload = {
  before?: ActivitySnapshot | null
  after?: ActivitySnapshot | null
}

type ActivityChangeMap = Record<string, { from: unknown; to: unknown }> & {
  custom?: CustomFieldChangeSet
}

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
      createdAt: activity.createdAt,
    },
    custom,
  }
}

async function setActivityCustomFields(
  ctx: CommandRuntimeContext,
  activityId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>,
) {
  if (!values || !Object.keys(values).length) return
  const de = (ctx.container.resolve('dataEngine') as DataEngine)
  await setCustomFieldsIfAny({
    dataEngine: de,
    entityId: ACTIVITY_ENTITY_ID,
    recordId: activityId,
    organizationId,
    tenantId,
    values,
    notify: false,
  })
}

const createActivityCommand: CommandHandler<ResourcesResourceActivityCreateInput, { activityId: string; authorUserId: string | null }> = {
  id: 'resources.resource-activities.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(resourcesResourceActivityCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const resource = await requireResource(em, parsed.entityId, 'Resource not found')
    ensureTenantScope(ctx, resource.tenantId)
    ensureOrganizationScope(ctx, resource.organizationId)
    const normalizedAuthor = await resolveResourceAuthorUserId(em, parsed.authorUserId, ctx, {
      tenantId: resource.tenantId,
      organizationId: resource.organizationId,
    })

    const activity = em.create(ResourcesResourceActivity, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      resource,
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

    await setActivityCustomFields(ctx, activity.id, parsed.organizationId, parsed.tenantId, custom)

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
      events: resourcesResourceActivityCrudEvents,
      indexer: activityCrudIndexer,
    })

    return { activityId: activity.id, authorUserId: activity.authorUserId ?? null }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadActivitySnapshot(em, result.activityId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadActivitySnapshot(em, result.activityId)
    return {
      actionLabel: translate('resources.audit.resourceActivities.create', 'Create activity'),
      resourceKind: 'resources.resource_activity',
      resourceId: result.activityId,
      parentResourceKind: 'resources.resource',
      parentResourceId: snapshot?.activity?.resourceId ?? null,
      tenantId: snapshot?.activity.tenantId ?? null,
      organizationId: snapshot?.activity.organizationId ?? null,
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
    const existing = await findOneWithDecryption(em, ResourcesResourceActivity, {
      id: activityId,
      ...(ctx.auth?.tenantId ? { tenantId: ctx.auth.tenantId } : {}),
      ...(ctx.selectedOrganizationId ? { organizationId: ctx.selectedOrganizationId } : {}),
    }, undefined, { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null })
    if (existing) {
      ensureTenantScope(ctx, existing.tenantId)
      ensureOrganizationScope(ctx, existing.organizationId)
      existing.deletedAt = new Date()
      await em.flush()

      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'deleted',
        entity: existing,
        identifiers: {
          id: existing.id,
          organizationId: existing.organizationId,
          tenantId: existing.tenantId,
        },
        events: resourcesResourceActivityCrudEvents,
        indexer: activityCrudIndexer,
      })
    }
  },
  redo: async ({ logEntry, ctx }) => {
    const snapshot = resolveRedoSnapshot<ActivitySnapshot>(logEntry)
    if (!snapshot) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for activity create' })
    }
    const after = { ...snapshot, activity: reviveSnapshotDates(snapshot.activity, ['createdAt', 'occurredAt']) }
    const activitySnapshot = after.activity
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureTenantScope(ctx, activitySnapshot.tenantId)
    ensureOrganizationScope(ctx, activitySnapshot.organizationId)
    const resource = await requireResource(em, activitySnapshot.resourceId, 'Resource not found')
    ensureTenantScope(ctx, resource.tenantId)
    ensureOrganizationScope(ctx, resource.organizationId)
    let activity = await findOneWithDecryption(em, ResourcesResourceActivity, {
      id: activitySnapshot.id,
      tenantId: activitySnapshot.tenantId,
      organizationId: activitySnapshot.organizationId,
    }, undefined, { tenantId: activitySnapshot.tenantId, organizationId: activitySnapshot.organizationId })
    if (activity) {
      ensureTenantScope(ctx, activity.tenantId)
      ensureOrganizationScope(ctx, activity.organizationId)
    }
    if (!activity) {
      activity = em.create(ResourcesResourceActivity, {
        id: activitySnapshot.id,
        organizationId: activitySnapshot.organizationId,
        tenantId: activitySnapshot.tenantId,
        resource,
        activityType: activitySnapshot.activityType,
        subject: activitySnapshot.subject,
        body: activitySnapshot.body,
        occurredAt: activitySnapshot.occurredAt,
        authorUserId: activitySnapshot.authorUserId,
        appearanceIcon: activitySnapshot.appearanceIcon,
        appearanceColor: activitySnapshot.appearanceColor,
        createdAt: activitySnapshot.createdAt ?? new Date(),
        updatedAt: new Date(),
      })
      em.persist(activity)
    } else {
      activity.resource = resource
      activity.activityType = activitySnapshot.activityType
      activity.subject = activitySnapshot.subject
      activity.body = activitySnapshot.body
      activity.occurredAt = activitySnapshot.occurredAt
      activity.authorUserId = activitySnapshot.authorUserId
      activity.appearanceIcon = activitySnapshot.appearanceIcon
      activity.appearanceColor = activitySnapshot.appearanceColor
    }
    activity.deletedAt = null
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
      events: resourcesResourceActivityCrudEvents,
      indexer: activityCrudIndexer,
    })

    const resetValues = buildCustomFieldResetMap(after.custom, undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: ACTIVITY_ENTITY_ID,
        recordId: activity.id,
        organizationId: activity.organizationId,
        tenantId: activity.tenantId,
        values: resetValues,
        notify: false,
      })
    }

    return { activityId: activity.id, authorUserId: activity.authorUserId ?? null }
  },
}

const updateActivityCommand: CommandHandler<ResourcesResourceActivityUpdateInput, { activityId: string }> = {
  id: 'resources.resource-activities.update',
  async prepare(rawInput, ctx) {
    const parsed = resourcesResourceActivityUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadActivitySnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(resourcesResourceActivityUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const activity = await em.findOne(ResourcesResourceActivity, { id: parsed.id })
    if (!activity) throw new CrudHttpError(404, { error: 'Activity not found' })
    ensureTenantScope(ctx, activity.tenantId)
    ensureOrganizationScope(ctx, activity.organizationId)

    if (parsed.entityId !== undefined) {
      const resource = await requireResource(em, parsed.entityId, 'Resource not found')
      ensureTenantScope(ctx, resource.tenantId)
      ensureOrganizationScope(ctx, resource.organizationId)
      activity.resource = resource
    }
    if (parsed.activityType !== undefined) activity.activityType = parsed.activityType
    if (parsed.subject !== undefined) activity.subject = parsed.subject ?? null
    if (parsed.body !== undefined) activity.body = parsed.body ?? null
    if (parsed.occurredAt !== undefined) activity.occurredAt = parsed.occurredAt ?? null
    if (parsed.appearanceIcon !== undefined) activity.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) activity.appearanceColor = parsed.appearanceColor ?? null

    await em.flush()

    await setActivityCustomFields(ctx, activity.id, activity.organizationId, activity.tenantId, custom)

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
      events: resourcesResourceActivityCrudEvents,
      indexer: activityCrudIndexer,
    })

    return { activityId: activity.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as ActivitySnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const afterSnapshot = await loadActivitySnapshot(em, before.activity.id)
    const changes: ActivityChangeMap =
      afterSnapshot && afterSnapshot.activity
        ? buildChanges(
            before.activity as Record<string, unknown>,
            afterSnapshot.activity as Record<string, unknown>,
            ['resourceId', 'activityType', 'subject', 'body', 'occurredAt', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
          )
        : {}
    const customChanges = diffCustomFieldChanges(before.custom, afterSnapshot?.custom)
    if (Object.keys(customChanges).length) changes.custom = customChanges
    return {
      actionLabel: translate('resources.audit.resourceActivities.update', 'Update activity'),
      resourceKind: 'resources.resource_activity',
      resourceId: before.activity.id,
      parentResourceKind: 'resources.resource',
      parentResourceId: before.activity.resourceId ?? null,
      tenantId: before.activity.tenantId,
      organizationId: before.activity.organizationId,
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
    const payload = extractUndoPayload<ActivityUndoPayload>(logEntry, { datePaths: ['before.activity.occurredAt', 'before.activity.createdAt'] })
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let activity = await em.findOne(ResourcesResourceActivity, { id: before.activity.id })
    const resource = await requireResource(em, before.activity.resourceId, 'Resource not found')

    if (!activity) {
      activity = em.create(ResourcesResourceActivity, {
        id: before.activity.id,
        organizationId: before.activity.organizationId,
        tenantId: before.activity.tenantId,
        resource,
        activityType: before.activity.activityType,
        subject: before.activity.subject,
        body: before.activity.body,
        occurredAt: before.activity.occurredAt,
        authorUserId: before.activity.authorUserId,
        appearanceIcon: before.activity.appearanceIcon,
        appearanceColor: before.activity.appearanceColor,
        createdAt: before.activity.createdAt ?? new Date(),
        updatedAt: new Date(),
      })
      em.persist(activity)
    } else {
      activity.resource = resource
      activity.activityType = before.activity.activityType
      activity.subject = before.activity.subject
      activity.body = before.activity.body
      activity.occurredAt = before.activity.occurredAt
      activity.authorUserId = before.activity.authorUserId
      activity.appearanceIcon = before.activity.appearanceIcon
      activity.appearanceColor = before.activity.appearanceColor
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
      events: resourcesResourceActivityCrudEvents,
      indexer: activityCrudIndexer,
    })

    const resetValues = buildCustomFieldResetMap(before.custom, payload?.after?.custom)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: ACTIVITY_ENTITY_ID,
        recordId: activity.id,
        organizationId: activity.organizationId,
        tenantId: activity.tenantId,
        values: resetValues,
        notify: false,
      })
    }
  },
}

const deleteActivityCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { activityId: string }> = {
  id: 'resources.resource-activities.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Activity id required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadActivitySnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Activity id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const activity = await em.findOne(ResourcesResourceActivity, { id })
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
      events: resourcesResourceActivityCrudEvents,
      indexer: activityCrudIndexer,
    })
    return { activityId: activity.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ActivitySnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.resourceActivities.delete', 'Delete activity'),
      resourceKind: 'resources.resource_activity',
      resourceId: before.activity.id,
      parentResourceKind: 'resources.resource',
      parentResourceId: before.activity.resourceId ?? null,
      tenantId: before.activity.tenantId,
      organizationId: before.activity.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies ActivityUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ActivityUndoPayload>(logEntry, { datePaths: ['before.activity.occurredAt', 'before.activity.createdAt'] })
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const resource = await requireResource(em, before.activity.resourceId, 'Resource not found')
    let activity = await em.findOne(ResourcesResourceActivity, { id: before.activity.id })
    if (!activity) {
      activity = em.create(ResourcesResourceActivity, {
        id: before.activity.id,
        organizationId: before.activity.organizationId,
        tenantId: before.activity.tenantId,
        resource,
        activityType: before.activity.activityType,
        subject: before.activity.subject,
        body: before.activity.body,
        occurredAt: before.activity.occurredAt,
        authorUserId: before.activity.authorUserId,
        appearanceIcon: before.activity.appearanceIcon,
        appearanceColor: before.activity.appearanceColor,
        createdAt: before.activity.createdAt ?? new Date(),
        updatedAt: new Date(),
      })
      em.persist(activity)
    } else {
      activity.resource = resource
      activity.activityType = before.activity.activityType
      activity.subject = before.activity.subject
      activity.body = before.activity.body
      activity.occurredAt = before.activity.occurredAt
      activity.authorUserId = before.activity.authorUserId
      activity.appearanceIcon = before.activity.appearanceIcon
      activity.appearanceColor = before.activity.appearanceColor
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
      events: resourcesResourceActivityCrudEvents,
      indexer: activityCrudIndexer,
    })

    const resetValues = buildCustomFieldResetMap(before.custom, undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: ACTIVITY_ENTITY_ID,
        recordId: activity.id,
        organizationId: activity.organizationId,
        tenantId: activity.tenantId,
        values: resetValues,
        notify: false,
      })
    }
  },
}

registerCommand(createActivityCommand)
registerCommand(updateActivityCommand)
registerCommand(deleteActivityCommand)
