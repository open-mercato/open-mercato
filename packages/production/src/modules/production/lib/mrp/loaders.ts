import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductUnitConversion } from '@open-mercato/core/modules/catalog/data/entities'
import { ProductionBom, ProductionBomItem, ProductPlanningParams, StockItem, ProductionOrder } from '../../data/entities.js'
import { makeProductKey, parseProductKey, type MrpDemand, type MrpInputs, type MrpOpenSupply, type MrpBomVersion, type MrpBomItem } from './types.js'

/**
 * Task 5.1 — bulk loader for `runMrp` (spec § MRP engine, point 1: "bulk load
 * per tenant/org in a HANDFUL of scoped queries — no per-entity ORM walks").
 *
 * Every query below is explicitly `tenantId` + `organizationId` scoped. There
 * is no per-product/per-BOM loop issuing its own query (no N+1) — that
 * invariant is asserted by `loaders.test.ts` via a query-count bound.
 *
 * Every map is keyed by the composite `ProductKey` (`makeProductKey`) so a
 * variant row never overwrites its parent product's or a sibling variant's
 * row (`StockItem`/`ProductPlanningParams`/`ProductionBom`/`ProductionOrder`
 * are all `(product_id, variant_id)`-scoped uniques — spec § Data Models).
 * `CatalogProductUnitConversion` is the one exception: it has no variant
 * dimension at all, so it stays keyed by the bare `productId`.
 *
 * Sales demand is a soft dependency, read exactly like
 * `subscribers/sales-order-created-mto.ts`: resolve the `SalesOrderLine` DI
 * key defensively and degrade to min/safety-stock-only demand when the sales
 * module is absent (or the resolver itself is not provided). The sales order
 * line shape read here is intentionally minimal (mirrors the MTO subscriber)
 * — a later phase (5.2) can enrich due-date resolution once the worker
 * wiring exists; this loader never throws on a missing/unexpected shape.
 */

export type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export interface LoadMrpInputsParams {
  tenantId: string
  organizationId: string
  asOfDate: string
  /** Optional soft-dependency resolver (absent -> sales demand degrades to none). */
  resolve?: ResolverContext['resolve']
}

function tryResolve<T>(resolve: ResolverContext['resolve'] | undefined, name: string): T | undefined {
  if (!resolve) return undefined
  try {
    return resolve<T>(name)
  } catch {
    return undefined
  }
}

function canonicalUom(value: string): string {
  return value.trim().toLowerCase()
}

type SalesOrderLineRecord = {
  id?: string
  orderId?: string | null
  order?: string | null
  productId?: string | null
  productVariantId?: string | null
  quantity?: string | number | null
  quantityUnit?: string | null
  dueDate?: string | null
}

async function loadSalesDemand(
  em: EntityManager,
  params: LoadMrpInputsParams,
): Promise<MrpDemand[]> {
  const SalesOrderLine = tryResolve<new (...args: unknown[]) => unknown>(params.resolve, 'SalesOrderLine')
  if (!SalesOrderLine) return []

  // `orderBy: { id: 'asc' }` (review finding, hardening): without an
  // explicit ORDER BY, Postgres does not guarantee row order between two
  // otherwise-identical SELECTs. `carryOver.ts`'s match key already sorts
  // pegging refs so it is order-independent regardless, but a stable query
  // order here means `MrpDemand[]`/pegging order does not flip between runs
  // over unchanged data in the first place (belt-and-braces, not just relying
  // on the downstream sort).
  const lines = (await em.find(
    SalesOrderLine as never,
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      deletedAt: null,
    } as never,
    { orderBy: { id: 'asc' } as never },
  )) as SalesOrderLineRecord[]

  const demands: MrpDemand[] = []
  for (const line of lines) {
    if (typeof line.productId !== 'string') continue
    demands.push({
      productKey: makeProductKey(line.productId, line.productVariantId ?? null),
      qty: Number(line.quantity) || 0,
      uom: line.quantityUnit || 'pcs',
      dueDate: line.dueDate ?? params.asOfDate,
      source: { type: 'sales_order', id: line.orderId ?? line.order ?? line.id ?? null },
    })
  }
  return demands
}

/**
 * Loader-computed min-stock deficit demand (spec § MRP engine, point 1:
 * "min-stock/safety-stock deficits"). Reuses `planningParams.safetyStock` as
 * the replenishment floor: when free stock (`onHand - reserved`) is below
 * it, a `min_stock` demand entry for the shortfall is synthesized due
 * `asOfDate`. This is intentionally the SAME field the engine also uses as a
 * netting floor for independently-sourced demand (`runMrp` case 6b) — there
 * is no separate "min stock threshold" column on `ProductPlanningParams`
 * yet, so both behaviors are derived from `safetyStock` for the MVP. When
 * this synthesized demand nets against the SAME floor inside `runMrp`, free
 * stock is already at/under the floor, so nothing is double-counted (see
 * `engine.ts` netting comments).
 */
function computeMinStockDeficits(
  planningParams: ProductPlanningParams[],
  stockByProductKey: Record<string, { onHand: number; reserved: number; uom: string } | undefined>,
  asOfDate: string,
): MrpDemand[] {
  const demands: MrpDemand[] = []
  for (const row of planningParams) {
    const safetyStock = Number(row.safetyStock) || 0
    if (safetyStock <= 0) continue
    const productKey = makeProductKey(row.productId, row.variantId ?? null)
    const stockRow = stockByProductKey[productKey]
    const free = (stockRow?.onHand ?? 0) - (stockRow?.reserved ?? 0)
    if (free >= safetyStock) continue
    demands.push({
      productKey,
      qty: safetyStock - free,
      uom: stockRow?.uom ?? '',
      dueDate: asOfDate,
      source: { type: 'min_stock', id: null },
    })
  }
  return demands
}

export async function loadMrpInputs(em: EntityManager, params: LoadMrpInputsParams): Promise<MrpInputs> {
  const scope = { tenantId: params.tenantId, organizationId: params.organizationId, deletedAt: null }

  // `orderBy: { id: 'asc' }` on `ProductPlanningParams` (review finding,
  // hardening): its row order drives `computeMinStockDeficits`'s synthesized
  // `min_stock` demand order below, which in turn feeds pegging order — an
  // unordered SELECT could otherwise flip that order between two runs over
  // unchanged data (see `loadSalesDemand`'s matching comment above).
  const [planningParams, stockItems, activeBoms, openOrders] = await Promise.all([
    em.find(ProductPlanningParams, scope, { orderBy: { id: 'asc' } }),
    em.find(StockItem, scope),
    em.find(ProductionBom, { ...scope, status: 'active' }),
    // `planned` orders are intentionally excluded from open supply: a
    // `planned` order has no technology snapshot yet and reserves nothing
    // (spec § Status machine, decision g — the BOM+routing version pair and
    // material reservations are only fixed at `released`). Counting a
    // `planned` order as firm supply here would double-count it once it is
    // released and the MRP run re-nets against its now-real reservations.
    em.find(ProductionOrder, { ...scope, status: { $in: ['released', 'in_progress'] } }),
  ])

  const bomItems = activeBoms.length
    ? await em.find(ProductionBomItem, { ...scope, bomId: { $in: activeBoms.map((b) => b.id) } })
    : []

  const stockByProductKey: MrpInputs['stockByProductKey'] = {}
  for (const item of stockItems) {
    stockByProductKey[makeProductKey(item.productId, item.variantId ?? null)] = {
      onHand: Number(item.onHand) || 0,
      reserved: Number(item.reserved) || 0,
      uom: item.uom,
    }
  }

  const involvedProductIds = new Set<string>()
  for (const row of planningParams) involvedProductIds.add(row.productId)
  for (const row of stockItems) involvedProductIds.add(row.productId)
  for (const row of activeBoms) involvedProductIds.add(row.productId)
  for (const row of bomItems) involvedProductIds.add(row.componentProductId)
  for (const row of openOrders) involvedProductIds.add(row.productId)

  const unitConversionRows = involvedProductIds.size
    ? await em.find(CatalogProductUnitConversion, {
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        product: { $in: [...involvedProductIds] },
        isActive: true,
        deletedAt: null,
      } as never)
    : []

  // `CatalogProductUnitConversion` has no `variantId` column at all -- unlike
  // every other map here, this one stays keyed by the bare `productId`
  // (`engine.ts` looks it up via `parseProductKey(componentKey).productId`).
  const unitConversionsByProductKey: MrpInputs['unitConversionsByProductKey'] = {}
  for (const row of unitConversionRows) {
    const rawProduct = (row as unknown as { product: string | { id: string } }).product
    const productId = typeof rawProduct === 'string' ? rawProduct : rawProduct?.id
    if (!productId) continue
    // First active conversion wins per product (documented MVP simplification:
    // one canonical inbound uom per product, matching `costRollup.ts`).
    if (unitConversionsByProductKey[productId]) continue
    unitConversionsByProductKey[productId] = {
      factor: Number(row.toBaseFactor),
      fromUom: canonicalUom(row.unitCode),
    }
  }

  const bomItemsByBomId = new Map<string, MrpBomItem[]>()
  for (const item of bomItems) {
    const list = bomItemsByBomId.get(item.bomId) ?? []
    list.push({
      componentKey: makeProductKey(item.componentProductId, item.componentVariantId ?? null),
      qtyPerUnit: Number(item.qtyPerUnit),
      uom: item.uom,
      scrapFactor: Number(item.scrapFactor) || 0,
      isPhantom: !!item.isPhantom,
    })
    bomItemsByBomId.set(item.bomId, list)
  }

  const bomVersionsByProductKey: MrpInputs['bomVersionsByProductKey'] = {}
  for (const bomRow of activeBoms) {
    const productKey = makeProductKey(bomRow.productId, bomRow.variantId ?? null)
    const list = bomVersionsByProductKey[productKey] ?? []
    const version: MrpBomVersion = {
      productKey,
      validFrom: bomRow.validFrom ? bomRow.validFrom.toISOString().slice(0, 10) : null,
      validTo: bomRow.validTo ? bomRow.validTo.toISOString().slice(0, 10) : null,
      items: bomItemsByBomId.get(bomRow.id) ?? [],
    }
    list.push(version)
    bomVersionsByProductKey[productKey] = list
  }

  const planningParamsByProductKey: MrpInputs['planningParamsByProductKey'] = {}
  for (const row of planningParams) {
    planningParamsByProductKey[makeProductKey(row.productId, row.variantId ?? null)] = {
      procurement: row.procurement,
      leadTimeDays: row.leadTimeDays,
      minLot: Number(row.minLot) || 0,
      lotMultiple: Number(row.lotMultiple) || 0,
      safetyStock: Number(row.safetyStock) || 0,
    }
  }

  const openSupply: MrpOpenSupply[] = []
  for (const order of openOrders) {
    const remaining = (Number(order.qtyPlanned) || 0) - (Number(order.qtyCompleted) || 0)
    if (remaining <= 0) continue
    openSupply.push({
      productKey: makeProductKey(order.productId, order.variantId ?? null),
      qty: remaining,
      uom: order.uom,
      dueDate: order.dueDate ? order.dueDate.toISOString().slice(0, 10) : params.asOfDate,
      sourceId: order.id,
      status: order.status as 'released' | 'in_progress',
    })
  }

  const salesDemand = await loadSalesDemand(em, params)
  const minStockDemand = computeMinStockDeficits(planningParams, stockByProductKey, params.asOfDate)

  return {
    asOfDate: params.asOfDate,
    demands: [...salesDemand, ...minStockDemand],
    bomVersionsByProductKey,
    planningParamsByProductKey,
    stockByProductKey,
    openSupply,
    unitConversionsByProductKey,
  }
}

// Re-exported for callers (e.g. worker/route code in 5.2) that need to parse
// a suggestion's `productKey` back into `{ productId, variantId }` without a
// separate import from `./types.js`.
export { makeProductKey, parseProductKey }
