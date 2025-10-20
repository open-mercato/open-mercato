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
import { CustomerActivity, CustomerDeal } from '../data/entities'
import {
  activityCreateSchema,
  activityUpdateSchema,
  type ActivityCreateInput,
  type ActivityUpdateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  requireCustomerEntity,
  ensureSameScope,
  extractUndoPayload,
  requireDealInScope,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  loadCustomFieldSnapshot,
  diffCustomFieldChanges,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const ACTIVITY_ENTITY_ID = 'customers:customer_activity'

type ActivitySnapshot = {
  activity: {
    id: string
    organizationId: string
    tenantId: string
    entityId: string
    dealId: string | null
    activityType: string
    subject: string | null
    body: string | null
    occurredAt: Date | null
    authorUserId: string | null
    appearanceIcon: string | null
    appearanceColor: string | null
  }
  custom?: Record<string, unknown>
}

type ActivityUndoPayload = {
  before?: ActivitySnapshot | null
  after?: ActivitySnapshot | null
}

async function loadActivitySnapshot(em: EntityManager, id: string): Promise<ActivitySnapshot | null> {
  const activity = await em.findOne(CustomerActivity, { id })
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
      entityId: typeof activity.entity === 'string' ? activity.entity : activity.entity.id,
      dealId: activity.deal ? (typeof activity.deal === 'string' ? activity.deal : activity.deal.id) : null,
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

async function setActivityCustomFields(
  ctx: CommandRuntimeContext,
  activityId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>
) {
  if (!values || !Object.keys(values).length) return
  const de = ctx.container.resolve<DataEngine>('dataEngine')
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

const createActivityCommand: CommandHandler<ActivityCreateInput, { activityId: string }> = {
  id: 'customers.activities.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(activityCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const entity = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)
    const deal = await requireDealInScope(em, parsed.dealId, parsed.tenantId, parsed.organizationId)

    const activity = em.create(CustomerActivity, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      entity,
      deal,
      activityType: parsed.activityType,
      subject: parsed.subject ?? null,
      body: parsed.body ?? null,
      occurredAt: parsed.occurredAt ?? null,
      authorUserId: parsed.authorUserId ?? null,
      appearanceIcon: parsed.appearanceIcon ?? null,
      appearanceColor: parsed.appearanceColor ?? null,
    })
    em.persist(activity)
    await em.flush()

    await setActivityCustomFields(ctx, activity.id, parsed.organizationId, parsed.tenantId, custom)

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: activity,
      identifiers: {
        id: activity.id,
        organizationId: activity.organizationId,
        tenantId: activity.tenantId,
      },
    })

    return { activityId: activity.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return await loadActivitySnapshot(em, result.activityId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadActivitySnapshot(em, result.activityId)
    return {
      actionLabel: translate('customers.audit.activities.create', 'Create activity'),
      resourceKind: 'customers.activity',
      resourceId: result.activityId,
      tenantId: snapshot?.activity.tenantId ?? null,
      organizationId: snapshot?.activity.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot,
        } satisfies ActivityUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const activityId = logEntry?.resourceId
    if (!activityId) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(CustomerActivity, { id: activityId })
    if (!record) return
    em.remove(record)
    await em.flush()
  },
}

const updateActivityCommand: CommandHandler<ActivityUpdateInput, { activityId: string }> = {
  id: 'customers.activities.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(activityUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadActivitySnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(activityUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const activity = await em.findOne(CustomerActivity, { id: parsed.id })
    if (!activity) throw new CrudHttpError(404, { error: 'Activity not found' })
    ensureTenantScope(ctx, activity.tenantId)
    ensureOrganizationScope(ctx, activity.organizationId)

    if (parsed.entityId !== undefined) {
      const target = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
      ensureSameScope(target, activity.organizationId, activity.tenantId)
      activity.entity = target
    }
    if (parsed.dealId !== undefined) {
      activity.deal = await requireDealInScope(em, parsed.dealId, activity.tenantId, activity.organizationId)
    }
    if (parsed.activityType !== undefined) activity.activityType = parsed.activityType
    if (parsed.subject !== undefined) activity.subject = parsed.subject ?? null
    if (parsed.body !== undefined) activity.body = parsed.body ?? null
    if (parsed.occurredAt !== undefined) activity.occurredAt = parsed.occurredAt ?? null
    if (parsed.authorUserId !== undefined) activity.authorUserId = parsed.authorUserId ?? null
    if (parsed.appearanceIcon !== undefined) activity.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) activity.appearanceColor = parsed.appearanceColor ?? null

    await em.flush()

    await setActivityCustomFields(ctx, activity.id, activity.organizationId, activity.tenantId, custom)

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: activity,
      identifiers: {
        id: activity.id,
        organizationId: activity.organizationId,
        tenantId: activity.tenantId,
      },
    })

    return { activityId: activity.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as ActivitySnapshot | undefined
    if (!before) return null
    const em = ctx.container.resolve<EntityManager>('em')
    const afterSnapshot = await loadActivitySnapshot(em, before.activity.id)
    const changeKeys: readonly string[] = [
      'entityId',
      'dealId',
      'activityType',
      'subject',
      'body',
      'occurredAt',
      'authorUserId',
      'appearanceIcon',
      'appearanceColor',
    ]
    const changes =
      afterSnapshot && afterSnapshot.activity
        ? buildChanges(
            before.activity as Record<string, unknown>,
            afterSnapshot.activity as Record<string, unknown>,
            changeKeys
          )
        : {}
    const customChanges = diffCustomFieldChanges(before.custom, afterSnapshot?.custom)
    if (Object.keys(customChanges).length) changes.custom = customChanges
    return {
      actionLabel: translate('customers.audit.activities.update', 'Update activity'),
      resourceKind: 'customers.activity',
      resourceId: before.activity.id,
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
    const payload = extractUndoPayload<ActivityUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let activity = await em.findOne(CustomerActivity, { id: before.activity.id })
    const entity = await requireCustomerEntity(em, before.activity.entityId, undefined, 'Customer not found')
    const deal = await requireDealInScope(em, before.activity.dealId, before.activity.tenantId, before.activity.organizationId)

    if (!activity) {
      activity = em.create(CustomerActivity, {
        id: before.activity.id,
        organizationId: before.activity.organizationId,
        tenantId: before.activity.tenantId,
        entity,
        deal,
        activityType: before.activity.activityType,
        subject: before.activity.subject,
        body: before.activity.body,
        occurredAt: before.activity.occurredAt,
        authorUserId: before.activity.authorUserId,
      })
      em.persist(activity)
    } else {
      activity.entity = entity
      activity.deal = deal
      activity.activityType = before.activity.activityType
      activity.subject = before.activity.subject
      activity.body = before.activity.body
      activity.occurredAt = before.activity.occurredAt
      activity.authorUserId = before.activity.authorUserId
    }

    await em.flush()

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: activity,
      identifiers: {
        id: activity.id,
        organizationId: activity.organizationId,
        tenantId: activity.tenantId,
      },
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

const deleteActivityCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { activityId: string }> =
  {
    id: 'customers.activities.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Activity id required')
      const em = ctx.container.resolve<EntityManager>('em')
      const snapshot = await loadActivitySnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Activity id required')
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const activity = await em.findOne(CustomerActivity, { id })
      if (!activity) throw new CrudHttpError(404, { error: 'Activity not found' })
      ensureTenantScope(ctx, activity.tenantId)
      ensureOrganizationScope(ctx, activity.organizationId)
      em.remove(activity)
      await em.flush()

      const de = ctx.container.resolve<DataEngine>('dataEngine')
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: activity,
        identifiers: {
          id: activity.id,
          organizationId: activity.organizationId,
          tenantId: activity.tenantId,
        },
      })
      return { activityId: activity.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as ActivitySnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.activities.delete', 'Delete activity'),
        resourceKind: 'customers.activity',
        resourceId: before.activity.id,
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
      const payload = extractUndoPayload<ActivityUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const entity = await requireCustomerEntity(em, before.activity.entityId, undefined, 'Customer not found')
      const deal = await requireDealInScope(em, before.activity.dealId, before.activity.tenantId, before.activity.organizationId)
      let activity = await em.findOne(CustomerActivity, { id: before.activity.id })
      if (!activity) {
        activity = em.create(CustomerActivity, {
          id: before.activity.id,
          organizationId: before.activity.organizationId,
          tenantId: before.activity.tenantId,
          entity,
          deal,
          activityType: before.activity.activityType,
          subject: before.activity.subject,
          body: before.activity.body,
          occurredAt: before.activity.occurredAt,
          authorUserId: before.activity.authorUserId,
        })
        em.persist(activity)
      } else {
        activity.entity = entity
        activity.deal = deal
        activity.activityType = before.activity.activityType
        activity.subject = before.activity.subject
        activity.body = before.activity.body
        activity.occurredAt = before.activity.occurredAt
        activity.authorUserId = before.activity.authorUserId
      }
      await em.flush()

      const de = ctx.container.resolve<DataEngine>('dataEngine')
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity: activity,
        identifiers: {
          id: activity.id,
          organizationId: activity.organizationId,
          tenantId: activity.tenantId,
        },
      })

      const resetValues = buildCustomFieldResetMap(before.custom, null)
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
