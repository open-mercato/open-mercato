import type { EntityManager } from '@mikro-orm/postgresql'
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import { E } from '#generated/entities.ids.generated'
import { CatalogProductVariant } from '../../catalog/data/entities'
import { SalesOrderLine } from '../../sales/data/entities'
import { InventoryBalance, InventoryReservation, ProductInventoryProfile } from './entities'

type SalesOrderRecord = Record<string, unknown> & { id?: string }
type CatalogProductRecord = Record<string, unknown> & { id?: string }
type CatalogVariantRecord = Record<string, unknown> & { id?: string; product_id?: string; productId?: string }
type ReservationStatus = 'unreserved' | 'partially_reserved' | 'fully_reserved'
type ReorderState = 'no_profile' | 'healthy' | 'below_reorder_point' | 'below_safety_stock'

type InventoryProfileSummary = {
  profileId: string
  catalogProductId: string
  catalogVariantId: string | null
  defaultUom: string
  defaultStrategy: string
  trackLot: boolean
  trackSerial: boolean
  trackExpiration: boolean
  reorderPoint: string
  safetyStock: string
}

type StockSummaryItem = {
  catalogVariantId: string
  onHand: string
  reserved: string
  allocated: string
  available: string
}

type ReorderStatus = {
  state: ReorderState
  available: string
  reorderPoint: string
  safetyStock: string
}

type SalesOrderWmsEnrichment = {
  _wms: {
    assignedWarehouseId: string | null
    stockSummary: Array<{
      catalogVariantId: string
      available: string
      reserved: string
    }>
    reservationSummary: {
      status: ReservationStatus
      reservationIds: string[]
    }
  }
}

type CatalogWmsEnrichment = {
  _wms: {
    inventoryProfile: InventoryProfileSummary | null
    stockSummary: StockSummaryItem[]
    reorderStatus: ReorderStatus
  }
}

type EnricherScope = EnricherContext & { em: EntityManager }
type Scope = { organizationId: string; tenantId: string }
type BalanceAggregate = { onHand: number; reserved: number; allocated: number; available: number }

const SALES_ORDER_INVENTORY_TOGGLE = 'wms_integration_sales_order_inventory'
const EMPTY_ENRICHMENT: SalesOrderWmsEnrichment = {
  _wms: {
    assignedWarehouseId: null,
    stockSummary: [],
    reservationSummary: {
      status: 'unreserved',
      reservationIds: [],
    },
  },
}

const EMPTY_CATALOG_ENRICHMENT: CatalogWmsEnrichment = {
  _wms: {
    inventoryProfile: null,
    stockSummary: [],
    reorderStatus: {
      state: 'no_profile',
      available: '0',
      reorderPoint: '0',
      safetyStock: '0',
    },
  },
}

function extractRecordId(record: SalesOrderRecord): string | null {
  return typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : null
}

function extractOrderId(line: SalesOrderLine): string | null {
  const relation = line.order as { id?: string } | undefined
  return typeof relation?.id === 'string' ? relation.id : null
}

function extractProductId(variant: CatalogProductVariant): string | null {
  const relation = variant.product as { id?: string } | undefined
  return typeof relation?.id === 'string' ? relation.id : null
}

function extractWarehouseId(reservation: InventoryReservation): string | null {
  const relation = reservation.warehouse as { id?: string } | undefined
  return typeof relation?.id === 'string' ? relation.id : null
}

function addToMap(map: Map<string, number>, key: string, value: string | number | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0)
  map.set(key, (map.get(key) ?? 0) + numeric)
}

function formatQuantity(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0'
  const normalized = value.toFixed(4).replace(/\.?0+$/, '')
  return normalized.length > 0 ? normalized : '0'
}

function toInventoryProfileSummary(profile: ProductInventoryProfile): InventoryProfileSummary {
  return {
    profileId: profile.id,
    catalogProductId: profile.catalogProductId,
    catalogVariantId: profile.catalogVariantId ?? null,
    defaultUom: profile.defaultUom,
    defaultStrategy: profile.defaultStrategy,
    trackLot: profile.trackLot,
    trackSerial: profile.trackSerial,
    trackExpiration: profile.trackExpiration,
    reorderPoint: profile.reorderPoint,
    safetyStock: profile.safetyStock,
  }
}

function resolveReservationStatus(requiredQuantity: number, reservedQuantity: number): ReservationStatus {
  if (requiredQuantity <= 0 || reservedQuantity <= 0) return 'unreserved'
  if (reservedQuantity + 0.0001 < requiredQuantity) return 'partially_reserved'
  return 'fully_reserved'
}

function resolveReorderStatus(
  availableQuantity: number,
  profile: ProductInventoryProfile | null | undefined,
): ReorderStatus {
  if (!profile) {
    return {
      state: 'no_profile',
      available: formatQuantity(availableQuantity),
      reorderPoint: '0',
      safetyStock: '0',
    }
  }

  const reorderPoint = Number(profile.reorderPoint)
  const safetyStock = Number(profile.safetyStock)
  let state: ReorderState = 'healthy'

  if (availableQuantity <= safetyStock) {
    state = 'below_safety_stock'
  } else if (availableQuantity <= reorderPoint) {
    state = 'below_reorder_point'
  }

  return {
    state,
    available: formatQuantity(availableQuantity),
    reorderPoint: profile.reorderPoint,
    safetyStock: profile.safetyStock,
  }
}

function buildBalanceSummaryByVariant(
  balances: InventoryBalance[],
): Map<string, BalanceAggregate> {
  const byVariant = new Map<string, BalanceAggregate>()

  for (const balance of balances) {
    const current = byVariant.get(balance.catalogVariantId) ?? {
      onHand: 0,
      reserved: 0,
      allocated: 0,
      available: 0,
    }

    current.onHand += Number(balance.quantityOnHand)
    current.reserved += Number(balance.quantityReserved)
    current.allocated += Number(balance.quantityAllocated)
    current.available +=
      Number(balance.quantityOnHand) - Number(balance.quantityReserved) - Number(balance.quantityAllocated)

    byVariant.set(balance.catalogVariantId, current)
  }

  return byVariant
}

function buildStockSummaryItem(
  catalogVariantId: string,
  aggregate: BalanceAggregate | undefined,
): StockSummaryItem {
  return {
    catalogVariantId,
    onHand: formatQuantity(aggregate?.onHand ?? 0),
    reserved: formatQuantity(aggregate?.reserved ?? 0),
    allocated: formatQuantity(aggregate?.allocated ?? 0),
    available: formatQuantity(aggregate?.available ?? 0),
  }
}

async function isSalesOrderInventoryEnabled(context: EnricherContext): Promise<boolean> {
  const container = context.container as { resolve?: (name: string) => unknown } | undefined
  if (!container?.resolve) return true
  try {
    const featureTogglesService = container.resolve('featureTogglesService') as FeatureTogglesService | undefined
    if (!featureTogglesService) return true
    const result = await featureTogglesService.getBoolConfig(SALES_ORDER_INVENTORY_TOGGLE, context.tenantId)
    return result.ok ? result.value : true
  } catch {
    return true
  }
}

async function loadOrderLines(
  em: EntityManager,
  orderIds: string[],
  scope: Scope,
): Promise<SalesOrderLine[]> {
  if (orderIds.length === 0) return []
  return findWithDecryption(
    em,
    SalesOrderLine,
    {
      order: { $in: orderIds },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    { orderBy: { lineNumber: 'asc' } },
    scope,
  )
}

async function loadReservations(
  em: EntityManager,
  orderIds: string[],
  scope: Scope,
): Promise<InventoryReservation[]> {
  if (orderIds.length === 0) return []
  return findWithDecryption(
    em,
    InventoryReservation,
    {
      sourceType: 'order',
      sourceId: { $in: orderIds },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
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
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

async function loadCatalogVariants(
  em: EntityManager,
  productIds: string[],
  scope: Scope,
): Promise<CatalogProductVariant[]> {
  if (productIds.length === 0) return []
  return findWithDecryption(
    em,
    CatalogProductVariant,
    {
      product: { $in: productIds },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
}

async function loadProductInventoryProfiles(
  em: EntityManager,
  productIds: string[],
  scope: Scope,
): Promise<ProductInventoryProfile[]> {
  if (productIds.length === 0) return []
  return findWithDecryption(
    em,
    ProductInventoryProfile,
    {
      catalogProductId: { $in: productIds },
      catalogVariantId: null,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

async function loadVariantInventoryProfiles(
  em: EntityManager,
  variantIds: string[],
  scope: Scope,
): Promise<ProductInventoryProfile[]> {
  if (variantIds.length === 0) return []
  return findWithDecryption(
    em,
    ProductInventoryProfile,
    {
      catalogVariantId: { $in: variantIds },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

const salesOrderInventoryEnricher: ResponseEnricher<SalesOrderRecord, SalesOrderWmsEnrichment> = {
  id: 'wms.sales-order-inventory',
  targetEntity: E.sales.sales_order,
  features: ['wms.view'],
  priority: 40,
  timeout: 2000,
  fallback: EMPTY_ENRICHMENT,

  async enrichOne(record, context: EnricherScope) {
    return (await this.enrichMany!([record], context))[0]
  },

  async enrichMany(records, context: EnricherScope) {
    if (records.length === 0) return records as Array<SalesOrderRecord & SalesOrderWmsEnrichment>
    const enabled = await isSalesOrderInventoryEnabled(context)
    if (!enabled) return records as Array<SalesOrderRecord & SalesOrderWmsEnrichment>

    const orderIds = records
      .map(extractRecordId)
      .filter((value): value is string => Boolean(value))

    if (orderIds.length === 0) {
      return records.map((record) => ({ ...record, ...EMPTY_ENRICHMENT }))
    }

    const em = context.em.fork()
    const scope = { organizationId: context.organizationId, tenantId: context.tenantId }

    const lines = await loadOrderLines(em, orderIds, scope)

    const variantIds = Array.from(
      new Set(
        lines
          .map((line) => line.productVariantId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    )

    const [reservations, balances] = await Promise.all([
      loadReservations(em, orderIds, scope),
      loadBalances(em, variantIds, scope),
    ])

    const variantAvailability = new Map<string, number>()
    const variantReserved = new Map<string, number>()
    for (const balance of balances) {
      addToMap(
        variantAvailability,
        balance.catalogVariantId,
        Number(balance.quantityOnHand) - Number(balance.quantityReserved) - Number(balance.quantityAllocated),
      )
      addToMap(variantReserved, balance.catalogVariantId, balance.quantityReserved)
    }

    const variantOrderBySalesOrder = new Map<string, string[]>()
    const requiredBySalesOrder = new Map<string, number>()

    for (const line of lines) {
      const orderId = extractOrderId(line)
      const variantId = line.productVariantId
      if (!orderId || !variantId) continue

      const variantOrder = variantOrderBySalesOrder.get(orderId) ?? []
      if (!variantOrder.includes(variantId)) {
        variantOrder.push(variantId)
        variantOrderBySalesOrder.set(orderId, variantOrder)
      }
      requiredBySalesOrder.set(orderId, (requiredBySalesOrder.get(orderId) ?? 0) + Number(line.quantity))
    }

    const activeReservationsBySalesOrder = new Map<string, InventoryReservation[]>()
    const reservedBySalesOrder = new Map<string, number>()

    for (const reservation of reservations) {
      if (reservation.status !== 'active') continue
      const orderId = reservation.sourceId
      const activeReservations = activeReservationsBySalesOrder.get(orderId) ?? []
      activeReservations.push(reservation)
      activeReservationsBySalesOrder.set(orderId, activeReservations)
      reservedBySalesOrder.set(orderId, (reservedBySalesOrder.get(orderId) ?? 0) + Number(reservation.quantity))
    }

    return records.map((record) => {
      const orderId = extractRecordId(record)
      if (!orderId) {
        return { ...record, ...EMPTY_ENRICHMENT }
      }

      const reservationsForOrder = activeReservationsBySalesOrder.get(orderId) ?? []
      const warehouseIds = Array.from(
        new Set(
          reservationsForOrder
            .map(extractWarehouseId)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        ),
      )
      const variantIdsForOrder = variantOrderBySalesOrder.get(orderId) ?? []

      return {
        ...record,
        _wms: {
          assignedWarehouseId: warehouseIds.length === 1 ? warehouseIds[0] : null,
          stockSummary: variantIdsForOrder.map((catalogVariantId) => ({
            catalogVariantId,
            available: formatQuantity(variantAvailability.get(catalogVariantId) ?? 0),
            reserved: formatQuantity(variantReserved.get(catalogVariantId) ?? 0),
          })),
          reservationSummary: {
            status: resolveReservationStatus(
              requiredBySalesOrder.get(orderId) ?? 0,
              reservedBySalesOrder.get(orderId) ?? 0,
            ),
            reservationIds: reservationsForOrder.map((reservation) => reservation.id),
          },
        },
      }
    })
  },
}

const catalogProductInventoryEnricher: ResponseEnricher<CatalogProductRecord, CatalogWmsEnrichment> = {
  id: 'wms.catalog-product-inventory',
  targetEntity: E.catalog.catalog_product,
  features: ['wms.view'],
  priority: 40,
  timeout: 2000,
  fallback: EMPTY_CATALOG_ENRICHMENT,

  async enrichOne(record, context: EnricherScope) {
    return (await this.enrichMany!([record], context))[0]
  },

  async enrichMany(records, context: EnricherScope) {
    if (records.length === 0) return records as Array<CatalogProductRecord & CatalogWmsEnrichment>

    const productIds = records
      .map(extractRecordId)
      .filter((value): value is string => Boolean(value))

    if (productIds.length === 0) {
      return records.map((record) => ({ ...record, ...EMPTY_CATALOG_ENRICHMENT }))
    }

    const em = context.em.fork()
    const scope = { organizationId: context.organizationId, tenantId: context.tenantId }

    const variants = await loadCatalogVariants(em, productIds, scope)
    const variantIds = variants.map((variant) => variant.id)
    const [productProfiles, balances] = await Promise.all([
      loadProductInventoryProfiles(em, productIds, scope),
      loadBalances(em, variantIds, scope),
    ])

    const profileByProductId = new Map(
      productProfiles.map((profile) => [profile.catalogProductId, profile] as const),
    )
    const balanceByVariantId = buildBalanceSummaryByVariant(balances)
    const variantIdsByProductId = new Map<string, string[]>()

    for (const variant of variants) {
      const productId = extractProductId(variant)
      if (!productId) continue
      const entries = variantIdsByProductId.get(productId) ?? []
      entries.push(variant.id)
      variantIdsByProductId.set(productId, entries)
    }

    return records.map((record) => {
      const productId = extractRecordId(record)
      if (!productId) {
        return { ...record, ...EMPTY_CATALOG_ENRICHMENT }
      }

      const profile = profileByProductId.get(productId) ?? null
      const stockSummary = (variantIdsByProductId.get(productId) ?? []).map((variantId) =>
        buildStockSummaryItem(variantId, balanceByVariantId.get(variantId)),
      )
      const totalAvailable = stockSummary.reduce(
        (sum, item) => sum + Number(item.available),
        0,
      )

      return {
        ...record,
        _wms: {
          inventoryProfile: profile ? toInventoryProfileSummary(profile) : null,
          stockSummary,
          reorderStatus: resolveReorderStatus(totalAvailable, profile),
        },
      }
    })
  },
}

const catalogVariantInventoryEnricher: ResponseEnricher<CatalogVariantRecord, CatalogWmsEnrichment> = {
  id: 'wms.catalog-variant-inventory',
  targetEntity: E.catalog.catalog_product_variant,
  features: ['wms.view'],
  priority: 40,
  timeout: 2000,
  fallback: EMPTY_CATALOG_ENRICHMENT,

  async enrichOne(record, context: EnricherScope) {
    return (await this.enrichMany!([record], context))[0]
  },

  async enrichMany(records, context: EnricherScope) {
    if (records.length === 0) return records as Array<CatalogVariantRecord & CatalogWmsEnrichment>

    const variantIds = records
      .map(extractRecordId)
      .filter((value): value is string => Boolean(value))

    if (variantIds.length === 0) {
      return records.map((record) => ({ ...record, ...EMPTY_CATALOG_ENRICHMENT }))
    }

    const em = context.em.fork()
    const scope = { organizationId: context.organizationId, tenantId: context.tenantId }

    const [profiles, balances] = await Promise.all([
      loadVariantInventoryProfiles(em, variantIds, scope),
      loadBalances(em, variantIds, scope),
    ])

    const profileByVariantId = new Map(
      profiles
        .filter((profile): profile is ProductInventoryProfile & { catalogVariantId: string } => typeof profile.catalogVariantId === 'string')
        .map((profile) => [profile.catalogVariantId, profile] as const),
    )
    const balanceByVariantId = buildBalanceSummaryByVariant(balances)

    return records.map((record) => {
      const variantId = extractRecordId(record)
      if (!variantId) {
        return { ...record, ...EMPTY_CATALOG_ENRICHMENT }
      }

      const profile = profileByVariantId.get(variantId) ?? null
      const stockSummary = [buildStockSummaryItem(variantId, balanceByVariantId.get(variantId))]

      return {
        ...record,
        _wms: {
          inventoryProfile: profile ? toInventoryProfileSummary(profile) : null,
          stockSummary,
          reorderStatus: resolveReorderStatus(Number(stockSummary[0]?.available ?? 0), profile),
        },
      }
    })
  },
}

export const enrichers: ResponseEnricher[] = [
  salesOrderInventoryEnricher,
  catalogProductInventoryEnricher,
  catalogVariantInventoryEnricher,
]
