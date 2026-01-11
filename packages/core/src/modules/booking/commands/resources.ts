import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { buildCustomFieldResetMap, diffCustomFieldChanges, loadCustomFieldSnapshot, type CustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { BookingResource, BookingResourceTag, BookingResourceTagAssignment } from '../data/entities'
import {
  bookingResourceCreateSchema,
  bookingResourceUpdateSchema,
  type BookingResourceCreateInput,
  type BookingResourceUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from '../lib/capacityUnits'
import { E } from '@/generated/entities.ids.generated'

type CapacityUnitSnapshot = {
  value: string
  name: string
  color: string | null
  icon: string | null
}

type ResourceSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  description: string | null
  resourceTypeId: string | null
  capacity: number | null
  capacityUnitValue: string | null
  capacityUnitName: string | null
  capacityUnitColor: string | null
  capacityUnitIcon: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  isActive: boolean
  availabilityRuleSetId: string | null
  tags: string[]
  deletedAt: string | null
}

type ResourceUndoPayload = {
  before?: ResourceSnapshot | null
  after?: ResourceSnapshot | null
  customBefore?: CustomFieldSnapshot | null
  customAfter?: CustomFieldSnapshot | null
}

async function resolveCapacityUnit(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  rawValue: string,
): Promise<CapacityUnitSnapshot> {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    throw new CrudHttpError(400, { error: 'Capacity unit is required.' })
  }
  const dictionary = await findOneWithDecryption(
    em,
    Dictionary,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      key: BOOKING_CAPACITY_UNIT_DICTIONARY_KEY,
      deletedAt: null,
      isActive: true,
    },
    undefined,
    scope,
  )
  if (!dictionary) {
    throw new CrudHttpError(400, { error: 'Capacity unit dictionary is not configured.' })
  }
  const normalizedValue = trimmed.toLowerCase()
  const entry = await findOneWithDecryption(
    em,
    DictionaryEntry,
    {
      dictionary,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      normalizedValue,
    },
    { populate: ['dictionary'] },
    scope,
  )
  if (!entry) {
    throw new CrudHttpError(400, { error: 'Capacity unit not found.' })
  }
  return {
    value: entry.value,
    name: entry.label?.trim().length ? entry.label : entry.value,
    color: entry.color ?? null,
    icon: entry.icon ?? null,
  }
}

function normalizeTagIds(tags?: Array<string | null | undefined>): string[] {
  if (!Array.isArray(tags)) return []
  const set = new Set<string>()
  tags.forEach((id) => {
    if (typeof id === 'string' && id.trim().length > 0) set.add(id.trim())
  })
  return Array.from(set)
}

async function loadResourceSnapshot(em: EntityManager, id: string): Promise<ResourceSnapshot | null> {
  const resource = await findOneWithDecryption(
    em,
    BookingResource,
    { id },
    undefined,
    { tenantId: null, organizationId: null },
  )
  if (!resource) return null
  const assignments = await em.find(
    BookingResourceTagAssignment,
    { resource: resource.id },
    { populate: ['tag'] },
  )
  const tags = assignments
    .map((assignment) => (assignment.tag as BookingResourceTag | undefined)?.id ?? null)
    .filter((tagId): tagId is string => typeof tagId === 'string' && tagId.length > 0)
    .sort()
  return {
    id: resource.id,
    tenantId: resource.tenantId,
    organizationId: resource.organizationId,
    name: resource.name,
    description: resource.description ?? null,
    resourceTypeId: resource.resourceTypeId ?? null,
    capacity: resource.capacity ?? null,
    capacityUnitValue: resource.capacityUnitValue ?? null,
    capacityUnitName: resource.capacityUnitName ?? null,
    capacityUnitColor: resource.capacityUnitColor ?? null,
    capacityUnitIcon: resource.capacityUnitIcon ?? null,
    appearanceIcon: resource.appearanceIcon ?? null,
    appearanceColor: resource.appearanceColor ?? null,
    isActive: resource.isActive,
    availabilityRuleSetId: resource.availabilityRuleSetId ?? null,
    tags,
    deletedAt: resource.deletedAt ? resource.deletedAt.toISOString() : null,
  }
}

async function loadResourceCustomSnapshot(em: EntityManager, snapshot: ResourceSnapshot): Promise<CustomFieldSnapshot> {
  return loadCustomFieldSnapshot(em, {
    entityId: E.booking.booking_resource,
    recordId: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
  })
}

async function syncBookingResourceTags(em: EntityManager, params: {
  resourceId: string
  organizationId: string
  tenantId: string
  tagIds?: Array<string | null | undefined> | null
}) {
  if (params.tagIds === undefined) return
  const tagIds = normalizeTagIds(params.tagIds ?? [])
  if (tagIds.length === 0) {
    await em.nativeDelete(BookingResourceTagAssignment, { resource: params.resourceId })
    return
  }
  const tagsInScope = await em.find(BookingResourceTag, {
    id: { $in: tagIds },
    organizationId: params.organizationId,
    tenantId: params.tenantId,
  })
  if (tagsInScope.length !== tagIds.length) {
    throw new CrudHttpError(400, { error: 'One or more tags not found for this scope' })
  }
  const byId = new Map(tagsInScope.map((tag) => [tag.id, tag]))
  await em.nativeDelete(BookingResourceTagAssignment, { resource: params.resourceId })
  const resource = em.getReference(BookingResource, params.resourceId)
  for (const tagId of tagIds) {
    const tag = byId.get(tagId)
    if (!tag) continue
    const assignment = em.create(BookingResourceTagAssignment, {
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      resource,
      tag,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(assignment)
  }
}

const createResourceCommand: CommandHandler<BookingResourceCreateInput, { resourceId: string }> = {
  id: 'booking.resources.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(bookingResourceCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const unitValue =
      typeof parsed.capacityUnitValue === 'string' ? parsed.capacityUnitValue.trim() : ''
    const unitSnapshot = unitValue
      ? await resolveCapacityUnit(em, { tenantId: parsed.tenantId, organizationId: parsed.organizationId }, unitValue)
      : null
    const record = em.create(BookingResource, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      description: parsed.description ?? null,
      resourceTypeId: parsed.resourceTypeId ?? null,
      capacity: parsed.capacity ?? null,
      capacityUnitValue: unitSnapshot?.value ?? null,
      capacityUnitName: unitSnapshot?.name ?? null,
      capacityUnitColor: unitSnapshot?.color ?? null,
      capacityUnitIcon: unitSnapshot?.icon ?? null,
      appearanceIcon: parsed.appearanceIcon ?? null,
      appearanceColor: parsed.appearanceColor ?? null,
      isActive: parsed.isActive ?? true,
      availabilityRuleSetId: parsed.availabilityRuleSetId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.booking.booking_resource,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    })
    await syncBookingResourceTags(em, {
      resourceId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      tagIds: parsed.tags,
    })
    await em.flush()
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
    return { resourceId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceSnapshot(em, result.resourceId)
    if (!snapshot) return null
    const custom = await loadResourceCustomSnapshot(em, snapshot)
    return { snapshot, custom }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceSnapshot(em, result?.resourceId ?? '')
    if (!snapshot) return null
    const custom = await loadResourceCustomSnapshot(em, snapshot)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.resources.create', 'Create resource'),
      resourceKind: 'booking.resource',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
          customAfter: custom,
        } satisfies ResourceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BookingResource, { id: after.id })
    if (record) {
      record.deletedAt = new Date()
      record.updatedAt = new Date()
      await em.flush()
    }
  },
}

const updateResourceCommand: CommandHandler<BookingResourceUpdateInput, { resourceId: string }> = {
  id: 'booking.resources.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(bookingResourceUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceSnapshot(em, parsed.id)
    if (!snapshot) return {}
    const custom = await loadResourceCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(bookingResourceUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      BookingResource,
      { id: parsed.id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Booking resource not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.capacityUnitValue !== undefined) {
      const unitValue =
        typeof parsed.capacityUnitValue === 'string' ? parsed.capacityUnitValue.trim() : ''
      if (!unitValue) {
        record.capacityUnitValue = null
        record.capacityUnitName = null
        record.capacityUnitColor = null
        record.capacityUnitIcon = null
      } else {
        const unitSnapshot = await resolveCapacityUnit(
          em,
          { tenantId: record.tenantId, organizationId: record.organizationId },
          unitValue,
        )
        record.capacityUnitValue = unitSnapshot.value
        record.capacityUnitName = unitSnapshot.name
        record.capacityUnitColor = unitSnapshot.color
        record.capacityUnitIcon = unitSnapshot.icon
      }
    }
    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.resourceTypeId !== undefined) record.resourceTypeId = parsed.resourceTypeId ?? null
    if (parsed.capacity !== undefined) record.capacity = parsed.capacity ?? null
    if (parsed.appearanceIcon !== undefined) record.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) record.appearanceColor = parsed.appearanceColor ?? null
    if (parsed.availabilityRuleSetId !== undefined) record.availabilityRuleSetId = parsed.availabilityRuleSetId ?? null
    record.updatedAt = new Date()
    await syncBookingResourceTags(em, {
      resourceId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      tagIds: parsed.tags,
    })
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive

    await em.flush()
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.booking.booking_resource,
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
    return { resourceId: record.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as ResourceSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadResourceSnapshot(em, before.id)
    if (!after) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const customAfter = await loadResourceCustomSnapshot(em, after)
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'name',
      'description',
      'resourceTypeId',
      'capacity',
      'capacityUnitValue',
      'capacityUnitName',
      'capacityUnitColor',
      'capacityUnitIcon',
      'appearanceIcon',
      'appearanceColor',
      'isActive',
      'availabilityRuleSetId',
      'deletedAt',
    ])
    if (before.tags.join(',') !== after.tags.join(',')) {
      changes.tags = { from: before.tags, to: after.tags }
    }
    const customChanges = diffCustomFieldChanges(customBefore, customAfter)
    if (Object.keys(customChanges).length) {
      changes.customFields = { from: customBefore ?? null, to: customAfter ?? null }
    }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.resources.update', 'Update resource'),
      resourceKind: 'booking.resource',
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
        } satisfies ResourceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BookingResource, { id: before.id })
    if (!record) return
    record.name = before.name
    record.description = before.description ?? null
    record.resourceTypeId = before.resourceTypeId ?? null
    record.capacity = before.capacity ?? null
    record.capacityUnitValue = before.capacityUnitValue ?? null
    record.capacityUnitName = before.capacityUnitName ?? null
    record.capacityUnitColor = before.capacityUnitColor ?? null
    record.capacityUnitIcon = before.capacityUnitIcon ?? null
    record.appearanceIcon = before.appearanceIcon ?? null
    record.appearanceColor = before.appearanceColor ?? null
    record.isActive = before.isActive
    record.availabilityRuleSetId = before.availabilityRuleSetId ?? null
    record.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    record.updatedAt = new Date()
    await syncBookingResourceTags(em, {
      resourceId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      tagIds: before.tags,
    })
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    if (payload.customBefore || payload.customAfter) {
      const reset = buildCustomFieldResetMap(payload.customBefore ?? undefined, payload.customAfter ?? undefined)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.booking.booking_resource,
        recordId: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
    })
  },
}

const deleteResourceCommand: CommandHandler<{ id?: string }, { resourceId: string }> = {
  id: 'booking.resources.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Resource id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceSnapshot(em, id)
    if (!snapshot) return {}
    const custom = await loadResourceCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Resource id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      BookingResource,
      { id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Booking resource not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
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
    return { resourceId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ResourceSnapshot | undefined
    if (!before) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.resources.delete', 'Delete resource'),
      resourceKind: 'booking.resource',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
          customBefore: customBefore ?? null,
        } satisfies ResourceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(BookingResource, { id: before.id })
    if (!record) {
      record = em.create(BookingResource, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        name: before.name,
        description: before.description ?? null,
        resourceTypeId: before.resourceTypeId ?? null,
        capacity: before.capacity ?? null,
        capacityUnitValue: before.capacityUnitValue ?? null,
        capacityUnitName: before.capacityUnitName ?? null,
        capacityUnitColor: before.capacityUnitColor ?? null,
        capacityUnitIcon: before.capacityUnitIcon ?? null,
        appearanceIcon: before.appearanceIcon ?? null,
        appearanceColor: before.appearanceColor ?? null,
        isActive: before.isActive,
        availabilityRuleSetId: before.availabilityRuleSetId ?? null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(record)
    } else {
      record.name = before.name
      record.description = before.description ?? null
      record.resourceTypeId = before.resourceTypeId ?? null
      record.capacity = before.capacity ?? null
      record.capacityUnitValue = before.capacityUnitValue ?? null
      record.capacityUnitName = before.capacityUnitName ?? null
      record.capacityUnitColor = before.capacityUnitColor ?? null
      record.capacityUnitIcon = before.capacityUnitIcon ?? null
      record.appearanceIcon = before.appearanceIcon ?? null
      record.appearanceColor = before.appearanceColor ?? null
      record.isActive = before.isActive
      record.availabilityRuleSetId = before.availabilityRuleSetId ?? null
      record.deletedAt = null
      record.updatedAt = new Date()
    }
    await em.flush()
    await syncBookingResourceTags(em, {
      resourceId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      tagIds: before.tags,
    })
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    if (payload.customBefore) {
      const reset = buildCustomFieldResetMap(payload.customBefore, undefined)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.booking.booking_resource,
        recordId: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
    })
  },
}

registerCommand(createResourceCommand)
registerCommand(updateResourceCommand)
registerCommand(deleteResourceCommand)
