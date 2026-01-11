import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { buildCustomFieldResetMap, diffCustomFieldChanges, loadCustomFieldSnapshot, type CustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { BookingResource, BookingResourceType } from '../data/entities'
import {
  bookingResourceTypeCreateSchema,
  bookingResourceTypeUpdateSchema,
  type BookingResourceTypeCreateInput,
  type BookingResourceTypeUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { E } from '@/generated/entities.ids.generated'

type ResourceTypeSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  description: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  deletedAt: string | null
}

type ResourceTypeUndoPayload = {
  before?: ResourceTypeSnapshot | null
  after?: ResourceTypeSnapshot | null
  customBefore?: CustomFieldSnapshot | null
  customAfter?: CustomFieldSnapshot | null
}

async function loadResourceTypeSnapshot(em: EntityManager, id: string): Promise<ResourceTypeSnapshot | null> {
  const resourceType = await findOneWithDecryption(
    em,
    BookingResourceType,
    { id },
    undefined,
    { tenantId: null, organizationId: null },
  )
  if (!resourceType) return null
  return {
    id: resourceType.id,
    tenantId: resourceType.tenantId,
    organizationId: resourceType.organizationId,
    name: resourceType.name,
    description: resourceType.description ?? null,
    appearanceIcon: resourceType.appearanceIcon ?? null,
    appearanceColor: resourceType.appearanceColor ?? null,
    deletedAt: resourceType.deletedAt ? resourceType.deletedAt.toISOString() : null,
  }
}

async function loadResourceTypeCustomSnapshot(em: EntityManager, snapshot: ResourceTypeSnapshot): Promise<CustomFieldSnapshot> {
  return loadCustomFieldSnapshot(em, {
    entityId: E.booking.booking_resource_type,
    recordId: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
  })
}

const createResourceTypeCommand: CommandHandler<BookingResourceTypeCreateInput, { resourceTypeId: string }> = {
  id: 'booking.resourceTypes.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(bookingResourceTypeCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(BookingResourceType, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      description: parsed.description ?? null,
      appearanceIcon: parsed.appearanceIcon ?? null,
      appearanceColor: parsed.appearanceColor ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.booking.booking_resource_type,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
    })
    return { resourceTypeId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceTypeSnapshot(em, result.resourceTypeId)
    if (!snapshot) return null
    const custom = await loadResourceTypeCustomSnapshot(em, snapshot)
    return { snapshot, custom }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceTypeSnapshot(em, result.resourceTypeId)
    if (!snapshot) return null
    const custom = await loadResourceTypeCustomSnapshot(em, snapshot)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.resourceTypes.create', 'Create resource type'),
      resourceKind: 'booking.resourceType',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
          customAfter: custom,
        } satisfies ResourceTypeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceTypeUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const resourceType = await em.findOne(BookingResourceType, { id: after.id })
    if (resourceType) {
      resourceType.deletedAt = new Date()
      resourceType.updatedAt = new Date()
      await em.flush()
    }
  },
}

const updateResourceTypeCommand: CommandHandler<BookingResourceTypeUpdateInput, { resourceTypeId: string }> = {
  id: 'booking.resourceTypes.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(bookingResourceTypeUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceTypeSnapshot(em, parsed.id)
    if (!snapshot) return {}
    const custom = await loadResourceTypeCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(bookingResourceTypeUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      BookingResourceType,
      { id: parsed.id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Booking resource type not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.appearanceIcon !== undefined) record.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) record.appearanceColor = parsed.appearanceColor ?? null
    record.updatedAt = new Date()

    await em.flush()
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.booking.booking_resource_type,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
    })
    return { resourceTypeId: record.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as ResourceTypeSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadResourceTypeSnapshot(em, before.id)
    if (!after) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const customAfter = await loadResourceTypeCustomSnapshot(em, after)
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'name',
      'description',
      'appearanceIcon',
      'appearanceColor',
      'deletedAt',
    ])
    const customChanges = diffCustomFieldChanges(customBefore, customAfter)
    if (Object.keys(customChanges).length) {
      changes.customFields = { from: customBefore ?? null, to: customAfter ?? null }
    }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.resourceTypes.update', 'Update resource type'),
      resourceKind: 'booking.resourceType',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: {
          before,
          after,
          customBefore: customBefore ?? null,
          customAfter,
        } satisfies ResourceTypeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceTypeUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const resourceType = await em.findOne(BookingResourceType, { id: before.id })
    if (!resourceType) return
    resourceType.name = before.name
    resourceType.description = before.description ?? null
    resourceType.appearanceIcon = before.appearanceIcon ?? null
    resourceType.appearanceColor = before.appearanceColor ?? null
    resourceType.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    resourceType.updatedAt = new Date()
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    if (payload.customBefore || payload.customAfter) {
      const reset = buildCustomFieldResetMap(payload.customBefore ?? undefined, payload.customAfter ?? undefined)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.booking.booking_resource_type,
        recordId: resourceType.id,
        tenantId: resourceType.tenantId,
        organizationId: resourceType.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: resourceType,
      identifiers: {
        id: resourceType.id,
        organizationId: resourceType.organizationId,
        tenantId: resourceType.tenantId,
      },
    })
  },
}

const deleteResourceTypeCommand: CommandHandler<{ id?: string }, { resourceTypeId: string }> = {
  id: 'booking.resourceTypes.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Resource type id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceTypeSnapshot(em, id)
    if (!snapshot) return {}
    const custom = await loadResourceTypeCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Resource type id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      BookingResourceType,
      { id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Booking resource type not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const assignedCount = await em.count(BookingResource, {
      resourceTypeId: record.id,
      deletedAt: null,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
    })
    if (assignedCount > 0) {
      throw new CrudHttpError(400, { error: 'Resource type has assigned resources.' })
    }
    record.deletedAt = new Date()
    record.updatedAt = new Date()
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
    })
    return { resourceTypeId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ResourceTypeSnapshot | undefined
    if (!before) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.resourceTypes.delete', 'Delete resource type'),
      resourceKind: 'booking.resourceType',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
          customBefore: customBefore ?? null,
        } satisfies ResourceTypeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceTypeUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let resourceType = await em.findOne(BookingResourceType, { id: before.id })
    if (!resourceType) {
      resourceType = em.create(BookingResourceType, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        name: before.name,
        description: before.description ?? null,
        appearanceIcon: before.appearanceIcon ?? null,
        appearanceColor: before.appearanceColor ?? null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(resourceType)
    } else {
      resourceType.name = before.name
      resourceType.description = before.description ?? null
      resourceType.appearanceIcon = before.appearanceIcon ?? null
      resourceType.appearanceColor = before.appearanceColor ?? null
      resourceType.deletedAt = null
      resourceType.updatedAt = new Date()
    }
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    if (payload.customBefore) {
      const reset = buildCustomFieldResetMap(payload.customBefore, undefined)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.booking.booking_resource_type,
        recordId: resourceType.id,
        tenantId: resourceType.tenantId,
        organizationId: resourceType.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: resourceType,
      identifiers: {
        id: resourceType.id,
        organizationId: resourceType.organizationId,
        tenantId: resourceType.tenantId,
      },
    })
  },
}

registerCommand(createResourceTypeCommand)
registerCommand(updateResourceTypeCommand)
registerCommand(deleteResourceTypeCommand)
