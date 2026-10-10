import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { FreightOrder } from '../data/entities'
import {
  assignOrderSchema,
  cancelOrderSchema,
  createOrderSchema,
  deliverOrderSchema,
  orderActionSchema,
  updateOrderSchema,
  type AssignOrderInput,
  type CancelOrderInput,
  type DeliverOrderInput,
} from '../data/validators'
import { registerCrudCommands, resolveScope, type CrudCommandConfig } from './crud'
import { FREIGHT_ORDER_ENTITY_ID, freightOrderEvents, freightOrderIndexer } from './entities'
import { raiseFreightError } from '../lib/errors'
import { readFreightSettings, type FreightScope, type FreightSettings } from '../lib/freightSettings'
import { allocateDocumentNumber } from '../lib/documentNumber'
import { assertFreightAssignmentAvailable } from '../lib/assignment'
import { buildInvoiceDraft } from '../lib/invoiceDraft'
import { toAmountNumber } from '../lib/money'
import {
  createFreightSalesInvoice,
  deleteSalesInvoiceQuietly,
  deleteSalesOrderQuietly,
} from '../lib/salesBridge'
import { emitFreightEvent } from '../events'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

async function loadSettings(ctx: CommandRuntimeContext, scope: FreightScope): Promise<FreightSettings> {
  const configService = ctx.container.resolve('moduleConfigService') as ModuleConfigService
  return readFreightSettings(configService, scope)
}

function entityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

/**
 * Load and pessimistically lock an order, then enforce the OSS optimistic-lock
 * floor through the async DI-aware seam (strictly additive: a no-op without the
 * expected-version header, which the list row actions send). The locked row's
 * pre-mutation `updatedAt` is the version being compared.
 */
async function findOrderForUpdate(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: FreightScope,
  id: string,
): Promise<FreightOrder> {
  const order = await em.findOne(
    FreightOrder,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  )
  if (!order) return raiseFreightError(404, 'order_not_found', 'Freight order not found.')
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: FREIGHT_ORDER_ENTITY_ID,
    resourceId: order.id,
    current: order.updatedAt,
    request: ctx.request ?? null,
  })
  return order
}

async function emitOrderUpdate(
  ctx: CommandRuntimeContext,
  order: FreightOrder,
  scope: FreightScope,
  actorUserId: string | null,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: order,
    identifiers: { id: order.id, ...scope },
    actorUserId,
    events: freightOrderEvents,
    indexer: freightOrderIndexer,
  })
}

async function emitOrderLifecycle(
  eventId: Parameters<typeof emitFreightEvent>[0],
  order: FreightOrder,
  scope: FreightScope,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await emitFreightEvent(eventId, {
    id: order.id,
    orderNumber: order.orderNumber,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...extra,
  })
}

const orderCrudConfig: CrudCommandConfig<FreightOrder> = {
  entity: FreightOrder,
  entityId: FREIGHT_ORDER_ENTITY_ID,
  resource: 'orders',
  createSchema: createOrderSchema,
  updateSchema: updateOrderSchema,
  toCreateData: async (input, ctx) => {
    const scope = resolveScope(ctx)
    const settings = await loadSettings(ctx, scope)
    const em = entityManager(ctx)
    const orderNumber = await allocateDocumentNumber(em, scope, 'order', settings)
    return {
      orderNumber,
      status: 'draft',
      customerId: String(input.customerId),
      customerSnapshot: input.customerSnapshot as Record<string, unknown>,
      cargoDescription: String(input.cargoDescription),
      cargoWeightKg: optionalString(input.cargoWeightKg),
      cargoVolumeM3: optionalString(input.cargoVolumeM3),
      cargoQuantity: optionalString(input.cargoQuantity),
      cargoUnit: (input.cargoUnit as FreightOrder['cargoUnit']) ?? null,
      cargoHazardous: Boolean(input.cargoHazardous ?? false),
      cargoRefrigerated: Boolean(input.cargoRefrigerated ?? false),
      temperatureMinC: optionalString(input.temperatureMinC),
      temperatureMaxC: optionalString(input.temperatureMaxC),
      pickupLocation: String(input.pickupLocation),
      dropoffLocation: String(input.dropoffLocation),
      pickupAddressSnapshot: (input.pickupAddressSnapshot as Record<string, unknown> | null | undefined) ?? null,
      dropoffAddressSnapshot: (input.dropoffAddressSnapshot as Record<string, unknown> | null | undefined) ?? null,
      requestedPickupAt: toDate(input.requestedPickupAt),
      requestedDeliveryAt: toDate(input.requestedDeliveryAt),
      truckTypeRequired: (input.truckTypeRequired as FreightOrder['truckTypeRequired']) ?? 'other',
      agreedAmountNet: String(input.agreedAmountNet),
      adjustmentAmountNet: optionalString(input.adjustmentAmountNet),
      adjustmentNote: optionalString(input.adjustmentNote),
      currencyCode: typeof input.currencyCode === 'string' ? input.currencyCode : 'SAR',
      vatRate: input.vatRate === undefined ? String(settings.defaultVatRate * 100) : String(input.vatRate),
      notes: optionalString(input.notes),
    }
  },
  toUpdateData: (input) =>
    compact({
      customerId: input.customerId === undefined ? undefined : String(input.customerId),
      customerSnapshot: input.customerSnapshot,
      cargoDescription: input.cargoDescription === undefined ? undefined : String(input.cargoDescription),
      cargoWeightKg: optionalString(input.cargoWeightKg),
      cargoVolumeM3: optionalString(input.cargoVolumeM3),
      cargoQuantity: optionalString(input.cargoQuantity),
      cargoUnit: input.cargoUnit,
      cargoHazardous: input.cargoHazardous,
      cargoRefrigerated: input.cargoRefrigerated,
      temperatureMinC: optionalString(input.temperatureMinC),
      temperatureMaxC: optionalString(input.temperatureMaxC),
      pickupLocation: input.pickupLocation === undefined ? undefined : String(input.pickupLocation),
      dropoffLocation: input.dropoffLocation === undefined ? undefined : String(input.dropoffLocation),
      pickupAddressSnapshot: input.pickupAddressSnapshot,
      dropoffAddressSnapshot: input.dropoffAddressSnapshot,
      requestedPickupAt: toDate(input.requestedPickupAt),
      requestedDeliveryAt: toDate(input.requestedDeliveryAt),
      truckTypeRequired: input.truckTypeRequired,
      agreedAmountNet: input.agreedAmountNet === undefined ? undefined : String(input.agreedAmountNet),
      adjustmentAmountNet: optionalString(input.adjustmentAmountNet),
      adjustmentNote: optionalString(input.adjustmentNote),
      currencyCode: input.currencyCode,
      vatRate: input.vatRate === undefined ? undefined : String(input.vatRate),
      notes: optionalString(input.notes),
    }),
  events: freightOrderEvents,
  indexer: freightOrderIndexer,
  beforeUpdate: async (input, current) => {
    const order = current as FreightOrder
    if (order.status !== 'draft' && order.status !== 'confirmed') {
      return raiseFreightError(409, 'order_not_editable', 'Only draft or confirmed orders can be edited.')
    }
  },
  beforeDelete: async (current) => {
    const order = current as FreightOrder
    if (order.salesInvoiceId || order.status === 'invoiced') {
      return raiseFreightError(409, 'order_not_deletable', 'An invoiced order cannot be deleted.')
    }
  },
}

registerCrudCommands(orderCrudConfig)

const confirmOrderCommand: CommandHandler<{ id: string }, { orderId: string }> = {
  id: 'freight_operations.orders.confirm',
  async execute(rawInput, ctx) {
    const input = orderActionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const order = await em.transactional(async (tx) => {
      const locked = await findOrderForUpdate(ctx, tx, scope, input.id)
      if (locked.status !== 'draft') {
        return raiseFreightError(409, 'order_not_draft', 'Only draft orders can be confirmed.')
      }
      locked.status = 'confirmed'
      locked.updatedAt = new Date()
      await tx.persist(locked).flush()
      return locked
    })
    await emitOrderUpdate(ctx, order, scope, ctx.auth?.sub ?? null)
    await emitOrderLifecycle('freight_operations.order.confirmed', order, scope)
    return { orderId: order.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Confirm freight order',
      resourceKind: FREIGHT_ORDER_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

function assignmentWindow(order: FreightOrder): { start: Date; end: Date } {
  const start = order.requestedPickupAt ?? new Date()
  const end = order.requestedDeliveryAt ?? new Date(start.getTime() + ONE_DAY_MS)
  return { start, end }
}

const assignOrderCommand: CommandHandler<AssignOrderInput, { orderId: string }> = {
  id: 'freight_operations.orders.assign',
  async execute(rawInput, ctx) {
    const input = assignOrderSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const order = await em.transactional(async (tx) => {
      const locked = await findOrderForUpdate(ctx, tx, scope, input.id)
      if (locked.status !== 'confirmed' && locked.status !== 'assigned') {
        return raiseFreightError(409, 'order_not_assignable', 'Only confirmed orders can be assigned.')
      }
      const { start, end } = assignmentWindow(locked)
      const snapshots = await assertFreightAssignmentAvailable(
        tx,
        { orderId: locked.id, vehicleId: input.vehicleId, driverId: input.driverId, start, end },
        scope,
      )
      locked.vehicleId = input.vehicleId
      locked.driverId = input.driverId
      locked.vehicleSnapshot = snapshots.vehicleSnapshot
      locked.driverSnapshot = snapshots.driverSnapshot
      locked.transportTripId = input.transportTripId ?? null
      locked.status = 'assigned'
      locked.assignedAt = locked.assignedAt ?? new Date()
      locked.updatedAt = new Date()
      await tx.persist(locked).flush()
      return locked
    })
    await emitOrderUpdate(ctx, order, scope, ctx.auth?.sub ?? null)
    await emitOrderLifecycle('freight_operations.order.assigned', order, scope, {
      vehicleId: order.vehicleId,
      driverId: order.driverId,
    })
    return { orderId: order.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Assign freight order',
      resourceKind: FREIGHT_ORDER_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const dispatchOrderCommand: CommandHandler<{ id: string }, { orderId: string }> = {
  id: 'freight_operations.orders.dispatch',
  async execute(rawInput, ctx) {
    const input = orderActionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const order = await em.transactional(async (tx) => {
      const locked = await findOrderForUpdate(ctx, tx, scope, input.id)
      if (locked.status !== 'assigned') {
        return raiseFreightError(409, 'order_not_assigned', 'Only assigned orders can be dispatched.')
      }
      if (locked.vehicleId && locked.driverId) {
        const { start, end } = assignmentWindow(locked)
        await assertFreightAssignmentAvailable(
          tx,
          { orderId: locked.id, vehicleId: locked.vehicleId, driverId: locked.driverId, start, end },
          scope,
        )
      }
      locked.status = 'in_transit'
      locked.dispatchedAt = new Date()
      locked.updatedAt = new Date()
      await tx.persist(locked).flush()
      return locked
    })
    await emitOrderUpdate(ctx, order, scope, ctx.auth?.sub ?? null)
    await emitOrderLifecycle('freight_operations.order.dispatched', order, scope)
    return { orderId: order.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Dispatch freight order',
      resourceKind: FREIGHT_ORDER_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const deliverOrderCommand: CommandHandler<DeliverOrderInput, { orderId: string }> = {
  id: 'freight_operations.orders.deliver',
  async execute(rawInput, ctx) {
    const input = deliverOrderSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const settings = await loadSettings(ctx, scope)
    const em = entityManager(ctx)
    const order = await em.transactional(async (tx) => {
      const locked = await findOrderForUpdate(ctx, tx, scope, input.id)
      if (locked.status !== 'in_transit') {
        return raiseFreightError(409, 'order_not_in_transit', 'Only orders in transit can be delivered.')
      }
      const podDocumentId = input.podDocumentId ?? null
      const podReference = input.podReference ?? null
      if (settings.requirePodForBilling && !podDocumentId && !podReference) {
        return raiseFreightError(409, 'pod_required', 'A proof of delivery is required before delivery can be recorded.')
      }
      const deliveredAt = new Date()
      locked.status = 'delivered'
      locked.deliveredAt = deliveredAt
      locked.podDocumentId = podDocumentId ?? locked.podDocumentId ?? null
      locked.podReference = podReference ?? locked.podReference ?? null
      locked.podReceivedByName = input.podReceivedByName ?? locked.podReceivedByName ?? null
      locked.podReceivedAt = toDate(input.podReceivedAt) ?? locked.podReceivedAt ?? deliveredAt
      locked.updatedAt = deliveredAt
      await tx.persist(locked).flush()
      return locked
    })
    await emitOrderUpdate(ctx, order, scope, ctx.auth?.sub ?? null)
    await emitOrderLifecycle('freight_operations.order.delivered', order, scope)
    return { orderId: order.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Deliver freight order',
      resourceKind: FREIGHT_ORDER_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const completeOrderCommand: CommandHandler<{ id: string }, { orderId: string }> = {
  id: 'freight_operations.orders.complete',
  async execute(rawInput, ctx) {
    const input = orderActionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const order = await em.transactional(async (tx) => {
      const locked = await findOrderForUpdate(ctx, tx, scope, input.id)
      if (locked.status !== 'delivered') {
        return raiseFreightError(409, 'order_not_delivered', 'Only delivered orders can be completed.')
      }
      locked.status = 'completed'
      locked.completedAt = new Date()
      locked.updatedAt = new Date()
      await tx.persist(locked).flush()
      return locked
    })
    await emitOrderUpdate(ctx, order, scope, ctx.auth?.sub ?? null)
    await emitOrderLifecycle('freight_operations.order.completed', order, scope)
    return { orderId: order.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Complete freight order',
      resourceKind: FREIGHT_ORDER_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const cancelOrderCommand: CommandHandler<CancelOrderInput, { orderId: string }> = {
  id: 'freight_operations.orders.cancel',
  async execute(rawInput, ctx) {
    const input = cancelOrderSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const order = await em.transactional(async (tx) => {
      const locked = await findOrderForUpdate(ctx, tx, scope, input.id)
      if (locked.status === 'invoiced' || locked.status === 'cancelled') {
        return raiseFreightError(409, 'order_not_cancellable', 'An invoiced or cancelled order cannot be cancelled.')
      }
      locked.status = 'cancelled'
      locked.cancellationReason = input.reason ?? null
      locked.updatedAt = new Date()
      await tx.persist(locked).flush()
      return locked
    })
    await emitOrderUpdate(ctx, order, scope, ctx.auth?.sub ?? null)
    await emitOrderLifecycle('freight_operations.order.cancelled', order, scope)
    return { orderId: order.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Cancel freight order',
      resourceKind: FREIGHT_ORDER_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

export type InvoiceOrderResult = {
  orderId: string
  salesOrderId: string
  salesInvoiceId: string
  salesInvoiceNumber: string | null
}

const invoiceOrderCommand: CommandHandler<{ id: string }, InvoiceOrderResult> = {
  id: 'freight_operations.orders.invoice',
  async execute(rawInput, ctx) {
    const input = orderActionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const order = await em.findOne(FreightOrder, {
      id: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!order) return raiseFreightError(404, 'order_not_found', 'Freight order not found.')
    if (order.status !== 'completed') {
      return raiseFreightError(409, 'order_not_completed', 'Only completed orders can be invoiced.')
    }
    if (order.salesOrderId || order.salesInvoiceId) {
      return raiseFreightError(409, 'order_already_invoiced', 'This order already has a sales invoice.')
    }

    const settings = await loadSettings(ctx, scope)
    const netAmount = toAmountNumber(order.agreedAmountNet) + toAmountNumber(order.adjustmentAmountNet)
    if (netAmount < 0) {
      return raiseFreightError(409, 'invalid_invoice_amount', 'The invoice amount cannot be negative.')
    }

    const { translate } = await resolveTranslations()
    const lineName = translate('freight_operations.invoice.line.orderName', 'Freight transport {orderNumber}')
      .replaceAll('{orderNumber}', order.orderNumber)
    const draft = buildInvoiceDraft(
      [
        {
          name: lineName,
          description: `${order.cargoDescription}\n${order.pickupLocation} → ${order.dropoffLocation}`,
          netAmount,
          taxRatePercent: order.vatRate,
        },
      ],
      order.vatRate,
    )
    const dueAt = new Date(Date.now() + settings.defaultPaymentTermsDays * ONE_DAY_MS)

    const bridgeResult = await createFreightSalesInvoice(ctx, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      customerEntityId: order.customerId,
      currencyCode: order.currencyCode,
      externalReference: order.orderNumber,
      metadata: { freight: { orderId: order.id, orderNumber: order.orderNumber } },
      dueAt,
      channelId: settings.salesChannelId,
      draft,
    })

    try {
      await em.transactional(async (tx) => {
        const locked = await findOrderForUpdate(ctx, tx, scope, order.id)
        if (locked.salesOrderId || locked.salesInvoiceId) {
          return raiseFreightError(409, 'order_already_invoiced', 'This order already has a sales invoice.')
        }
        locked.salesOrderId = bridgeResult.salesOrderId
        locked.salesInvoiceId = bridgeResult.salesInvoiceId
        locked.invoicedAt = new Date()
        locked.status = 'invoiced'
        locked.updatedAt = new Date()
        await tx.persist(locked).flush()
        order.salesOrderId = locked.salesOrderId
        order.salesInvoiceId = locked.salesInvoiceId
        order.status = 'invoiced'
        order.updatedAt = locked.updatedAt
      })
    } catch (err) {
      await deleteSalesInvoiceQuietly(ctx, scope, bridgeResult.salesInvoiceId)
      await deleteSalesOrderQuietly(ctx, bridgeResult.salesOrderId)
      throw err
    }

    await emitOrderUpdate(ctx, order, scope, ctx.auth?.sub ?? null)
    await emitOrderLifecycle('freight_operations.order.invoiced', order, scope, {
      salesOrderId: bridgeResult.salesOrderId,
      salesInvoiceId: bridgeResult.salesInvoiceId,
      salesInvoiceNumber: bridgeResult.salesInvoiceNumber,
    })
    return {
      orderId: order.id,
      salesOrderId: bridgeResult.salesOrderId,
      salesInvoiceId: bridgeResult.salesInvoiceId,
      salesInvoiceNumber: bridgeResult.salesInvoiceNumber,
    }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Invoice freight order',
      resourceKind: FREIGHT_ORDER_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(confirmOrderCommand)
registerCommand(assignOrderCommand)
registerCommand(dispatchOrderCommand)
registerCommand(deliverOrderCommand)
registerCommand(completeOrderCommand)
registerCommand(cancelOrderCommand)
registerCommand(invoiceOrderCommand)
