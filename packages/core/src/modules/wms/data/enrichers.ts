import type { EntityManager } from '@mikro-orm/postgresql'
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import { InventoryBalance, InventoryReservation, ProductInventoryProfile, SalesOrderWarehouseAssignment, Warehouse } from './entities'
import { formatCatalogVariantLabel } from '../lib/inventoryDisplayUi'
import { resolvePrimaryWarehouseId } from '../lib/primaryWarehousePolicy'

type SalesOrderRecord = Record<string, unknown> & { id?: string }
type CatalogProductRecord = Record<string, unknown> & { id?: string }
type CatalogVariantRecord = Record<string, unknown> & { id?: string; product_id?: string; productId?: string }

type SalesOrderLineRow = {
  id?: string
  order_id?: string | null
  product_variant_id?: string | null
  quantity?: string | number | null
  line_number?: number | null
  status?: string | null
}

type CatalogVariantRow = {
  id?: string
  product_id?: string | null
  name?: string | null
  sku?: string | null
}

type ReservationSummaryItem = {
  id: string
  reservationLabel: string
  catalogVariantId: string
  warehouseId: string | null
  warehouseName: string | null
  quantity: string
  variantName: string | null
  variantSku: string | null
}

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

type InboundSummary = {
  openAsnCount: number
  nextExpectedAt: string | null
}

type SalesOrderWmsEnrichment = {
  _wms: {
    assignedWarehouseId: string | null
    assignedWarehouseName: string | null
    isExplicitlyAssigned: boolean
    stockSummary: Array<{
      catalogVariantId: string
      available: string
      reserved: string
    }>
    reservationSummary: {
      status: ReservationStatus
      reservationIds: string[]
      reservations: ReservationSummaryItem[]
    }
    inboundSummary: InboundSummary
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

import { resolveWmsIntegrationToggleEnabled } from '../lib/wmsIntegrationToggles'
const EMPTY_INBOUND_SUMMARY: InboundSummary = {
  openAsnCount: 0,
  nextExpectedAt: null,
}

const EMPTY_ENRICHMENT: SalesOrderWmsEnrichment = {
  _wms: {
    assignedWarehouseId: null,
    assignedWarehouseName: null,
    isExplicitlyAssigned: false,
    stockSummary: [],
    reservationSummary: {
      status: 'unreserved',
      reservationIds: [],
      reservations: [],
    },
    inboundSummary: EMPTY_INBOUND_SUMMARY,
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

function extractOrderIdFromLine(line: SalesOrderLineRow): string | null {
  return typeof line.order_id === 'string' && line.order_id.length > 0 ? line.order_id : null
}

function extractProductIdFromVariant(variant: CatalogVariantRow): string | null {
  return typeof variant.product_id === 'string' && variant.product_id.length > 0
    ? variant.product_id
    : null
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

function buildReservationLabel(input: {
  id: string
  variantName: string | null
  variantSku: string | null
  warehouseName: string | null
  quantity: string
}): string {
  const variantLabel = formatCatalogVariantLabel({
    variant_name: input.variantName,
    variant_sku: input.variantSku,
  })
  const segments: string[] = []
  if (variantLabel && variantLabel !== '—') segments.push(variantLabel)
  const warehouseName = input.warehouseName?.trim()
  if (warehouseName) segments.push(warehouseName)
  const quantity = formatQuantity(Number(input.quantity))
  if (quantity !== '0') segments.push(quantity)
  return segments.length > 0 ? segments.join(' · ') : input.id
}

function toReservationSummaryItem(
  reservation: InventoryReservation,
  warehouseNamesById: Map<string, string>,
  variantLabelsById: Map<string, { name: string | null; sku: string | null }>,
): ReservationSummaryItem {
  const warehouseId = extractWarehouseId(reservation)
  const warehouseName = warehouseId ? (warehouseNamesById.get(warehouseId) ?? null) : null
  const variantMeta = variantLabelsById.get(reservation.catalogVariantId)
  const variantName = variantMeta?.name ?? null
  const variantSku = variantMeta?.sku ?? null
  const quantity = formatQuantity(Number(reservation.quantity))
  return {
    id: reservation.id,
    reservationLabel: buildReservationLabel({
      id: reservation.id,
      variantName,
      variantSku,
      warehouseName,
      quantity,
    }),
    catalogVariantId: reservation.catalogVariantId,
    warehouseId,
    warehouseName,
    quantity,
    variantName,
    variantSku,
  }
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
    const em = container.resolve('em') as EntityManager | undefined
    if (!featureTogglesService || !em) return true
    return resolveWmsIntegrationToggleEnabled(
      featureTogglesService,
      em,
      'wms_integration_sales_order_inventory',
      context.tenantId,
    )
  } catch {
    return true
  }
}

async function loadInboundSummary(em: EntityManager, scope: Scope): Promise<InboundSummary> {
  // Aggregate only — never load all open ASN rows (backlog can blow the enricher timeout).
  const rows = await em.getConnection().execute<
    Array<{ open_asn_count: string | number; next_expected_at: Date | string | null }>
  >(
    `select count(*)::int as open_asn_count,
            min(expected_at) as next_expected_at
     from wms_asns
     where organization_id = ?
       and tenant_id = ?
       and deleted_at is null
       and status in ('draft', 'in_transit')`,
    [scope.organizationId, scope.tenantId],
  )
  const row = rows[0]
  const openAsnCount = Number(row?.open_asn_count ?? 0)
  const nextExpected = row?.next_expected_at
  return {
    openAsnCount: Number.isFinite(openAsnCount) ? openAsnCount : 0,
    nextExpectedAt: nextExpected
      ? (nextExpected instanceof Date ? nextExpected : new Date(nextExpected)).toISOString()
      : null,
  }
}

async function loadExplicitAssignments(
  em: EntityManager,
  orderIds: string[],
  scope: Scope,
): Promise<SalesOrderWarehouseAssignment[]> {
  if (orderIds.length === 0) return []
  return findWithDecryption(
    em,
    SalesOrderWarehouseAssignment,
    {
      salesOrderId: { $in: orderIds },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

async function loadWarehousesByIds(
  em: EntityManager,
  warehouseIds: string[],
  scope: Scope,
): Promise<Warehouse[]> {
  if (warehouseIds.length === 0) return []
  return findWithDecryption(
    em,
    Warehouse,
    {
      id: { $in: warehouseIds },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

async function loadOrderLines(
  context: EnricherContext,
  orderIds: string[],
  scope: Scope,
): Promise<SalesOrderLineRow[]> {
  if (orderIds.length === 0) return []
  // Read sales order lines via QueryEngine instead of importing the sales ORM
  // entity. Keeps the WMS module decoupled from sales internals; queryEngine
  // resolves the base table via Mikro-ORM metadata.
  const container = context.container as { resolve: (name: string) => unknown }
  const queryEngine = container.resolve('queryEngine') as QueryEngine
  const result = await queryEngine.query<SalesOrderLineRow>(E.sales.sales_order_line, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters: { order_id: { $in: orderIds } },
    fields: ['id', 'order_id', 'product_variant_id', 'quantity', 'line_number', 'status'],
    sort: [{ field: 'line_number', dir: 'asc' as never }],
    page: { page: 1, pageSize: 5000 },
  })
  return result.items
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
  context: EnricherContext,
  productIds: string[],
  scope: Scope,
): Promise<CatalogVariantRow[]> {
  if (productIds.length === 0) return []
  const container = context.container as { resolve: (name: string) => unknown }
  const queryEngine = container.resolve('queryEngine') as QueryEngine
  const result = await queryEngine.query<CatalogVariantRow>(E.catalog.catalog_product_variant, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters: { product_id: { $in: productIds } },
    fields: ['id', 'product_id'],
    sort: [{ field: 'created_at', dir: 'asc' as never }],
    page: { page: 1, pageSize: 5000 },
  })
  return result.items
}

async function loadCatalogVariantLabelsByIds(
  context: EnricherContext,
  variantIds: string[],
  scope: Scope,
): Promise<Map<string, { name: string | null; sku: string | null }>> {
  if (variantIds.length === 0) return new Map()
  const container = context.container as { resolve: (name: string) => unknown }
  const queryEngine = container.resolve('queryEngine') as QueryEngine
  const result = await queryEngine.query<CatalogVariantRow>(E.catalog.catalog_product_variant, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters: { id: { $in: variantIds } },
    fields: ['id', 'name', 'sku'],
    page: { page: 1, pageSize: Math.max(variantIds.length, 1) },
  })
  const labels = new Map<string, { name: string | null; sku: string | null }>()
  for (const row of result.items) {
    if (typeof row.id !== 'string' || row.id.length === 0) continue
    labels.set(row.id, {
      name: typeof row.name === 'string' ? row.name : null,
      sku: typeof row.sku === 'string' ? row.sku : null,
    })
  }
  return labels
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

    const lines = await loadOrderLines(context, orderIds, scope)

    const variantIds = Array.from(
      new Set(
        lines
          .map((line) => line.product_variant_id)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    )

    // inboundSummary is best-effort (raw ASN SQL); isolate so a missing table /
    // migration lag cannot reject the whole Promise.all and drop stock/reservation.
    const [reservations, balances, primaryWarehouseId, explicitAssignments, inboundSummary] =
      await Promise.all([
        loadReservations(em, orderIds, scope),
        loadBalances(em, variantIds, scope),
        resolvePrimaryWarehouseId(em, scope),
        loadExplicitAssignments(em, orderIds, scope),
        loadInboundSummary(em, scope).catch(() => EMPTY_INBOUND_SUMMARY),
      ])

    const explicitWarehouseIdsByOrder = new Map<string, string>()
    for (const assignment of explicitAssignments) {
      const warehouseRel = assignment.warehouse as { id?: string } | undefined
      const warehouseId = warehouseRel?.id
      if (warehouseId) {
        explicitWarehouseIdsByOrder.set(assignment.salesOrderId, warehouseId)
      }
    }

    const reservationWarehouseIds = reservations
      .map(extractWarehouseId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    const allRelevantWarehouseIds = Array.from(
      new Set([
        ...Array.from(explicitWarehouseIdsByOrder.values()),
        ...reservationWarehouseIds,
        ...(primaryWarehouseId ? [primaryWarehouseId] : []),
      ]),
    )
    const warehouses = await loadWarehousesByIds(em, allRelevantWarehouseIds, scope)
    const warehouseNamesById = new Map(warehouses.map((w) => [w.id, w.name]))

    const activeReservationVariantIds = Array.from(
      new Set(
        reservations
          .filter((reservation) => reservation.status === 'active')
          .map((reservation) => reservation.catalogVariantId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    )
    const variantLabelsById = await loadCatalogVariantLabelsByIds(
      context,
      activeReservationVariantIds,
      scope,
    )

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
      const orderId = extractOrderIdFromLine(line)
      const variantId = line.product_variant_id ?? null
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

      const explicitWarehouseId = explicitWarehouseIdsByOrder.get(orderId) ?? null
      const isExplicitlyAssigned = explicitWarehouseId !== null

      let assignedWarehouseId: string | null
      if (isExplicitlyAssigned) {
        assignedWarehouseId = explicitWarehouseId
      } else if (warehouseIds.length === 1) {
        assignedWarehouseId = warehouseIds[0]
      } else if (warehouseIds.length === 0 && primaryWarehouseId) {
        assignedWarehouseId = primaryWarehouseId
      } else {
        assignedWarehouseId = null
      }

      const assignedWarehouseName = assignedWarehouseId
        ? (warehouseNamesById.get(assignedWarehouseId) ?? null)
        : null

      const reservationItems = reservationsForOrder.map((reservation) =>
        toReservationSummaryItem(reservation, warehouseNamesById, variantLabelsById),
      )

      return {
        ...record,
        _wms: {
          assignedWarehouseId,
          assignedWarehouseName,
          isExplicitlyAssigned,
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
            reservationIds: reservationItems.map((item) => item.id),
            reservations: reservationItems,
          },
          inboundSummary,
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

    const variants = await loadCatalogVariants(context, productIds, scope)
    const variantIds = variants
      .map((variant) => variant.id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
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
      const productId = extractProductIdFromVariant(variant)
      if (!productId || typeof variant.id !== 'string') continue
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
