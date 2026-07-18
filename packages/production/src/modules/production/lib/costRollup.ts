/**
 * Pure, data-first standard-cost rollup for a BOM version (spec § API
 * Contracts, task 1.4). Callers pre-explode the BOM with
 * `lib/bomGraph.ts#explodeBom` (scrap factors are already baked into the
 * resulting `qty` there — this module does NOT re-apply scrap) and pass in
 * already-resolved catalog unit prices / UoM conversion factors / routing
 * operation timings, so this file stays free of ORM/catalog access and is
 * fully unit-testable.
 *
 * Honesty rule (spec: quantities-first honesty): a missing price or a
 * missing UoM conversion is collected into `missingPrices` /
 * `missingConversions` rather than thrown — the caller (route/UI) surfaces
 * the gap instead of silently treating it as zero cost or aborting the whole
 * rollup.
 *
 * MVP scope decisions (documented here since there is no separate ADR yet):
 * - Labor ignores work-center parallel-station efficiency; it is
 *   `(setupTimeMinutes + runTimePerUnitSeconds * quantity / 60) / 60 * costRatePerHour`
 *   per operation, summed across operations.
 * - Currency is assumed single-per-tenant. The first resolved price sets
 *   `result.currency`; any later price row with a *different* currency is
 *   collected into `mixedCurrency` (and excluded from `materials`) instead of
 *   being silently summed across currencies.
 */

export interface CostRollupLine {
  componentKey: string
  /** Quantity required for the whole order (already scaled + scrap-adjusted by explodeBom). */
  qty: number
  /** Unit of measure this quantity is expressed in (from the BOM item). */
  bomUom: string
}

export interface UnitPriceInfo {
  amount: number
  currency: string
  /** Unit of measure the price is denominated in (e.g. the product's default/base unit). */
  uom: string
}

export interface UnitConversionInfo {
  /** Multiply a quantity expressed in `bomUom` by this factor to get the quantity in `priceUom`. */
  factor: number
}

export interface RoutingOperationInput {
  workCenterId: string
  setupTimeMinutes: number
  runTimePerUnitSeconds: number
}

export interface CostRollupInput {
  lines: CostRollupLine[]
  unitPrices: Record<string, UnitPriceInfo>
  unitConversions: Record<string, UnitConversionInfo>
  operations: RoutingOperationInput[]
  workCenterRates: Record<string, number>
  /** Order quantity: scales run time and divides the total for `perUnit`. */
  quantity: number
}

export type CostRollupLineStatus = 'ok' | 'missing_price' | 'missing_conversion' | 'mixed_currency'

export interface CostRollupLineResult {
  componentKey: string
  qty: number
  bomUom: string
  priceUom: string | null
  unitAmount: number | null
  currency: string | null
  lineCost: number | null
  status: CostRollupLineStatus
}

export interface CostRollupResult {
  materials: number
  labor: number
  total: number
  perUnit: number
  currency: string | null
  missingPrices: string[]
  missingConversions: string[]
  mixedCurrency: string[]
  lines: CostRollupLineResult[]
}

function canonicalUom(value: string): string {
  return value.trim().toLowerCase()
}

export function computeStandardCost(input: CostRollupInput): CostRollupResult {
  let materials = 0
  let currency: string | null = null
  const missingPrices: string[] = []
  const missingConversions: string[] = []
  const mixedCurrency: string[] = []
  const lines: CostRollupLineResult[] = []

  for (const line of input.lines) {
    const price = input.unitPrices[line.componentKey]
    if (!price) {
      missingPrices.push(line.componentKey)
      lines.push({
        componentKey: line.componentKey,
        qty: line.qty,
        bomUom: line.bomUom,
        priceUom: null,
        unitAmount: null,
        currency: null,
        lineCost: null,
        status: 'missing_price',
      })
      continue
    }

    let qtyInPriceUom = line.qty
    if (canonicalUom(line.bomUom) !== canonicalUom(price.uom)) {
      const conversion = input.unitConversions[line.componentKey]
      if (!conversion) {
        missingConversions.push(line.componentKey)
        lines.push({
          componentKey: line.componentKey,
          qty: line.qty,
          bomUom: line.bomUom,
          priceUom: price.uom,
          unitAmount: price.amount,
          currency: price.currency,
          lineCost: null,
          status: 'missing_conversion',
        })
        continue
      }
      qtyInPriceUom = line.qty * conversion.factor
    }

    if (currency === null) {
      currency = price.currency
    } else if (currency !== price.currency) {
      mixedCurrency.push(line.componentKey)
      lines.push({
        componentKey: line.componentKey,
        qty: line.qty,
        bomUom: line.bomUom,
        priceUom: price.uom,
        unitAmount: price.amount,
        currency: price.currency,
        lineCost: null,
        status: 'mixed_currency',
      })
      continue
    }

    const lineCost = qtyInPriceUom * price.amount
    materials += lineCost
    lines.push({
      componentKey: line.componentKey,
      qty: line.qty,
      bomUom: line.bomUom,
      priceUom: price.uom,
      unitAmount: price.amount,
      currency: price.currency,
      lineCost,
      status: 'ok',
    })
  }

  let labor = 0
  for (const op of input.operations) {
    const rate = input.workCenterRates[op.workCenterId]
    if (rate === undefined) continue
    const laborMinutes = op.setupTimeMinutes + (op.runTimePerUnitSeconds * input.quantity) / 60
    const laborHours = laborMinutes / 60
    labor += laborHours * rate
  }

  const total = materials + labor
  const perUnit = input.quantity > 0 ? total / input.quantity : 0

  return { materials, labor, total, perUnit, currency, missingPrices, missingConversions, mixedCurrency, lines }
}
