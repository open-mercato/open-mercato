/**
 * Task 5.1 — pure MRP engine types (spec § MRP engine).
 *
 * `runMrp` (engine.ts) only ever sees these plain-data shapes — no ORM
 * entities, no Date objects (all dates are `YYYY-MM-DD` ISO strings so
 * lexicographic string comparison is a valid ordering, and so date math
 * stays trivial/pure). Bulk loading these shapes from the database is
 * `loaders.ts`'s job.
 */

/**
 * A `ProductKey` is a composite `${productId}::${variantId ?? ''}` string
 * (see `makeProductKey`/`parseProductKey`). Every map in `MrpInputs` and
 * every `productKey` the engine emits/consumes is keyed this way so a
 * variant never silently collides with its parent product or a sibling
 * variant (`StockItem`/`ProductPlanningParams`/`ProductionBom`/
 * `ProductionOrder` are all `(product_id, variant_id)`-scoped uniques —
 * see spec § Data Models). Callers that never deal with variants (most unit
 * tests) can keep using a bare product id string directly: `parseProductKey`
 * treats any key with no `::` marker as `{ productId: key, variantId: null }`,
 * so the two conventions are fully interoperable.
 */
export type ProductKey = string

export function makeProductKey(productId: string, variantId?: string | null): ProductKey {
  return `${productId}::${variantId ?? ''}`
}

export function parseProductKey(key: ProductKey): { productId: string; variantId: string | null } {
  const separatorIndex = key.indexOf('::')
  if (separatorIndex === -1) return { productId: key, variantId: null }
  const productId = key.slice(0, separatorIndex)
  const variantPart = key.slice(separatorIndex + 2)
  return { productId, variantId: variantPart === '' ? null : variantPart }
}

export type DemandSourceType = 'sales_order' | 'min_stock' | 'safety_stock'

export interface DemandSource {
  type: DemandSourceType
  id?: string | null
}

export interface MrpDemand {
  productKey: ProductKey
  qty: number
  uom: string
  /** ISO `YYYY-MM-DD`. */
  dueDate: string
  source: DemandSource
}

export interface MrpBomItem {
  componentKey: ProductKey
  qtyPerUnit: number
  uom: string
  scrapFactor?: number
  isPhantom?: boolean
}

export interface MrpBomVersion {
  productKey: ProductKey
  /** ISO `YYYY-MM-DD`, or `null` for an unbounded side of the window. */
  validFrom: string | null
  validTo: string | null
  items: MrpBomItem[]
}

export type ProcurementType = 'make' | 'buy'

export interface MrpPlanningParams {
  procurement: ProcurementType
  leadTimeDays: number
  minLot: number
  lotMultiple: number
  safetyStock: number
}

export interface MrpStock {
  onHand: number
  reserved: number
  uom: string
}

export type OpenSupplyStatus = 'released' | 'in_progress'

export interface MrpOpenSupply {
  productKey: ProductKey
  qty: number
  uom: string
  dueDate: string
  sourceId: string
  status: OpenSupplyStatus
}

export interface MrpUnitConversion {
  /** Multiply a quantity expressed in `fromUom` by this factor to get the product's stock-uom quantity. */
  factor: number
  fromUom: string
}

export interface MrpInputs {
  /** ISO `YYYY-MM-DD`; anchor date for min-stock/safety-stock demand and any date-relative fallback. */
  asOfDate: string
  demands: MrpDemand[]
  bomVersionsByProductKey: Record<ProductKey, MrpBomVersion[] | undefined>
  planningParamsByProductKey: Record<ProductKey, MrpPlanningParams | undefined>
  stockByProductKey: Record<ProductKey, MrpStock | undefined>
  openSupply: MrpOpenSupply[]
  unitConversionsByProductKey: Record<ProductKey, MrpUnitConversion | undefined>
}

export type MrpSuggestionType = 'make' | 'buy' | 'reschedule' | 'cancel'

export interface MrpPeggingRef {
  productKey: ProductKey
  source: DemandSource
  qty: number
}

export interface MrpSuggestion {
  type: MrpSuggestionType
  productKey: ProductKey
  /** Parsed back out of `productKey` (spec § Data Models: `MrpSuggestion.product_id/variant_id`). */
  productId: string
  variantId: string | null
  qty: number
  uom: string
  dueDate: string
  pegging: MrpPeggingRef[]
  /** Only set for `reschedule`/`cancel`: the open-supply order this suggestion touches. */
  openSupplySourceId?: string
  /** Only set for `reschedule`: the open-supply order's original due date. */
  previousDueDate?: string
}

export type MrpWarningCode = 'missing_unit_conversion' | 'missing_planning_params' | 'missing_bom_version'

export interface MrpWarning {
  code: MrpWarningCode
  productKey: ProductKey
  message: string
}

export interface MrpStats {
  demandsProcessed: number
  levelsExploded: number
  elapsedMsPlaceholder: number
}

export interface MrpResult {
  suggestions: MrpSuggestion[]
  warnings: MrpWarning[]
  stats: MrpStats
}
