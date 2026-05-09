import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
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

type SalesOrderRow = {
  id?: string
  order_number?: string | null
  tenant_id?: string | null
  organization_id?: string | null
}

type SalesOrderLineRow = {
  id?: string
  kind?: string | null
  product_variant_id?: string | null
  quantity?: string | number | null
  line_number?: number | null
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

async function loadOrderViaQueryEngine(
  ctx: EventContext,
  orderId: string,
  scope: Scope,
): Promise<SalesOrderRow | null> {
  // Read sales orders/lines via QueryEngine instead of importing the sales ORM
  // entity classes — keeps the WMS module decoupled from sales internals.
  // Sales mutations also flush their CRUD side effects synchronously through
  // the command bus before this subscriber fires, so the query_index/base
  // table is consistent at this point.
  const queryEngine = ctx.resolve<QueryEngine>('queryEngine')
  const result = await queryEngine.query<SalesOrderRow>(E.sales.sales_order, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters: { id: { $eq: orderId } },
    fields: ['id', 'order_number', 'tenant_id', 'organization_id'],
    page: { page: 1, pageSize: 1 },
  })
  return result.items[0] ?? null
}

async function loadOrderLinesViaQueryEngine(
  ctx: EventContext,
  orderId: string,
  scope: Scope,
): Promise<SalesOrderLineRow[]> {
  const queryEngine = ctx.resolve<QueryEngine>('queryEngine')
  const result = await queryEngine.query<SalesOrderLineRow>(E.sales.sales_order_line, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters: { order_id: { $eq: orderId } },
    fields: ['id', 'kind', 'product_variant_id', 'quantity', 'line_number'],
    sort: [{ field: 'line_number', dir: 'asc' as never }],
    page: { page: 1, pageSize: 1000 },
  })
  return result.items
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

function buildRequiredQuantityByVariant(lines: SalesOrderLineRow[]): Map<string, number> {
  const quantities = new Map<string, number>()
  for (const line of lines) {
    if (line.kind !== 'product' || !line.product_variant_id) continue
    const quantity = toNumber(line.quantity)
    if (quantity <= 0) continue
    quantities.set(
      line.product_variant_id,
      (quantities.get(line.product_variant_id) ?? 0) + quantity,
    )
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
  const order = await loadOrderViaQueryEngine(ctx, payload.orderId, scope)
  if (!order || typeof order.id !== 'string') return

  const orderId = order.id
  const orderNumber = typeof order.order_number === 'string' ? order.order_number : null

  const [lines, activeReservations] = await Promise.all([
    loadOrderLinesViaQueryEngine(ctx, orderId, scope),
    loadActiveReservations(em, orderId, scope),
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
          sourceId: orderId,
          metadata: {
            automation: 'sales.order.confirmed',
            orderId,
            orderNumber,
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
