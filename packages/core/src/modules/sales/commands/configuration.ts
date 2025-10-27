import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  SalesChannel,
  SalesDeliveryWindow,
  SalesPaymentMethod,
  SalesShippingMethod,
  SalesTaxRate,
} from '../data/entities'
import {
  channelCreateSchema,
  channelUpdateSchema,
  deliveryWindowCreateSchema,
  deliveryWindowUpdateSchema,
  paymentMethodCreateSchema,
  paymentMethodUpdateSchema,
  shippingMethodCreateSchema,
  shippingMethodUpdateSchema,
  taxRateCreateSchema,
  taxRateUpdateSchema,
  type ChannelCreateInput,
  type ChannelUpdateInput,
  type DeliveryWindowCreateInput,
  type DeliveryWindowUpdateInput,
  type PaymentMethodCreateInput,
  type PaymentMethodUpdateInput,
  type ShippingMethodCreateInput,
  type ShippingMethodUpdateInput,
  type TaxRateCreateInput,
  type TaxRateUpdateInput,
} from '../data/validators'
import {
  assertFound,
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
  toNumericString,
} from './shared'

type ChannelSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string | null
  description: string | null
  statusEntryId: string | null
  websiteUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  latitude: string | null
  longitude: string | null
  metadata: Record<string, unknown> | null
  isActive: boolean
  custom: Record<string, unknown> | null
}

type DeliveryWindowSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string
  description: string | null
  leadTimeDays: number | null
  cutoffTime: string | null
  timezone: string | null
  metadata: Record<string, unknown> | null
  isActive: boolean
  custom: Record<string, unknown> | null
}

type ShippingMethodSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string
  description: string | null
  carrierCode: string | null
  serviceLevel: string | null
  estimatedTransitDays: number | null
  baseRateNet: string
  baseRateGross: string
  currencyCode: string | null
  metadata: Record<string, unknown> | null
  isActive: boolean
  custom: Record<string, unknown> | null
}

type PaymentMethodSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string
  description: string | null
  providerKey: string | null
  terms: string | null
  metadata: Record<string, unknown> | null
  isActive: boolean
  custom: Record<string, unknown> | null
}

type TaxRateSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string
  rate: string
  countryCode: string | null
  regionCode: string | null
  postalCode: string | null
  city: string | null
  customerGroupId: string | null
  productCategoryId: string | null
  channelId: string | null
  priority: number
  isCompound: boolean
  metadata: Record<string, unknown> | null
  startsAt: string | null
  endsAt: string | null
  custom: Record<string, unknown> | null
}

type UndoPayload<T> = {
  before?: T | null
  after?: T | null
}

async function loadChannelSnapshot(em: EntityManager, id: string): Promise<ChannelSnapshot | null> {
  const channel = await em.findOne(SalesChannel, { id, deletedAt: null })
  if (!channel) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.sales.sales_channel,
    recordId: channel.id,
    tenantId: channel.tenantId,
    organizationId: channel.organizationId,
  })
  return {
    id: channel.id,
    organizationId: channel.organizationId,
    tenantId: channel.tenantId,
    name: channel.name,
    code: channel.code ?? null,
    description: channel.description ?? null,
    statusEntryId: channel.statusEntryId ?? null,
    websiteUrl: channel.websiteUrl ?? null,
    contactEmail: channel.contactEmail ?? null,
    contactPhone: channel.contactPhone ?? null,
    addressLine1: channel.addressLine1 ?? null,
    addressLine2: channel.addressLine2 ?? null,
    city: channel.city ?? null,
    region: channel.region ?? null,
    postalCode: channel.postalCode ?? null,
    country: channel.country ?? null,
    latitude: channel.latitude ?? null,
    longitude: channel.longitude ?? null,
    metadata: channel.metadata ? cloneJson(channel.metadata) : null,
    isActive: channel.isActive,
    custom: Object.keys(custom).length ? custom : null,
  }
}

async function loadDeliveryWindowSnapshot(
  em: EntityManager,
  id: string
): Promise<DeliveryWindowSnapshot | null> {
  const record = await em.findOne(SalesDeliveryWindow, { id, deletedAt: null })
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.sales.sales_delivery_window,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code,
    description: record.description ?? null,
    leadTimeDays: record.leadTimeDays ?? null,
    cutoffTime: record.cutoffTime ?? null,
    timezone: record.timezone ?? null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    isActive: record.isActive,
    custom: Object.keys(custom).length ? custom : null,
  }
}

async function loadShippingMethodSnapshot(
  em: EntityManager,
  id: string
): Promise<ShippingMethodSnapshot | null> {
  const record = await em.findOne(SalesShippingMethod, { id, deletedAt: null })
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.sales.sales_shipping_method,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code,
    description: record.description ?? null,
    carrierCode: record.carrierCode ?? null,
    serviceLevel: record.serviceLevel ?? null,
    estimatedTransitDays: record.estimatedTransitDays ?? null,
    baseRateNet: record.baseRateNet,
    baseRateGross: record.baseRateGross,
    currencyCode: record.currencyCode ?? null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    isActive: record.isActive,
    custom: Object.keys(custom).length ? custom : null,
  }
}

async function loadPaymentMethodSnapshot(
  em: EntityManager,
  id: string
): Promise<PaymentMethodSnapshot | null> {
  const record = await em.findOne(SalesPaymentMethod, { id, deletedAt: null })
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.sales.sales_payment_method,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code,
    description: record.description ?? null,
    providerKey: record.providerKey ?? null,
    terms: record.terms ?? null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    isActive: record.isActive,
    custom: Object.keys(custom).length ? custom : null,
  }
}

async function loadTaxRateSnapshot(em: EntityManager, id: string): Promise<TaxRateSnapshot | null> {
  const record = await em.findOne(SalesTaxRate, { id, deletedAt: null })
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.sales.sales_tax_rate,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code,
    rate: record.rate,
    countryCode: record.countryCode ?? null,
    regionCode: record.regionCode ?? null,
    postalCode: record.postalCode ?? null,
    city: record.city ?? null,
    customerGroupId: record.customerGroupId ?? null,
    productCategoryId: record.productCategoryId ?? null,
    channelId: record.channelId ?? null,
    priority: record.priority,
    isCompound: record.isCompound,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    startsAt: record.startsAt ? record.startsAt.toISOString() : null,
    endsAt: record.endsAt ? record.endsAt.toISOString() : null,
    custom: Object.keys(custom).length ? custom : null,
  }
}

function applyChannelSnapshot(record: SalesChannel, snapshot: ChannelSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.name = snapshot.name
  record.code = snapshot.code ?? null
  record.description = snapshot.description ?? null
  record.statusEntryId = snapshot.statusEntryId ?? null
  record.websiteUrl = snapshot.websiteUrl ?? null
  record.contactEmail = snapshot.contactEmail ?? null
  record.contactPhone = snapshot.contactPhone ?? null
  record.addressLine1 = snapshot.addressLine1 ?? null
  record.addressLine2 = snapshot.addressLine2 ?? null
  record.city = snapshot.city ?? null
  record.region = snapshot.region ?? null
  record.postalCode = snapshot.postalCode ?? null
  record.country = snapshot.country ?? null
  record.latitude = snapshot.latitude ?? null
  record.longitude = snapshot.longitude ?? null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.isActive = snapshot.isActive
}

function applyDeliveryWindowSnapshot(
  record: SalesDeliveryWindow,
  snapshot: DeliveryWindowSnapshot
): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.name = snapshot.name
  record.code = snapshot.code
  record.description = snapshot.description ?? null
  record.leadTimeDays = snapshot.leadTimeDays ?? null
  record.cutoffTime = snapshot.cutoffTime ?? null
  record.timezone = snapshot.timezone ?? null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.isActive = snapshot.isActive
}

function applyShippingMethodSnapshot(
  record: SalesShippingMethod,
  snapshot: ShippingMethodSnapshot
): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.name = snapshot.name
  record.code = snapshot.code
  record.description = snapshot.description ?? null
  record.carrierCode = snapshot.carrierCode ?? null
  record.serviceLevel = snapshot.serviceLevel ?? null
  record.estimatedTransitDays = snapshot.estimatedTransitDays ?? null
  record.baseRateNet = snapshot.baseRateNet
  record.baseRateGross = snapshot.baseRateGross
  record.currencyCode = snapshot.currencyCode ?? null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.isActive = snapshot.isActive
}

function applyPaymentMethodSnapshot(
  record: SalesPaymentMethod,
  snapshot: PaymentMethodSnapshot
): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.name = snapshot.name
  record.code = snapshot.code
  record.description = snapshot.description ?? null
  record.providerKey = snapshot.providerKey ?? null
  record.terms = snapshot.terms ?? null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.isActive = snapshot.isActive
}

function applyTaxRateSnapshot(record: SalesTaxRate, snapshot: TaxRateSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.name = snapshot.name
  record.code = snapshot.code
  record.rate = snapshot.rate
  record.countryCode = snapshot.countryCode ?? null
  record.regionCode = snapshot.regionCode ?? null
  record.postalCode = snapshot.postalCode ?? null
  record.city = snapshot.city ?? null
  record.customerGroupId = snapshot.customerGroupId ?? null
  record.productCategoryId = snapshot.productCategoryId ?? null
  record.channelId = snapshot.channelId ?? null
  record.priority = snapshot.priority
  record.isCompound = snapshot.isCompound
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.startsAt = snapshot.startsAt ? new Date(snapshot.startsAt) : null
  record.endsAt = snapshot.endsAt ? new Date(snapshot.endsAt) : null
}

function resolveScopeFromUpdate<T extends { organizationId: string; tenantId: string }>(
  entity: T,
  patch: { organizationId?: string; tenantId?: string },
  ctx: Parameters<typeof ensureTenantScope>[0]
): { organizationId: string; tenantId: string } {
  const organizationId = patch.organizationId ?? entity.organizationId
  const tenantId = patch.tenantId ?? entity.tenantId
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  ensureSameScope(entity, organizationId, tenantId)
  return { organizationId, tenantId }
}

const createChannelCommand: CommandHandler<ChannelCreateInput, { channelId: string }> = {
  id: 'sales.channels.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(channelCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = em.create(SalesChannel, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      code: parsed.code ?? null,
      description: parsed.description ?? null,
      statusEntryId: parsed.statusEntryId ?? null,
      websiteUrl: parsed.websiteUrl ?? null,
      contactEmail: parsed.contactEmail ?? null,
      contactPhone: parsed.contactPhone ?? null,
      addressLine1: parsed.addressLine1 ?? null,
      addressLine2: parsed.addressLine2 ?? null,
      city: parsed.city ?? null,
      region: parsed.region ?? null,
      postalCode: parsed.postalCode ?? null,
      country: parsed.country ?? null,
      latitude: toNumericString(parsed.latitude),
      longitude: toNumericString(parsed.longitude),
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      isActive: parsed.isActive ?? true,
    })
    em.persist(record)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.sales.sales_channel,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { channelId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadChannelSnapshot(em, result.channelId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as ChannelSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.channels.create', 'Create sales channel'),
      resourceKind: 'sales.channel',
      resourceId: result.channelId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies UndoPayload<ChannelSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<ChannelSnapshot>>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesChannel, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_channel,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updateChannelCommand: CommandHandler<ChannelUpdateInput, { channelId: string }> = {
  id: 'sales.channels.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Channel id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadChannelSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(channelUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesChannel, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Channel not found' })
    const scope = resolveScopeFromUpdate(record, parsed, ctx)

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.code !== undefined) record.code = parsed.code ?? null
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.statusEntryId !== undefined) record.statusEntryId = parsed.statusEntryId ?? null
    if (parsed.websiteUrl !== undefined) record.websiteUrl = parsed.websiteUrl ?? null
    if (parsed.contactEmail !== undefined) record.contactEmail = parsed.contactEmail ?? null
    if (parsed.contactPhone !== undefined) record.contactPhone = parsed.contactPhone ?? null
    if (parsed.addressLine1 !== undefined) record.addressLine1 = parsed.addressLine1 ?? null
    if (parsed.addressLine2 !== undefined) record.addressLine2 = parsed.addressLine2 ?? null
    if (parsed.city !== undefined) record.city = parsed.city ?? null
    if (parsed.region !== undefined) record.region = parsed.region ?? null
    if (parsed.postalCode !== undefined) record.postalCode = parsed.postalCode ?? null
    if (parsed.country !== undefined) record.country = parsed.country ?? null
    if (Object.prototype.hasOwnProperty.call(parsed, 'latitude')) {
      record.latitude = toNumericString(parsed.latitude)
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'longitude')) {
      record.longitude = toNumericString(parsed.longitude)
    }
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    record.organizationId = scope.organizationId
    record.tenantId = scope.tenantId
    await em.flush()
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_channel,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    return { channelId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadChannelSnapshot(em, result.channelId)
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as ChannelSnapshot | undefined
    const after = snapshots.after as ChannelSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.channels.update', 'Update sales channel'),
      resourceKind: 'sales.channel',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>),
      payload: {
        undo: {
          before,
          after,
        } satisfies UndoPayload<ChannelSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<ChannelSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(SalesChannel, { id: before.id })
    if (!record) {
      record = em.create(SalesChannel, { id: before.id })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
   applyChannelSnapshot(record, before)
   await em.flush()
    const after = payload?.after
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, after?.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_channel,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deleteChannelCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { channelId: string }
> = {
  id: 'sales.channels.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Channel id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadChannelSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Channel id is required')
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesChannel, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Channel not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    return { channelId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ChannelSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.channels.delete', 'Delete sales channel'),
      resourceKind: 'sales.channel',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies UndoPayload<ChannelSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<ChannelSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(SalesChannel, { id: before.id })
    if (!record) {
      record = em.create(SalesChannel, { id: before.id })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyChannelSnapshot(record, before)
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_channel,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

const createDeliveryWindowCommand: CommandHandler<
  DeliveryWindowCreateInput,
  { deliveryWindowId: string }
> = {
  id: 'sales.delivery-windows.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(deliveryWindowCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = em.create(SalesDeliveryWindow, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      code: parsed.code,
      description: parsed.description ?? null,
      leadTimeDays: parsed.leadTimeDays ?? null,
      cutoffTime: parsed.cutoffTime ?? null,
      timezone: parsed.timezone ?? null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      isActive: parsed.isActive ?? true,
    })
    em.persist(record)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.sales.sales_delivery_window,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { deliveryWindowId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadDeliveryWindowSnapshot(em, result.deliveryWindowId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as DeliveryWindowSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.delivery-windows.create', 'Create delivery window'),
      resourceKind: 'sales.delivery-window',
      resourceId: result.deliveryWindowId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies UndoPayload<DeliveryWindowSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<DeliveryWindowSnapshot>>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesDeliveryWindow, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_delivery_window,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updateDeliveryWindowCommand: CommandHandler<
  DeliveryWindowUpdateInput,
  { deliveryWindowId: string }
> = {
  id: 'sales.delivery-windows.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Delivery window id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadDeliveryWindowSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(deliveryWindowUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesDeliveryWindow, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Delivery window not found' })
    const scope = resolveScopeFromUpdate(record, parsed, ctx)
    record.organizationId = scope.organizationId
    record.tenantId = scope.tenantId
    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.code !== undefined) record.code = parsed.code
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.leadTimeDays !== undefined) record.leadTimeDays = parsed.leadTimeDays ?? null
    if (parsed.cutoffTime !== undefined) record.cutoffTime = parsed.cutoffTime ?? null
    if (parsed.timezone !== undefined) record.timezone = parsed.timezone ?? null
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    await em.flush()
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_delivery_window,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    return { deliveryWindowId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadDeliveryWindowSnapshot(em, result.deliveryWindowId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as DeliveryWindowSnapshot | undefined
    const after = snapshots.after as DeliveryWindowSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.delivery-windows.update', 'Update delivery window'),
      resourceKind: 'sales.delivery-window',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>),
      payload: {
        undo: {
          before,
          after,
        } satisfies UndoPayload<DeliveryWindowSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<DeliveryWindowSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(SalesDeliveryWindow, { id: before.id })
    if (!record) {
      record = em.create(SalesDeliveryWindow, { id: before.id })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyDeliveryWindowSnapshot(record, before)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_delivery_window,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deleteDeliveryWindowCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { deliveryWindowId: string }
> = {
  id: 'sales.delivery-windows.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Delivery window id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadDeliveryWindowSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Delivery window id is required')
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesDeliveryWindow, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Delivery window not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    return { deliveryWindowId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as DeliveryWindowSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.delivery-windows.delete', 'Delete delivery window'),
      resourceKind: 'sales.delivery-window',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies UndoPayload<DeliveryWindowSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<DeliveryWindowSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(SalesDeliveryWindow, { id: before.id })
    if (!record) {
      record = em.create(SalesDeliveryWindow, { id: before.id })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyDeliveryWindowSnapshot(record, before)
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_delivery_window,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

const createShippingMethodCommand: CommandHandler<
  ShippingMethodCreateInput,
  { shippingMethodId: string }
> = {
  id: 'sales.shipping-methods.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(shippingMethodCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = em.create(SalesShippingMethod, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      code: parsed.code,
      description: parsed.description ?? null,
      carrierCode: parsed.carrierCode ?? null,
      serviceLevel: parsed.serviceLevel ?? null,
      estimatedTransitDays: parsed.estimatedTransitDays ?? null,
      baseRateNet: toNumericString(parsed.baseRateNet) ?? '0',
      baseRateGross: toNumericString(parsed.baseRateGross) ?? '0',
      currencyCode: parsed.currencyCode ?? null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      isActive: parsed.isActive ?? true,
    })
    em.persist(record)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.sales.sales_shipping_method,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { shippingMethodId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadShippingMethodSnapshot(em, result.shippingMethodId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as ShippingMethodSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.shipping-methods.create', 'Create shipping method'),
      resourceKind: 'sales.shipping-method',
      resourceId: result.shippingMethodId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies UndoPayload<ShippingMethodSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<ShippingMethodSnapshot>>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesShippingMethod, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_shipping_method,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updateShippingMethodCommand: CommandHandler<
  ShippingMethodUpdateInput,
  { shippingMethodId: string }
> = {
  id: 'sales.shipping-methods.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Shipping method id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadShippingMethodSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(shippingMethodUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesShippingMethod, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Shipping method not found' })
    const scope = resolveScopeFromUpdate(record, parsed, ctx)
    record.organizationId = scope.organizationId
    record.tenantId = scope.tenantId
    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.code !== undefined) record.code = parsed.code
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.carrierCode !== undefined) record.carrierCode = parsed.carrierCode ?? null
    if (parsed.serviceLevel !== undefined) record.serviceLevel = parsed.serviceLevel ?? null
    if (parsed.estimatedTransitDays !== undefined) {
      record.estimatedTransitDays = parsed.estimatedTransitDays ?? null
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'baseRateNet')) {
      record.baseRateNet = toNumericString(parsed.baseRateNet) ?? '0'
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'baseRateGross')) {
      record.baseRateGross = toNumericString(parsed.baseRateGross) ?? '0'
    }
    if (parsed.currencyCode !== undefined) record.currencyCode = parsed.currencyCode ?? null
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    await em.flush()
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_shipping_method,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    return { shippingMethodId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadShippingMethodSnapshot(em, result.shippingMethodId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ShippingMethodSnapshot | undefined
    const after = snapshots.after as ShippingMethodSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.shipping-methods.update', 'Update shipping method'),
      resourceKind: 'sales.shipping-method',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>),
      payload: {
        undo: {
          before,
          after,
        } satisfies UndoPayload<ShippingMethodSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<ShippingMethodSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(SalesShippingMethod, { id: before.id })
    if (!record) {
      record = em.create(SalesShippingMethod, { id: before.id })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyShippingMethodSnapshot(record, before)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_shipping_method,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deleteShippingMethodCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { shippingMethodId: string }
> = {
  id: 'sales.shipping-methods.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Shipping method id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadShippingMethodSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Shipping method id is required')
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesShippingMethod, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Shipping method not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    return { shippingMethodId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ShippingMethodSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.shipping-methods.delete', 'Delete shipping method'),
      resourceKind: 'sales.shipping-method',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies UndoPayload<ShippingMethodSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<ShippingMethodSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(SalesShippingMethod, { id: before.id })
    if (!record) {
      record = em.create(SalesShippingMethod, { id: before.id })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyShippingMethodSnapshot(record, before)
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_shipping_method,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

const createPaymentMethodCommand: CommandHandler<
  PaymentMethodCreateInput,
  { paymentMethodId: string }
> = {
  id: 'sales.payment-methods.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(paymentMethodCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = em.create(SalesPaymentMethod, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      code: parsed.code,
      description: parsed.description ?? null,
      providerKey: parsed.providerKey ?? null,
      terms: parsed.terms ?? null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      isActive: parsed.isActive ?? true,
    })
    em.persist(record)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.sales.sales_payment_method,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { paymentMethodId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadPaymentMethodSnapshot(em, result.paymentMethodId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as PaymentMethodSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.payment-methods.create', 'Create payment method'),
      resourceKind: 'sales.payment-method',
      resourceId: result.paymentMethodId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies UndoPayload<PaymentMethodSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<PaymentMethodSnapshot>>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesPaymentMethod, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_payment_method,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updatePaymentMethodCommand: CommandHandler<
  PaymentMethodUpdateInput,
  { paymentMethodId: string }
> = {
  id: 'sales.payment-methods.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Payment method id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadPaymentMethodSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(paymentMethodUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesPaymentMethod, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Payment method not found' })
    const scope = resolveScopeFromUpdate(record, parsed, ctx)
    record.organizationId = scope.organizationId
    record.tenantId = scope.tenantId
    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.code !== undefined) record.code = parsed.code
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.providerKey !== undefined) record.providerKey = parsed.providerKey ?? null
    if (parsed.terms !== undefined) record.terms = parsed.terms ?? null
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    await em.flush()
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_payment_method,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    return { paymentMethodId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadPaymentMethodSnapshot(em, result.paymentMethodId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PaymentMethodSnapshot | undefined
    const after = snapshots.after as PaymentMethodSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.payment-methods.update', 'Update payment method'),
      resourceKind: 'sales.payment-method',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>),
      payload: {
        undo: {
          before,
          after,
        } satisfies UndoPayload<PaymentMethodSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<PaymentMethodSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(SalesPaymentMethod, { id: before.id })
    if (!record) {
      record = em.create(SalesPaymentMethod, { id: before.id })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyPaymentMethodSnapshot(record, before)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_payment_method,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deletePaymentMethodCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { paymentMethodId: string }
> = {
  id: 'sales.payment-methods.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Payment method id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadPaymentMethodSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Payment method id is required')
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesPaymentMethod, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Payment method not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    return { paymentMethodId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PaymentMethodSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.payment-methods.delete', 'Delete payment method'),
      resourceKind: 'sales.payment-method',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies UndoPayload<PaymentMethodSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<PaymentMethodSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(SalesPaymentMethod, { id: before.id })
    if (!record) {
      record = em.create(SalesPaymentMethod, { id: before.id })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyPaymentMethodSnapshot(record, before)
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_payment_method,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

const createTaxRateCommand: CommandHandler<TaxRateCreateInput, { taxRateId: string }> = {
  id: 'sales.tax-rates.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(taxRateCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    if (parsed.channelId) {
      const channel = await em.findOne(SalesChannel, { id: parsed.channelId, deletedAt: null })
      const channelInScope = assertFound(channel, 'Channel not found for tax rate')
      ensureSameScope(channelInScope, parsed.organizationId, parsed.tenantId)
    }
    const record = em.create(SalesTaxRate, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      code: parsed.code,
      rate: toNumericString(parsed.rate) ?? '0',
      countryCode: parsed.countryCode ?? null,
      regionCode: parsed.regionCode ?? null,
      postalCode: parsed.postalCode ?? null,
      city: parsed.city ?? null,
      customerGroupId: parsed.customerGroupId ?? null,
      productCategoryId: parsed.productCategoryId ?? null,
      channelId: parsed.channelId ?? null,
      priority: parsed.priority ?? 0,
      isCompound: parsed.isCompound ?? false,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      startsAt: parsed.startsAt ?? null,
      endsAt: parsed.endsAt ?? null,
    })
    em.persist(record)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.sales.sales_tax_rate,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { taxRateId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadTaxRateSnapshot(em, result.taxRateId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as TaxRateSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.tax-rates.create', 'Create tax rate'),
      resourceKind: 'sales.tax-rate',
      resourceId: result.taxRateId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies UndoPayload<TaxRateSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<TaxRateSnapshot>>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesTaxRate, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_tax_rate,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updateTaxRateCommand: CommandHandler<TaxRateUpdateInput, { taxRateId: string }> = {
  id: 'sales.tax-rates.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Tax rate id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadTaxRateSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(taxRateUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesTaxRate, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Tax rate not found' })
    const scope = resolveScopeFromUpdate(record, parsed, ctx)
    record.organizationId = scope.organizationId
    record.tenantId = scope.tenantId
    if (parsed.channelId !== undefined && parsed.channelId !== null) {
      const channel = await em.findOne(SalesChannel, { id: parsed.channelId, deletedAt: null })
      const channelInScope = assertFound(channel, 'Channel not found for tax rate')
      ensureSameScope(channelInScope, record.organizationId, record.tenantId)
    }

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.code !== undefined) record.code = parsed.code
    if (Object.prototype.hasOwnProperty.call(parsed, 'rate')) {
      record.rate = toNumericString(parsed.rate) ?? record.rate
    }
    if (parsed.countryCode !== undefined) record.countryCode = parsed.countryCode ?? null
    if (parsed.regionCode !== undefined) record.regionCode = parsed.regionCode ?? null
    if (parsed.postalCode !== undefined) record.postalCode = parsed.postalCode ?? null
    if (parsed.city !== undefined) record.city = parsed.city ?? null
    if (parsed.customerGroupId !== undefined) {
      record.customerGroupId = parsed.customerGroupId ?? null
    }
    if (parsed.productCategoryId !== undefined) {
      record.productCategoryId = parsed.productCategoryId ?? null
    }
    if (parsed.channelId !== undefined) record.channelId = parsed.channelId ?? null
    if (parsed.priority !== undefined) record.priority = parsed.priority ?? 0
    if (parsed.isCompound !== undefined) record.isCompound = parsed.isCompound
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'startsAt')) {
      record.startsAt = parsed.startsAt ?? null
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'endsAt')) {
      record.endsAt = parsed.endsAt ?? null
    }
    await em.flush()
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_tax_rate,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    return { taxRateId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadTaxRateSnapshot(em, result.taxRateId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TaxRateSnapshot | undefined
    const after = snapshots.after as TaxRateSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.tax-rates.update', 'Update tax rate'),
      resourceKind: 'sales.tax-rate',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>),
      payload: {
        undo: {
          before,
          after,
        } satisfies UndoPayload<TaxRateSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<TaxRateSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(SalesTaxRate, { id: before.id })
    if (!record) {
      record = em.create(SalesTaxRate, { id: before.id })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyTaxRateSnapshot(record, before)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_tax_rate,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deleteTaxRateCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { taxRateId: string }
> = {
  id: 'sales.tax-rates.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Tax rate id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadTaxRateSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Tax rate id is required')
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(SalesTaxRate, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Tax rate not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const snapshot = await loadTaxRateSnapshot(ctx.container.resolve<EntityManager>('em'), id)
    em.remove(record)
    await em.flush()
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, null)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.sales.sales_tax_rate,
          recordId: id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
          values: resetValues,
        })
      }
    }
    return { taxRateId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TaxRateSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.tax-rates.delete', 'Delete tax rate'),
      resourceKind: 'sales.tax-rate',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies UndoPayload<TaxRateSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<TaxRateSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(SalesTaxRate, { id: before.id })
    if (!record) {
      record = em.create(SalesTaxRate, { id: before.id })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyTaxRateSnapshot(record, before)
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.sales.sales_tax_rate,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

registerCommand(createChannelCommand)
registerCommand(updateChannelCommand)
registerCommand(deleteChannelCommand)

registerCommand(createDeliveryWindowCommand)
registerCommand(updateDeliveryWindowCommand)
registerCommand(deleteDeliveryWindowCommand)

registerCommand(createShippingMethodCommand)
registerCommand(updateShippingMethodCommand)
registerCommand(deleteShippingMethodCommand)

registerCommand(createPaymentMethodCommand)
registerCommand(updatePaymentMethodCommand)
registerCommand(deletePaymentMethodCommand)

registerCommand(createTaxRateCommand)
registerCommand(updateTaxRateCommand)
registerCommand(deleteTaxRateCommand)
