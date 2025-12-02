// @ts-nocheck

import { randomUUID } from 'crypto'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { SalesOrder, SalesOrderLine, SalesShipment, SalesShipmentItem } from '../data/entities'
import {
  shipmentCreateSchema,
  shipmentUpdateSchema,
  type ShipmentCreateInput,
  type ShipmentUpdateInput,
} from '../data/validators'
import {
  coerceShipmentQuantity as toNumber,
  readShipmentItemsSnapshot,
  refreshShipmentItemsSnapshot,
  type ShipmentItemSnapshot,
  buildShipmentItemSnapshots,
} from '../lib/shipments/snapshots'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
} from './shared'
import { resolveDictionaryEntryValue } from '../lib/dictionaries'

const ADDRESS_SNAPSHOT_KEY = 'shipmentAddressSnapshot'

export type ShipmentSnapshot = {
  id: string
  orderId: string
  organizationId: string
  tenantId: string
  shipmentNumber: string | null
  shippingMethodId: string | null
  statusEntryId: string | null
  status: string | null
  carrierName: string | null
  trackingNumbers: string[] | null
  shippedAt: string | null
  deliveredAt: string | null
  weightValue: number | null
  weightUnit: string | null
  declaredValueNet: number | null
  declaredValueGross: number | null
  currencyCode: string | null
  notesText: string | null
  metadata: Record<string, unknown> | null
  customFields?: Record<string, unknown> | null
  items: ShipmentItemSnapshot[]
  itemsSnapshot?: ShipmentItemSnapshot[] | null
}

type ShipmentUndoPayload = {
  before?: ShipmentSnapshot | null
  after?: ShipmentSnapshot | null
}

const buildShipmentCreateRedoInput = (snapshot: ShipmentSnapshot): ShipmentCreateInput => ({
  orderId: snapshot.orderId,
  organizationId: snapshot.organizationId,
  tenantId: snapshot.tenantId,
  shipmentNumber: snapshot.shipmentNumber ?? undefined,
  shippingMethodId: snapshot.shippingMethodId ?? undefined,
  statusEntryId: snapshot.statusEntryId ?? undefined,
  carrierName: snapshot.carrierName ?? undefined,
  trackingNumbers: snapshot.trackingNumbers ?? undefined,
  shippedAt: snapshot.shippedAt ? new Date(snapshot.shippedAt) : undefined,
  deliveredAt: snapshot.deliveredAt ? new Date(snapshot.deliveredAt) : undefined,
  weightValue: snapshot.weightValue ?? undefined,
  weightUnit: snapshot.weightUnit ?? undefined,
  declaredValueNet: snapshot.declaredValueNet ?? undefined,
  declaredValueGross: snapshot.declaredValueGross ?? undefined,
  currencyCode: snapshot.currencyCode ?? undefined,
  notes: snapshot.notesText ?? undefined,
  metadata: snapshot.metadata ? cloneJson(snapshot.metadata) : undefined,
  customFields: snapshot.customFields ? cloneJson(snapshot.customFields) : undefined,
  items: snapshot.items.map((item) => ({
    orderLineId: item.orderLineId,
    quantity: item.quantity,
    metadata: item.metadata ? cloneJson(item.metadata) : undefined,
  })),
})

const parseTrackingNumbers = (input: unknown): string[] | null => {
  if (typeof input === 'string') {
    const entries = input
      .split(/[\n,]/g)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    return entries.length ? entries : null
  }
  if (Array.isArray(input)) {
    const entries = input
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0)
    return entries.length ? entries : null
  }
  return null
}

const normalizeCustomFieldsInput = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}

const resolveLogger = (ctx: any): { warn?: (meta: any, message?: string) => void } | null => {
  const container = ctx?.container as any
  if (!container) return null
  const cradleLogger = container?.cradle?.logger ?? null
  if (cradleLogger?.warn) return cradleLogger
  const hasRegistration = typeof container.hasRegistration === 'function' ? container.hasRegistration.bind(container) : null
  if (hasRegistration?.('logger')) {
    const logger = container.resolve('logger')
    if (logger?.warn) return logger
  }
  if (hasRegistration?.('coreLogger')) {
    const logger = container.resolve('coreLogger')
    if (logger?.warn) return logger
  }
  return null
}

const logShipmentDeleteScopeRejection = (
  ctx: any,
  reason: string,
  meta: Record<string, unknown>
): void => {
  const logger = resolveLogger(ctx)
  const payload = { ...meta, command: 'sales.shipments.delete' }
  if (logger?.warn) {
    logger.warn(payload, reason)
    return
  }
  // eslint-disable-next-line no-console
  console.warn(`[sales.shipments.delete] ${reason}`, payload)
}

export async function loadShipmentSnapshot(em: EntityManager, id: string): Promise<ShipmentSnapshot | null> {
  const shipment = await em.findOne(
    SalesShipment,
    { id },
    { populate: ['order', 'items', 'items.orderLine'] }
  )
  if (!shipment || !shipment.order) return null
  const storedSnapshot = readShipmentItemsSnapshot(
    (shipment as any).itemsSnapshot ?? (shipment as any).items_snapshot ?? null
  )
  const lineMap = new Map(
    Array.from(shipment.items ?? [])
      .map((item) => {
        const line = typeof item.orderLine === 'string' ? null : (item.orderLine as SalesOrderLine | null)
        return line ? [line.id, line] : null
      })
      .filter((entry): entry is [string, SalesOrderLine] => Boolean(entry))
  )
  const fallbackItems = buildShipmentItemSnapshots(Array.from(shipment.items ?? []), { lineMap })
  const itemsSnapshot = storedSnapshot.length ? storedSnapshot : fallbackItems
  const customFieldValues = await loadCustomFieldValues({
    em,
    entityId: E.sales.sales_shipment,
    recordIds: [shipment.id],
    tenantIdByRecord: { [shipment.id]: shipment.tenantId ?? null },
    organizationIdByRecord: { [shipment.id]: shipment.organizationId ?? null },
  })
  const customFields = customFieldValues[shipment.id]
  return {
    id: shipment.id,
    orderId: typeof shipment.order === 'string' ? shipment.order : shipment.order.id,
    organizationId: shipment.organizationId,
    tenantId: shipment.tenantId,
    shipmentNumber: shipment.shipmentNumber ?? null,
    shippingMethodId: shipment.shippingMethodId ?? null,
    statusEntryId: shipment.statusEntryId ?? null,
    status: shipment.status ?? null,
    carrierName: shipment.carrierName ?? null,
    trackingNumbers: shipment.trackingNumbers ? [...shipment.trackingNumbers] : null,
    shippedAt: shipment.shippedAt ? shipment.shippedAt.toISOString() : null,
    deliveredAt: shipment.deliveredAt ? shipment.deliveredAt.toISOString() : null,
    weightValue: shipment.weightValue !== undefined && shipment.weightValue !== null ? Number(shipment.weightValue) : null,
    weightUnit: shipment.weightUnit ?? null,
    declaredValueNet:
      shipment.declaredValueNet !== undefined && shipment.declaredValueNet !== null
        ? Number(shipment.declaredValueNet)
        : null,
    declaredValueGross:
      shipment.declaredValueGross !== undefined && shipment.declaredValueGross !== null
        ? Number(shipment.declaredValueGross)
        : null,
    currencyCode: shipment.currencyCode ?? null,
    notesText: shipment.notesText ?? null,
    metadata: shipment.metadata ? cloneJson(shipment.metadata) : null,
    customFields: customFields && Object.keys(customFields).length ? customFields : null,
    items: itemsSnapshot,
    itemsSnapshot,
  }
}

export async function restoreShipmentSnapshot(em: EntityManager, snapshot: ShipmentSnapshot): Promise<void> {
  const order = await em.findOne(SalesOrder, { id: snapshot.orderId })
  if (!order) return
  const existing = await em.findOne(SalesShipment, { id: snapshot.id })
  const entity =
    existing ??
    em.create(SalesShipment, {
      id: snapshot.id,
      createdAt: new Date(),
      organizationId: snapshot.organizationId,
      tenantId: snapshot.tenantId,
    })
  entity.order = order
  entity.organizationId = snapshot.organizationId
  entity.tenantId = snapshot.tenantId
  entity.shipmentNumber = snapshot.shipmentNumber ?? null
  entity.shippingMethodId = snapshot.shippingMethodId ?? null
  entity.statusEntryId = snapshot.statusEntryId ?? null
  entity.status = snapshot.status ?? null
  entity.carrierName = snapshot.carrierName ?? null
  entity.trackingNumbers = snapshot.trackingNumbers ? [...snapshot.trackingNumbers] : null
  entity.shippedAt = snapshot.shippedAt ? new Date(snapshot.shippedAt) : null
  entity.deliveredAt = snapshot.deliveredAt ? new Date(snapshot.deliveredAt) : null
  entity.weightValue = snapshot.weightValue !== null ? snapshot.weightValue.toString() : null
  entity.weightUnit = snapshot.weightUnit ?? null
  entity.declaredValueNet = snapshot.declaredValueNet !== null ? snapshot.declaredValueNet.toString() : null
  entity.declaredValueGross = snapshot.declaredValueGross !== null ? snapshot.declaredValueGross.toString() : null
  entity.currencyCode = snapshot.currencyCode ?? null
  entity.notesText = snapshot.notesText ?? null
  entity.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  entity.updatedAt = new Date()
  em.persist(entity)

  const existingItems = await em.find(SalesShipmentItem, { shipment: entity })
  existingItems.forEach((item) => em.remove(item))
  snapshot.items.forEach((item) => {
    const lineRef = em.getReference(SalesOrderLine, item.orderLineId)
    const shipmentItem = em.create(SalesShipmentItem, {
      id: item.id ?? randomUUID(),
      shipment: entity,
      orderLine: lineRef,
      organizationId: snapshot.organizationId,
      tenantId: snapshot.tenantId,
      quantity: item.quantity.toString(),
      metadata: item.metadata ? cloneJson(item.metadata) : null,
    })
    em.persist(shipmentItem)
  })
  const snapshotItems = snapshot.itemsSnapshot ?? snapshot.items
  entity.itemsSnapshot = snapshotItems && snapshotItems.length ? cloneJson(snapshotItems) : null
  if (!entity.itemsSnapshot) {
    await refreshShipmentItemsSnapshot(em, entity)
  }
  if ((snapshot as any).customFields !== undefined) {
    await setRecordCustomFields(em, {
      entityId: E.sales.sales_shipment,
      recordId: entity.id,
      organizationId: snapshot.organizationId,
      tenantId: snapshot.tenantId,
      values: normalizeCustomFieldsInput((snapshot as any).customFields),
    })
  }
  em.persist(entity)
}

async function deleteShipmentWithItems(em: EntityManager, shipment: SalesShipment): Promise<void> {
  const items = await em.find(SalesShipmentItem, { shipment })
  items.forEach((item) => em.remove(item))
  em.remove(shipment)
  await em.flush()
}

async function recomputeFulfilledQuantities(em: EntityManager, order: SalesOrder): Promise<void> {
  const shipments = await em.find(SalesShipment, { order, deletedAt: null })
  const shipmentIds = shipments.map((entry) => entry.id)
  const shipmentItems = shipmentIds.length
    ? await em.find(SalesShipmentItem, { shipment: { $in: shipmentIds } })
    : []
  const totals = shipmentItems.reduce<Map<string, number>>((acc, item) => {
    const lineId =
      typeof item.orderLine === 'string'
        ? item.orderLine
        : item.orderLine?.id ?? (item as any).orderLineId ?? null
    if (!lineId) return acc
    const next = (acc.get(lineId) ?? 0) + toNumber(item.quantity)
    acc.set(lineId, next)
    return acc
  }, new Map())
  const lines = await em.find(SalesOrderLine, { order })
  lines.forEach((line) => {
    const shipped = totals.get(line.id) ?? 0
    line.fulfilledQuantity = shipped.toString()
  })
}

async function loadOrder(em: EntityManager, id: string): Promise<SalesOrder> {
  const order = await em.findOne(SalesOrder, { id, deletedAt: null })
  if (!order) throw new CrudHttpError(404, { error: 'sales.shipments.not_found' })
  return order
}

async function loadShippedTotals(
  em: EntityManager,
  order: SalesOrder,
  excludeShipmentId?: string | null
): Promise<Map<string, number>> {
  const shipments = await em.find(SalesShipment, { order, deletedAt: null })
  const shipmentIds = shipments
    .map((entry) => entry.id)
    .filter((id) => !excludeShipmentId || id !== excludeShipmentId)
  if (!shipmentIds.length) return new Map()
  const items = await em.find(SalesShipmentItem, { shipment: { $in: shipmentIds } })
  return items.reduce<Map<string, number>>((acc, item) => {
    const lineId =
      typeof item.orderLine === 'string'
        ? item.orderLine
        : item.orderLine?.id ?? (item as any).orderLineId ?? null
    if (!lineId) return acc
    const next = (acc.get(lineId) ?? 0) + toNumber(item.quantity)
    acc.set(lineId, next)
    return acc
  }, new Map())
}

async function validateShipmentItems(params: {
  em: EntityManager
  order: SalesOrder
  items?: ShipmentCreateInput['items']
  excludeShipmentId?: string | null
}): Promise<{
  items: Array<{ orderLineId: string; quantity: number; metadata: Record<string, unknown> | null }>
  lineMap: Map<string, SalesOrderLine>
}> {
  const { em, order, items, excludeShipmentId } = params
  const { translate } = await resolveTranslations()
  if (!items || !items.length) {
    throw new CrudHttpError(400, { error: translate('sales.shipments.items_required', 'Add at least one line to ship.') })
  }
  const orderLines = await em.find(SalesOrderLine, { order })
  const lineMap = new Map(orderLines.map((line) => [line.id, line]))
  const shippedTotals = await loadShippedTotals(em, order, excludeShipmentId)
  const requestedTotals = new Map<string, number>()

  for (const item of items) {
    const lineId = item.orderLineId
    const quantity = toNumber(item.quantity)
    if (!lineId || quantity <= 0) {
      throw new CrudHttpError(400, { error: translate('sales.shipments.items_required', 'Add at least one line to ship.') })
    }
    const line = lineMap.get(lineId)
    if (!line) {
      throw new CrudHttpError(404, { error: translate('sales.shipments.line_missing', 'Order line not found.') })
    }
    const lineTotal = toNumber(line.quantity)
    const alreadyShipped = shippedTotals.get(lineId) ?? 0
    const nextTotal = (requestedTotals.get(lineId) ?? 0) + quantity
    if (nextTotal + alreadyShipped - 1e-6 > lineTotal) {
      throw new CrudHttpError(400, { error: translate('sales.shipments.quantity_exceeded', 'Cannot ship more than the remaining quantity.') })
    }
    requestedTotals.set(lineId, nextTotal)
  }

  return {
    items: items.map((item) => ({
      orderLineId: item.orderLineId,
      quantity: toNumber(item.quantity),
      metadata: item.metadata ? cloneJson(item.metadata) : null,
    })),
    lineMap,
  }
}

function mergeAddressSnapshot(
  baseMetadata: Record<string, unknown> | null | undefined,
  snapshot: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const metadata = baseMetadata ? { ...baseMetadata } : {}
  if (snapshot && typeof snapshot === 'object') {
    metadata[ADDRESS_SNAPSHOT_KEY] = cloneJson(snapshot)
  }
  return Object.keys(metadata).length ? metadata : null
}

const createShipmentCommand: CommandHandler<ShipmentCreateInput, { shipmentId: string }> = {
  id: 'sales.shipments.create',
  async execute(rawInput, ctx) {
    const input = shipmentCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await loadOrder(em, input.orderId)
    ensureSameScope(order, input.organizationId, input.tenantId)
    const { translate } = await resolveTranslations()
    const { items: normalizedItems, lineMap } = await validateShipmentItems({
      em,
      order,
      items: input.items,
    })
    const statusValue = await resolveDictionaryEntryValue(em, input.statusEntryId ?? null)
    const trackingNumbers = parseTrackingNumbers(input.trackingNumbers) ?? null
    const metadata =
      mergeAddressSnapshot(
        input.metadata ? cloneJson(input.metadata) : null,
        input.shipmentAddressSnapshot ?? order.shippingAddressSnapshot ?? null
      ) ?? null

    const shipmentId = randomUUID()
    const shipment = em.create(SalesShipment, {
      id: shipmentId,
      order,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      shipmentNumber: input.shipmentNumber ?? null,
      shippingMethodId: input.shippingMethodId ?? null,
      statusEntryId: input.statusEntryId ?? null,
      status: statusValue,
      carrierName: input.carrierName ?? null,
      trackingNumbers,
      shippedAt: input.shippedAt ?? null,
      deliveredAt: input.deliveredAt ?? null,
      weightValue: input.weightValue !== undefined ? input.weightValue.toString() : null,
      weightUnit: input.weightUnit ?? null,
      declaredValueNet: input.declaredValueNet !== undefined ? input.declaredValueNet.toString() : null,
      declaredValueGross: input.declaredValueGross !== undefined ? input.declaredValueGross.toString() : null,
      currencyCode: input.currencyCode ?? order.currencyCode ?? null,
      notesText: input.notes ?? null,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const createdItems: SalesShipmentItem[] = []
    normalizedItems.forEach((item) => {
      const lineRef = em.getReference(SalesOrderLine, item.orderLineId)
      const shipmentItem = em.create(SalesShipmentItem, {
        id: randomUUID(),
        shipment,
        orderLine: lineRef,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        quantity: item.quantity.toString(),
        metadata: item.metadata ? cloneJson(item.metadata) : null,
      })
      createdItems.push(shipmentItem)
      em.persist(shipmentItem)
    })
    em.persist(shipment)
    if (input.customFields !== undefined) {
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_shipment,
        recordId: shipment.id,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        values: normalizeCustomFieldsInput(input.customFields),
      })
    }
    if (input.documentStatusEntryId !== undefined) {
      const orderStatus = await resolveDictionaryEntryValue(em, input.documentStatusEntryId ?? null)
      if (input.documentStatusEntryId && !orderStatus) {
        throw new CrudHttpError(400, { error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.') })
      }
      order.statusEntryId = input.documentStatusEntryId ?? null
      order.status = orderStatus
      order.updatedAt = new Date()
    }
    if (input.lineStatusEntryId !== undefined) {
      const lineStatus = await resolveDictionaryEntryValue(em, input.lineStatusEntryId ?? null)
      if (input.lineStatusEntryId && !lineStatus) {
        throw new CrudHttpError(400, { error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.') })
      }
      const uniqueLineIds = Array.from(new Set(normalizedItems.map((item) => item.orderLineId)))
      uniqueLineIds.forEach((lineId) => {
        const line = lineMap.get(lineId)
        if (!line) return
        line.statusEntryId = input.lineStatusEntryId ?? null
        line.status = lineStatus
        line.updatedAt = new Date()
      })
    }
    await refreshShipmentItemsSnapshot(em, shipment, { items: createdItems, lineMap })
    await em.flush()
    await recomputeFulfilledQuantities(em, order)
    await em.flush()
    return { shipmentId: shipment.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadShipmentSnapshot(em, result.shipmentId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as ShipmentSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.shipments.create', 'Create shipment'),
      resourceKind: 'sales.shipment',
      resourceId: result.shipmentId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies ShipmentUndoPayload,
        __redoInput: buildShipmentCreateRedoInput(after),
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ShipmentUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(SalesShipment, { id: after.id }, { populate: ['order'] })
    if (existing) {
      const order = existing.order as SalesOrder | null
      await deleteShipmentWithItems(em, existing)
      if (order) {
        await recomputeFulfilledQuantities(em, order)
        await em.flush()
      }
      return
    }
  },
}

const updateShipmentCommand: CommandHandler<ShipmentUpdateInput, { shipmentId: string }> = {
  id: 'sales.shipments.update',
  async prepare(rawInput, ctx) {
    const parsed = shipmentUpdateSchema.parse(rawInput ?? {})
    if (!parsed.id) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadShipmentSnapshot(em, parsed.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const input = shipmentUpdateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const shipment = await em.findOne(
      SalesShipment,
      { id: input.id },
      { populate: ['order'] }
    )
    const { translate } = await resolveTranslations()
    if (!shipment || !shipment.order) {
      throw new CrudHttpError(404, { error: 'sales.shipments.not_found' })
    }
    ensureSameScope(shipment, input.organizationId, input.tenantId)
    const order = shipment.order as SalesOrder
    if (input.orderId && input.orderId !== order.id) {
      throw new CrudHttpError(400, { error: 'sales.shipments.invalid_order' })
    }
    const validatedItems = input.items
      ? await validateShipmentItems({
          em,
          order,
          items: input.items,
          excludeShipmentId: shipment.id,
        })
      : null
    const normalizedItems = validatedItems?.items ?? null
    const lineMap = validatedItems?.lineMap ?? new Map<string, SalesOrderLine>()
    if (input.shipmentNumber !== undefined) shipment.shipmentNumber = input.shipmentNumber ?? null
    if (input.shippingMethodId !== undefined) shipment.shippingMethodId = input.shippingMethodId ?? null
    if (input.statusEntryId !== undefined) {
      shipment.statusEntryId = input.statusEntryId ?? null
      shipment.status = await resolveDictionaryEntryValue(em, input.statusEntryId ?? null)
    }
    if (input.carrierName !== undefined) shipment.carrierName = input.carrierName ?? null
    if (input.trackingNumbers !== undefined) shipment.trackingNumbers = parseTrackingNumbers(input.trackingNumbers)
    if (input.shippedAt !== undefined) shipment.shippedAt = input.shippedAt ?? null
    if (input.deliveredAt !== undefined) shipment.deliveredAt = input.deliveredAt ?? null
    if (input.weightValue !== undefined) shipment.weightValue = input.weightValue !== null ? input.weightValue.toString() : null
    if (input.weightUnit !== undefined) shipment.weightUnit = input.weightUnit ?? null
    if (input.declaredValueNet !== undefined) {
      shipment.declaredValueNet = input.declaredValueNet !== null ? input.declaredValueNet.toString() : null
    }
    if (input.declaredValueGross !== undefined) {
      shipment.declaredValueGross = input.declaredValueGross !== null ? input.declaredValueGross.toString() : null
    }
    if (input.currencyCode !== undefined) shipment.currencyCode = input.currencyCode ?? null
    if (input.notes !== undefined) shipment.notesText = input.notes ?? null
    if (input.metadata !== undefined || input.shipmentAddressSnapshot !== undefined) {
      shipment.metadata = mergeAddressSnapshot(
        input.metadata ? cloneJson(input.metadata) : shipment.metadata ?? null,
        input.shipmentAddressSnapshot
      )
    }
    shipment.updatedAt = new Date()

    const shouldLoadItems = Boolean(normalizedItems || input.lineStatusEntryId !== undefined)
    const existingItems = shouldLoadItems ? await em.find(SalesShipmentItem, { shipment }) : []
    const newItems: SalesShipmentItem[] = []
    if (normalizedItems) {
      existingItems.forEach((item) => em.remove(item))
      normalizedItems.forEach((item) => {
        const lineRef = em.getReference(SalesOrderLine, item.orderLineId)
        const shipmentItem = em.create(SalesShipmentItem, {
          id: randomUUID(),
          shipment,
          orderLine: lineRef,
          organizationId: shipment.organizationId,
          tenantId: shipment.tenantId,
          quantity: item.quantity.toString(),
          metadata: item.metadata ? cloneJson(item.metadata) : null,
        })
        newItems.push(shipmentItem)
        em.persist(shipmentItem)
      })
    }

    if (input.customFields !== undefined) {
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_shipment,
        recordId: shipment.id,
        organizationId: shipment.organizationId,
        tenantId: shipment.tenantId,
        values: normalizeCustomFieldsInput(input.customFields),
      })
    }
    if (input.documentStatusEntryId !== undefined) {
      const orderStatus = await resolveDictionaryEntryValue(em, input.documentStatusEntryId ?? null)
      if (input.documentStatusEntryId && !orderStatus) {
        throw new CrudHttpError(400, { error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.') })
      }
      order.statusEntryId = input.documentStatusEntryId ?? null
      order.status = orderStatus
      order.updatedAt = new Date()
    }
    if (input.lineStatusEntryId !== undefined) {
      const lineStatus = await resolveDictionaryEntryValue(em, input.lineStatusEntryId ?? null)
      if (input.lineStatusEntryId && !lineStatus) {
        throw new CrudHttpError(400, { error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.') })
      }
      const targetLineIds = normalizedItems
        ? Array.from(new Set(normalizedItems.map((item) => item.orderLineId)))
        : Array.from(
            new Set(
              existingItems
                .map((item) =>
                  typeof item.orderLine === 'string'
                    ? item.orderLine
                    : (item.orderLine as SalesOrderLine | null)?.id ?? null
                )
                .filter((id): id is string => Boolean(id))
            )
          )
      if (targetLineIds.length) {
        const missing = targetLineIds.filter((id) => !lineMap.has(id))
        if (missing.length) {
          const fetched = await em.find(SalesOrderLine, { id: { $in: missing } })
          fetched.forEach((line) => lineMap.set(line.id, line))
        }
        targetLineIds.forEach((lineId) => {
          const line = lineMap.get(lineId)
          if (!line) return
          line.statusEntryId = input.lineStatusEntryId ?? null
          line.status = lineStatus
          line.updatedAt = new Date()
        })
      }
    }

    const itemsForSnapshot =
      normalizedItems || shouldLoadItems
        ? (normalizedItems ? newItems : existingItems)
        : await em.find(SalesShipmentItem, { shipment })
    await refreshShipmentItemsSnapshot(em, shipment, { items: itemsForSnapshot, lineMap })
    await em.flush()
    await recomputeFulfilledQuantities(em, order)
    await em.flush()
    return { shipmentId: shipment.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadShipmentSnapshot(em, result.shipmentId)
  },
  buildLog: async ({ snapshots, result }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as ShipmentSnapshot | undefined
    const after = snapshots.after as ShipmentSnapshot | undefined
    return {
      actionLabel: translate('sales.audit.shipments.update', 'Update shipment'),
      resourceKind: 'sales.shipment',
      resourceId: result.shipmentId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: { before, after } satisfies ShipmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ShipmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restoreShipmentSnapshot(em, before)
    const order = await em.findOne(SalesOrder, { id: before.orderId })
    await em.flush()
    if (order) {
      await recomputeFulfilledQuantities(em, order)
      await em.flush()
    }
  },
}

const deleteShipmentCommand: CommandHandler<
  { id: string; orderId: string; organizationId: string; tenantId: string },
  { shipmentId: string }
> = {
  id: 'sales.shipments.delete',
  async prepare(rawInput, ctx) {
    const parsed = shipmentUpdateSchema.parse(rawInput ?? {})
    if (!parsed.id) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadShipmentSnapshot(em, parsed.id)
    if (snapshot) {
      try {
        ensureTenantScope(ctx, snapshot.tenantId)
      } catch (error) {
        logShipmentDeleteScopeRejection(ctx, 'Tenant mismatch while preparing shipment delete', {
          shipmentId: snapshot.id,
          snapshotTenantId: snapshot.tenantId,
          authTenantId: ctx.auth?.tenantId ?? null,
        })
        throw error
      }
      try {
        ensureOrganizationScope(ctx, snapshot.organizationId)
      } catch (error) {
        logShipmentDeleteScopeRejection(ctx, 'Organization mismatch while preparing shipment delete', {
          shipmentId: snapshot.id,
          snapshotOrganizationId: snapshot.organizationId,
          selectedOrganizationId: ctx.selectedOrganizationId ?? null,
          authOrganizationId: ctx.auth?.orgId ?? null,
        })
        throw error
      }
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { translate } = await resolveTranslations()
    const payload = shipmentUpdateSchema
      .pick({ id: true, orderId: true, organizationId: true, tenantId: true })
      .parse(rawInput ?? {})
    try {
      ensureTenantScope(ctx, payload.tenantId)
    } catch (error) {
      logShipmentDeleteScopeRejection(ctx, 'Tenant mismatch while executing shipment delete', {
        shipmentId: payload.id,
        payloadTenantId: payload.tenantId,
        authTenantId: ctx.auth?.tenantId ?? null,
      })
      throw error
    }
    try {
      ensureOrganizationScope(ctx, payload.organizationId)
    } catch (error) {
      logShipmentDeleteScopeRejection(ctx, 'Organization mismatch while executing shipment delete', {
        shipmentId: payload.id,
        payloadOrganizationId: payload.organizationId,
        selectedOrganizationId: ctx.selectedOrganizationId ?? null,
        authOrganizationId: ctx.auth?.orgId ?? null,
      })
      throw error
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const shipment = await em.findOne(
      SalesShipment,
      { id: payload.id },
      { populate: ['order'] }
    )
    if (!shipment || !shipment.order) {
      throw new CrudHttpError(404, { error: translate('sales.shipments.not_found', 'Shipment not found') })
    }
    try {
      ensureSameScope(shipment, payload.organizationId, payload.tenantId)
    } catch (error) {
      logShipmentDeleteScopeRejection(ctx, 'Shipment scope mismatch against payload', {
        shipmentId: payload.id,
        shipmentOrganizationId: shipment.organizationId,
        shipmentTenantId: shipment.tenantId,
        payloadOrganizationId: payload.organizationId,
        payloadTenantId: payload.tenantId,
      })
      throw error
    }
    const order = shipment.order as SalesOrder
    if (order.id !== payload.orderId) {
      throw new CrudHttpError(400, { error: translate('sales.shipments.invalid_order', 'Shipment does not belong to this order') })
    }
    await deleteShipmentWithItems(em, shipment)
    await recomputeFulfilledQuantities(em, order)
    await em.flush()
    return { shipmentId: shipment.id }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ShipmentUndoPayload>(logEntry)
    const snapshot = payload?.before ?? null
    if (!snapshot) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restoreShipmentSnapshot(em, snapshot)
    const order = await em.findOne(SalesOrder, { id: snapshot.orderId })
    await em.flush()
    if (order) {
      await recomputeFulfilledQuantities(em, order)
      await em.flush()
    }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ShipmentSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.shipments.delete', 'Delete shipment'),
      resourceKind: 'sales.shipment',
      resourceId: before.id ?? null,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies ShipmentUndoPayload,
      },
    }
  },
}

registerCommand(createShipmentCommand)
registerCommand(updateShipmentCommand)
registerCommand(deleteShipmentCommand)

export const shipmentCommands = [createShipmentCommand, updateShipmentCommand, deleteShipmentCommand]
