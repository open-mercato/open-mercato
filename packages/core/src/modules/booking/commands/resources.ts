import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { BookingResource, BookingResourceTag, BookingResourceTagAssignment } from '../data/entities'
import {
  bookingResourceCreateSchema,
  bookingResourceUpdateSchema,
  type BookingResourceCreateInput,
  type BookingResourceUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'
import { BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from '../lib/capacityUnits'
import { E } from '@/generated/entities.ids.generated'

type CapacityUnitSnapshot = {
  value: string
  name: string
  color: string | null
  icon: string | null
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
    return { resourceId: record.id }
  },
}

const updateResourceCommand: CommandHandler<BookingResourceUpdateInput, { resourceId: string }> = {
  id: 'booking.resources.update',
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
    return { resourceId: record.id }
  },
}

const deleteResourceCommand: CommandHandler<{ id?: string }, { resourceId: string }> = {
  id: 'booking.resources.delete',
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
    await em.flush()
    return { resourceId: record.id }
  },
}

registerCommand(createResourceCommand)
registerCommand(updateResourceCommand)
registerCommand(deleteResourceCommand)
