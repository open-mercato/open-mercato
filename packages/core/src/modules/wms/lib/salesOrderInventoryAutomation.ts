import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import { SalesOrder, SalesOrderLine } from '../../sales/data/entities'
import { InventoryBalance, InventoryReservation } from '../data/entities'

const SALES_ORDER_INVENTORY_TOGGLE = 'wms_integration_sales_order_inventory'

type EventContext = {
  resolve: <T = unknown>(name: string) => T
}

type SalesOrderLifecyclePayload = {
  orderId?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

type Scope = {
  tenantId: string
  organizationId: string
}

type WarehouseAvailability = {
  warehouseId: string
  available: number
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function getWarehouseId(balance: InventoryBalance): string | null {
  const relation = balance.warehouse as { id?: string } | string | undefined
  if (typeof relation === 'string') return relation
  return typeof relation?.id === 'string' ? relation.id : null
}

function buildCommandContext(ctx: EventContext, scope: Scope): CommandRuntimeContext {
  return {
    container: {
      resolve: ctx.resolve,
    } as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

async function isInventoryAutomationEnabled(ctx: EventContext, tenantId: string): Promise<boolean> {
  try {
    const featureTogglesService = ctx.resolve<FeatureTogglesService>('featureTogglesService')
    const toggle = await featureTogglesService.getBoolConfig(SALES_ORDER_INVENTORY_TOGGLE, tenantId)
    return toggle.ok ? toggle.value : true
  } catch {
    return true
  }
}

async function loadOrder(em: EntityManager, orderId: string, scope: Scope): Promise<SalesOrder | null> {
  return findOneWithDecryption(
    em,
    SalesOrder,
    {
      id: orderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

async function loadOrderLines(em: EntityManager, orderId: string, scope: Scope): Promise<SalesOrderLine[]> {
  return findWithDecryption(
    em,
    SalesOrderLine,
    {
      order: orderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { orderBy: { lineNumber: 'asc' } },
    scope,
  )
}

async function loadActiveReservations(
  em: EntityManager,
  orderId: string,
  scope: Scope,
): Promise<InventoryReservation[]> {
  return findWithDecryption(
    em,
    InventoryReservation,
    {
      sourceType: 'order',
      sourceId: orderId,
      status: 'active',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
}

async function loadBalances(
  em: EntityManager,
  variantIds: string[],
  scope: Scope,
): Promise<InventoryBalance[]> {
  if (variantIds.length === 0) return []
  return findWithDecryption(
    em,
    InventoryBalance,
    {
      catalogVariantId: { $in: variantIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

function buildRequiredQuantityByVariant(lines: SalesOrderLine[]): Map<string, number> {
  const quantities = new Map<string, number>()
  for (const line of lines) {
    if (line.kind !== 'product' || !line.productVariantId) continue
    const quantity = toNumber(line.quantity)
    if (quantity <= 0) continue
    quantities.set(line.productVariantId, (quantities.get(line.productVariantId) ?? 0) + quantity)
  }
  return quantities
}

function buildReservedQuantityByVariant(reservations: InventoryReservation[]): Map<string, number> {
  const quantities = new Map<string, number>()
  for (const reservation of reservations) {
    quantities.set(
      reservation.catalogVariantId,
      (quantities.get(reservation.catalogVariantId) ?? 0) + toNumber(reservation.quantity),
    )
  }
  return quantities
}

function buildWarehouseAvailability(
  balances: InventoryBalance[],
): Map<string, WarehouseAvailability[]> {
  const byVariant = new Map<string, Map<string, number>>()
  for (const balance of balances) {
    const warehouseId = getWarehouseId(balance)
    if (!warehouseId) continue
    const available =
      toNumber(balance.quantityOnHand) -
      toNumber(balance.quantityReserved) -
      toNumber(balance.quantityAllocated)
    if (available <= 0) continue

    const warehouseMap = byVariant.get(balance.catalogVariantId) ?? new Map<string, number>()
    warehouseMap.set(warehouseId, (warehouseMap.get(warehouseId) ?? 0) + available)
    byVariant.set(balance.catalogVariantId, warehouseMap)
  }

  const result = new Map<string, WarehouseAvailability[]>()
  for (const [variantId, warehouseMap] of byVariant.entries()) {
    result.set(
      variantId,
      Array.from(warehouseMap.entries())
        .map(([warehouseId, available]) => ({ warehouseId, available }))
        .sort((a, b) => b.available - a.available),
    )
  }
  return result
}

export async function reserveInventoryForConfirmedOrder(
  payload: SalesOrderLifecyclePayload,
  ctx: EventContext,
): Promise<void> {
  if (!payload.orderId || !payload.tenantId || !payload.organizationId) return
  if (!(await isInventoryAutomationEnabled(ctx, payload.tenantId))) return

  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }
  const em = ctx.resolve<EntityManager>('em').fork()
  const commandBus = ctx.resolve<CommandBus>('commandBus')
  const commandCtx = buildCommandContext(ctx, scope)
  const order = await loadOrder(em, payload.orderId, scope)
  if (!order) return

  const [lines, activeReservations] = await Promise.all([
    loadOrderLines(em, order.id, scope),
    loadActiveReservations(em, order.id, scope),
  ])
  const requiredByVariant = buildRequiredQuantityByVariant(lines)
  if (requiredByVariant.size === 0) return

  const reservedByVariant = buildReservedQuantityByVariant(activeReservations)
  const balances = await loadBalances(em, Array.from(requiredByVariant.keys()), scope)
  const availabilityByVariant = buildWarehouseAvailability(balances)

  for (const [variantId, requiredQuantity] of requiredByVariant.entries()) {
    let remainingQuantity = requiredQuantity - (reservedByVariant.get(variantId) ?? 0)
    if (remainingQuantity <= 0) continue

    const warehouseAvailability = availabilityByVariant.get(variantId) ?? []
    for (const bucket of warehouseAvailability) {
      if (remainingQuantity <= 0) break
      const reserveQuantity = Math.min(remainingQuantity, bucket.available)
      if (reserveQuantity <= 0) continue

      await commandBus.execute('wms.inventory.reserve', {
        input: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          warehouseId: bucket.warehouseId,
          catalogVariantId: variantId,
          quantity: reserveQuantity,
          sourceType: 'order',
          sourceId: order.id,
          metadata: {
            automation: 'sales.order.confirmed',
            orderId: order.id,
            orderNumber: order.orderNumber,
            catalogVariantId: variantId,
          },
        },
        ctx: commandCtx,
      })

      remainingQuantity -= reserveQuantity
      bucket.available -= reserveQuantity
    }
  }
}

export async function releaseInventoryForCancelledOrder(
  payload: SalesOrderLifecyclePayload,
  ctx: EventContext,
): Promise<void> {
  if (!payload.orderId || !payload.tenantId || !payload.organizationId) return
  if (!(await isInventoryAutomationEnabled(ctx, payload.tenantId))) return

  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }
  const em = ctx.resolve<EntityManager>('em').fork()
  const commandBus = ctx.resolve<CommandBus>('commandBus')
  const commandCtx = buildCommandContext(ctx, scope)
  const activeReservations = await loadActiveReservations(em, payload.orderId, scope)

  for (const reservation of activeReservations) {
    await commandBus.execute('wms.inventory.release', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        reservationId: reservation.id,
        reason: 'sales.order.cancelled',
        metadata: {
          automation: 'sales.order.cancelled',
          orderId: payload.orderId,
        },
      },
      ctx: commandCtx,
    })
  }
}
