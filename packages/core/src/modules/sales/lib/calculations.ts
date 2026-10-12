import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  DEFAULT_AMOUNT_DECIMAL_PLACES,
  FX_DECIMAL_PLACES,
  amountComparisonTolerance,
  decimalToNumber,
  decimalToString,
  divideDecimals,
  resolveExactDecimal,
  roundDecimal,
  toDecimal,
  type DecimalValue,
} from '@open-mercato/shared/lib/decimal'
import {
  SALES_DOCUMENT_AMOUNT_FIELDS,
  SALES_LINE_RESULT_AMOUNT_FIELDS,
  type SalesAdjustmentDraft,
  type SalesCalculationContext,
  type CalculateDocumentOptions,
  type CalculateLineOptions,
  type SalesDocumentAmounts,
  type SalesDocumentCalculationResult,
  type SalesDocumentKind,
  type SalesLineCalculationHook,
  type SalesLineCalculationResult,
  type SalesLineSnapshot,
  type SalesTotalsCalculationHook,
} from './types'

const logger = createLogger('sales')

const ZERO = toDecimal(0)
const ONE = toDecimal(1)
const HUNDRED = toDecimal(100)

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return fallback
}

function exactAmount(exact: unknown, legacy: unknown): DecimalValue | null {
  const resolved = resolveExactDecimal(exact, legacy)
  return resolved === null ? null : toDecimal(resolved)
}

function hasValue(...values: unknown[]): boolean {
  return values.some((value) => value !== null && value !== undefined)
}

function maxOf(left: DecimalValue, right: DecimalValue): DecimalValue {
  return left.gt(right) ? left : right
}

function minOf(left: DecimalValue, right: DecimalValue): DecimalValue {
  return left.lt(right) ? left : right
}

function percentToFraction(percent: number): DecimalValue {
  return divideDecimals(percent, HUNDRED, FX_DECIMAL_PLACES)
}

function createRounder(decimalPlaces: number) {
  return (value: DecimalValue): DecimalValue => roundDecimal(value, decimalPlaces)
}

function resolveDecimalPlaces(decimalPlaces?: number | null): number {
  return typeof decimalPlaces === 'number' && Number.isInteger(decimalPlaces) && decimalPlaces >= 0
    ? decimalPlaces
    : DEFAULT_AMOUNT_DECIMAL_PLACES
}

// The engine rounds to the 4 decimals the numeric columns carry, but callers
// work in money at 2, so an exact comparison would report half a cent of
// honest rounding as a mismatch. Half a minor unit is the widest divergence
// that cannot be a real discrepancy and the narrowest that silences that noise.
const netReconciliationTolerance = amountComparisonTolerance

function extractAdjustmentTaxRate(adjustment: SalesAdjustmentDraft): number | null {
  const metadata = (adjustment.metadata ?? {}) as Record<string, unknown>
  const candidate =
    metadata.taxRate ??
    (metadata as any)?.tax_rate ??
    (metadata as any)?.taxRateValue ??
    (metadata as any)?.tax_rate_value ??
    null
  const parsed = toNumber(candidate, NaN)
  return Number.isFinite(parsed) ? parsed : null
}

function withExactAmount<T extends object>(
  target: T,
  field: string,
  value: DecimalValue,
): T {
  return { ...target, [field]: decimalToNumber(value), [`${field}Exact`]: decimalToString(value) }
}

function resolveAdjustmentAmounts(
  adjustments: SalesAdjustmentDraft[],
  baseNet: DecimalValue,
  baseGross: DecimalValue,
  decimalPlaces: number,
): SalesAdjustmentDraft[] {
  const round = createRounder(decimalPlaces)
  return adjustments.map((adj) => {
    const rate = toNumber(adj.rate, NaN)
    const taxRate = extractAdjustmentTaxRate(adj)
    let amountNet = exactAmount(adj.amountNetExact, adj.amountNet)
    let amountGross = exactAmount(adj.amountGrossExact, adj.amountGross)
    const hasRate = Number.isFinite(rate) && amountNet === null && amountGross === null
    const hasTaxRate = taxRate !== null
    const taxMultiplier = hasTaxRate ? ONE.plus(percentToFraction(taxRate as number)) : ONE

    if (hasRate) {
      const multiplier = percentToFraction(rate)
      amountNet = round(maxOf(baseNet, ZERO).times(multiplier))
      if (adj.kind === 'tax') {
        amountGross = amountNet
      } else if (hasTaxRate) {
        amountGross = round(amountNet.times(taxMultiplier))
      } else {
        amountGross = round(maxOf(baseGross, ZERO).times(multiplier))
      }
    } else {
      if (amountNet === null && amountGross !== null && hasTaxRate) {
        amountNet = round(divideDecimals(amountGross, taxMultiplier, FX_DECIMAL_PLACES))
      }
      if (amountGross === null && amountNet !== null && hasTaxRate) {
        amountGross = round(amountNet.times(taxMultiplier))
      }
    }

    let resolved: SalesAdjustmentDraft = { ...adj }
    if (amountNet !== null) resolved = withExactAmount(resolved, 'amountNet', amountNet)
    if (amountGross !== null) resolved = withExactAmount(resolved, 'amountGross', amountGross)
    return resolved
  })
}

// `discount_amount` stores the discount for the WHOLE line, while
// `discount_percent` records the operator's intent. The percentage therefore
// wins whenever it is set: a stored amount is only ever its cached result, and
// because the column is NOT NULL DEFAULT '0' a stored 0 cannot be told apart
// from "no discount supplied" — so it counts as absent rather than as a
// suppressing value. That is what makes recalculation idempotent, and what lets
// a row whose amount the old engine dropped or re-inflated heal itself on the
// next pass. Spec: .ai/specs/2026-08-07-sales-line-discount-amount-contract.md.
function resolveLineDiscountTotal(
  line: SalesLineSnapshot,
  netSubtotalBeforeDiscount: DecimalValue,
  quantity: DecimalValue,
): DecimalValue {
  const percent = toNumber(line.discountPercent, 0)
  if (line.discountPercent !== null && line.discountPercent !== undefined && percent !== 0) {
    return percentToFraction(percent).times(netSubtotalBeforeDiscount)
  }

  const amount = exactAmount(line.discountAmountExact, line.discountAmount)
  if (amount === null || amount.eq(0)) return ZERO

  // A snapshot rebuilt from a persisted row already holds a line total, so it
  // is never multiplied out again. Anything else came from a caller and keeps
  // the per-unit meaning the API has always documented unless the caller says
  // otherwise.
  if (line.discountAmountFromStoredRow === true) return amount
  return line.discountAmountBasis === 'line' ? amount : amount.times(quantity)
}

function buildBaseLineResult(line: SalesLineSnapshot, decimalPlaces: number): SalesLineCalculationResult {
  const round = createRounder(decimalPlaces)
  const quantity = maxOf(toDecimal(toNumber(line.quantity, 0)), ZERO)
  const taxRate = percentToFraction(toNumber(line.taxRate, 0))
  const unitGross = exactAmount(line.unitPriceGrossExact, line.unitPriceGross)
  const unitNet =
    exactAmount(line.unitPriceNetExact, line.unitPriceNet) ??
    (unitGross !== null ? divideDecimals(unitGross, ONE.plus(taxRate), FX_DECIMAL_PLACES) : ZERO)
  const netSubtotalBeforeDiscount = unitNet.times(quantity)
  const discountTotal = minOf(
    maxOf(resolveLineDiscountTotal(line, netSubtotalBeforeDiscount, quantity), ZERO),
    netSubtotalBeforeDiscount,
  )
  const netSubtotal = maxOf(netSubtotalBeforeDiscount.minus(discountTotal), ZERO)
  // Unlike totalGrossAmount below, a supplied totalNetAmount is never honoured
  // verbatim — net always comes from unitPriceNet/discount so it stays
  // internally consistent with them. A caller-supplied value is still
  // reconciled against the computed one so a divergence (e.g. a mis-read
  // discount) surfaces instead of being silently discarded (#5644).
  //
  // Only a caller's value is reconciled: a snapshot rebuilt from a persisted
  // row (`totalsFromStoredRow`) carries the engine's own previous output, and
  // on a row the discount contract still has to heal that value is *supposed*
  // to differ from the recomputed net. Warning about it would drown the caller
  // signal this exists for in one line per line per recalculation.
  if (line.totalsFromStoredRow !== true && hasValue(line.totalNetAmount, line.totalNetAmountExact)) {
    const computedNetAmount = round(netSubtotal)
    const suppliedNetAmount = exactAmount(line.totalNetAmountExact, line.totalNetAmount)
    if (suppliedNetAmount === null) {
      // Falling back to the computed value here would compare equal and log
      // nothing — the same silent discard #5644 exists to end.
      logger.warn('Sales line totalNetAmount is not a finite number; the computed value is used', {
        lineId: line.id ?? null,
        productId: line.productId ?? null,
        suppliedTotalNetAmount: line.totalNetAmount,
        computedNetAmount: decimalToNumber(computedNetAmount),
      })
    } else if (round(suppliedNetAmount).minus(computedNetAmount).abs().gt(netReconciliationTolerance(decimalPlaces))) {
      logger.warn('Sales line totalNetAmount does not match the computed net amount; the computed value is used', {
        lineId: line.id ?? null,
        productId: line.productId ?? null,
        suppliedTotalNetAmount: decimalToNumber(round(suppliedNetAmount)),
        computedNetAmount: decimalToNumber(computedNetAmount),
      })
    }
  }
  const explicitTaxAmount = hasValue(line.taxAmount, line.taxAmountExact)
  let taxAmount = explicitTaxAmount
    ? (exactAmount(line.taxAmountExact, line.taxAmount) ?? ZERO)
    : round(netSubtotal.times(maxOf(taxRate, ZERO)))
  const grossSubtotal = hasValue(line.totalGrossAmount, line.totalGrossAmountExact)
    ? (exactAmount(line.totalGrossAmountExact, line.totalGrossAmount) ?? ZERO)
    : round(netSubtotal.plus(taxAmount))
  // When tax was not supplied explicitly and the rate-derived tax is zero but
  // the gross total already embeds tax (gross > net) — e.g. a tax-class-priced
  // line whose resolved rate was not persisted — derive the tax from the
  // net/gross delta so the document-level tax total is not silently zeroed
  // while per-line net/gross stay correct (#2457).
  if (!explicitTaxAmount && taxAmount.lte(0)) {
    const grossNetDelta = round(grossSubtotal.minus(netSubtotal))
    if (grossNetDelta.gt(0)) taxAmount = grossNetDelta
  }

  let result: SalesLineCalculationResult = {
    line,
    netAmount: 0,
    grossAmount: 0,
    taxAmount: 0,
    discountAmount: 0,
    amountDecimalPlaces: decimalPlaces,
    adjustments: [],
  }
  result = withExactAmount(result, 'netAmount', round(netSubtotal))
  result = withExactAmount(result, 'grossAmount', round(grossSubtotal))
  result = withExactAmount(result, 'taxAmount', round(taxAmount))
  result = withExactAmount(result, 'discountAmount', round(discountTotal))
  return result
}

function lineAmount(line: SalesLineCalculationResult, field: (typeof SALES_LINE_RESULT_AMOUNT_FIELDS)[number]): DecimalValue {
  return exactAmount(line[`${field}Exact`], line[field]) ?? ZERO
}

function adjustmentNet(adj: SalesAdjustmentDraft): DecimalValue {
  return exactAmount(adj.amountNetExact, adj.amountNet) ?? exactAmount(adj.amountGrossExact, adj.amountGross) ?? ZERO
}

function adjustmentGross(adj: SalesAdjustmentDraft, fallback: DecimalValue): DecimalValue {
  return exactAmount(adj.amountGrossExact, adj.amountGross) ?? fallback
}

function buildBaseDocumentResult(params: {
  documentKind: SalesDocumentKind
  lines: SalesLineCalculationResult[]
  adjustments: SalesAdjustmentDraft[]
  currencyCode: string
  existingTotals?: CalculateDocumentOptions['existingTotals']
  amountDecimalPlaces?: number
}): SalesDocumentCalculationResult {
  const { documentKind, lines, adjustments, currencyCode } = params
  const decimalPlaces = resolveDecimalPlaces(params.amountDecimalPlaces)
  const round = createRounder(decimalPlaces)
  const orderedAdjustments = [...(adjustments ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  )
  let baseSubtotalNet = ZERO
  let baseSubtotalGross = ZERO
  let subtotalNet = ZERO
  let subtotalGross = ZERO
  let discountTotal = ZERO
  let taxTotal = ZERO
  let shippingNet = ZERO
  let shippingGross = ZERO
  let surchargeTotal = ZERO

  for (const line of lines) {
    const net = lineAmount(line, 'netAmount')
    const gross = lineAmount(line, 'grossAmount')
    subtotalNet = subtotalNet.plus(net)
    subtotalGross = subtotalGross.plus(gross)
    baseSubtotalNet = baseSubtotalNet.plus(net)
    baseSubtotalGross = baseSubtotalGross.plus(gross)
    discountTotal = discountTotal.plus(lineAmount(line, 'discountAmount'))
    taxTotal = taxTotal.plus(lineAmount(line, 'taxAmount'))
  }

  const resolvedAdjustments = resolveAdjustmentAmounts(orderedAdjustments, baseSubtotalNet, baseSubtotalGross, decimalPlaces)
  const scopedAdjustments = resolvedAdjustments.filter(
    (adj) => !adj.scope || adj.scope === 'order'
  )

  for (const adj of scopedAdjustments) {
    const rawNet = adjustmentNet(adj)
    const rawGross = adjustmentGross(adj, rawNet)
    // Each adjustment kind has an intrinsic sign convention. The API edge
    // (enforceAdjustmentSign) rejects values that would invert the kind's
    // semantic effect, but the calculation engine normalizes defensively so
    // direct DB writes or seeded data can't inflate the grand total either.
    // See #1905 (mirrors the existing return normalization a few lines below
    // introduced for #1705).
    const isNonNegativeKind =
      adj.kind === 'discount' ||
      adj.kind === 'surcharge' ||
      adj.kind === 'shipping' ||
      adj.kind === 'tax'
    const net = isNonNegativeKind ? rawNet.abs() : rawNet
    const gross = isNonNegativeKind ? rawGross.abs() : rawGross
    const taxRate = extractAdjustmentTaxRate(adj)
    const taxPortion = taxRate !== null ? round(gross.minus(net)) : ZERO
    switch (adj.kind) {
      case 'discount':
        discountTotal = discountTotal.plus(net)
        subtotalNet = maxOf(subtotalNet.minus(net), ZERO)
        subtotalGross = maxOf(subtotalGross.minus(gross), ZERO)
        if (!taxPortion.eq(0)) {
          taxTotal = round(taxTotal.minus(taxPortion))
        }
        break
      case 'tax': {
        const taxValue = gross.eq(0) ? net : gross
        taxTotal = taxTotal.plus(taxValue)
        subtotalGross = subtotalGross.plus(taxValue)
        break
      }
      case 'shipping':
        shippingNet = shippingNet.plus(net)
        shippingGross = shippingGross.plus(gross)
        subtotalNet = subtotalNet.plus(net)
        subtotalGross = subtotalGross.plus(gross)
        if (!taxPortion.eq(0)) {
          taxTotal = taxTotal.plus(taxPortion)
        }
        break
      case 'surcharge':
        surchargeTotal = surchargeTotal.plus(net.eq(0) ? gross : net)
        subtotalNet = subtotalNet.plus(net.eq(0) ? gross : net)
        subtotalGross = subtotalGross.plus(gross.eq(0) ? net : gross)
        if (!taxPortion.eq(0)) {
          taxTotal = taxTotal.plus(taxPortion)
        }
        break
      default:
        // `return` (credit) adjustments are handled by the dedicated loop below;
        // skip them here so an order-scoped return is not counted twice.
        if (adj.kind === 'return') break
        // Custom / operator-defined kinds carry an operator-controlled sign
        // (positive adds, negative credits). Fold the raw signed amount into the
        // grand total so a persisted adjustment can never be silently dropped
        // from the headline total while still appearing in the itemized
        // breakdown (#4052). No abs()/clamp here: unlike the sign-constrained
        // kinds above, custom kinds are intentionally unconstrained
        // (see enforceAdjustmentSign).
        subtotalNet = subtotalNet.plus(net)
        subtotalGross = subtotalGross.plus(gross)
        if (!taxPortion.eq(0)) {
          taxTotal = taxTotal.plus(taxPortion)
        }
        break
    }
  }

  // Line-scoped and any other return (credit) adjustments reduce grand total.
  // Sign is normalized to negative regardless of the stored sign so a positive
  // amountNet / amountGross can never inflate totals (issue #1705).
  for (const adj of resolvedAdjustments) {
    if (adj.kind !== 'return') continue
    const net = adjustmentNet(adj)
    const gross = adjustmentGross(adj, net)
    subtotalNet = maxOf(subtotalNet.minus(net.abs()), ZERO)
    subtotalGross = maxOf(subtotalGross.minus(gross.abs()), ZERO)
  }

  const grandTotalNet = round(subtotalNet)
  const grandTotalGross = round(subtotalGross)
  const paidTotalAmount = maxOf(
    exactAmount(params.existingTotals?.paidTotalAmountExact, params.existingTotals?.paidTotalAmount) ?? ZERO,
    ZERO,
  )
  const refundedTotalAmount = maxOf(
    exactAmount(params.existingTotals?.refundedTotalAmountExact, params.existingTotals?.refundedTotalAmount) ?? ZERO,
    ZERO,
  )
  const outstandingAmount = maxOf(grandTotalGross.minus(paidTotalAmount).plus(refundedTotalAmount), ZERO)

  return {
    kind: documentKind,
    currencyCode,
    lines,
    adjustments: resolvedAdjustments,
    metadata: {},
    totals: buildDocumentAmounts({
      subtotalNetAmount: round(subtotalNet),
      subtotalGrossAmount: round(subtotalGross),
      discountTotalAmount: round(discountTotal),
      taxTotalAmount: round(taxTotal),
      shippingNetAmount: round(shippingNet),
      shippingGrossAmount: round(shippingGross),
      surchargeTotalAmount: round(surchargeTotal),
      grandTotalNetAmount: grandTotalNet,
      grandTotalGrossAmount: grandTotalGross,
      paidTotalAmount,
      refundedTotalAmount,
      outstandingAmount,
    }),
  }
}

function buildDocumentAmounts(
  values: Record<(typeof SALES_DOCUMENT_AMOUNT_FIELDS)[number], DecimalValue>,
): SalesDocumentAmounts {
  let totals = {} as SalesDocumentAmounts
  for (const field of SALES_DOCUMENT_AMOUNT_FIELDS) {
    totals = withExactAmount(totals, field, values[field])
  }
  return totals
}

type AmountPair = { exact: unknown; value: unknown }
type AmountPairs = Record<string, AmountPair>
type AmountPairsById = Record<string, AmountPairs>

type ItemAmountPairs = {
  byId: AmountPairsById
  byIndex: AmountPairs[]
  byIdentity: WeakMap<object, AmountPairs>
  hasIds: boolean
}

type DocumentAmountPairs = {
  totals: AmountPairs
  lines: ItemAmountPairs
  adjustments: ItemAmountPairs
}

const ADJUSTMENT_AMOUNT_FIELDS = ['amountNet', 'amountGross'] as const

function captureAmountPairs(record: object, fields: readonly string[]): AmountPairs {
  const values = record as Record<string, unknown>
  const pairs: AmountPairs = {}
  for (const field of fields) pairs[field] = { exact: values[`${field}Exact`], value: values[field] }
  return pairs
}

function itemId(id: unknown): string | null {
  return typeof id === 'string' && id.length > 0 ? id : null
}

function captureItemAmountPairs<T extends object>(
  items: readonly T[],
  resolveId: (item: T) => unknown,
  resolveIdentity: (item: T) => object,
  fields: readonly string[],
): ItemAmountPairs {
  const byId: AmountPairsById = {}
  const byIndex: AmountPairs[] = []
  const byIdentity = new WeakMap<object, AmountPairs>()
  let hasIds = false
  for (const item of items) {
    const pairs = captureAmountPairs(item, fields)
    byIndex.push(pairs)
    byIdentity.set(resolveIdentity(item), pairs)
    const id = itemId(resolveId(item))
    if (id === null) continue
    hasIds = true
    if (!Object.prototype.hasOwnProperty.call(byId, id)) byId[id] = pairs
  }
  return { byId, byIndex, byIdentity, hasIds }
}

function pairedAmounts(pairs: AmountPairsById, id: unknown): AmountPairs | undefined {
  const key = itemId(id)
  if (key === null || !Object.prototype.hasOwnProperty.call(pairs, key)) return undefined
  return pairs[key]
}

function pairItemAmounts<T>(
  before: ItemAmountPairs | undefined,
  items: readonly T[],
  resolveId: (item: T) => unknown,
  resolveIdentity: (item: T) => object,
): Array<AmountPairs | undefined> {
  if (!before) return items.map(() => undefined)
  const pairByIndex =
    !before.hasIds &&
    before.byIndex.length === items.length &&
    items.every((item) => itemId(resolveId(item)) === null)
  return items.map((item, index) =>
    pairedAmounts(before.byId, resolveId(item)) ??
      before.byIdentity.get(resolveIdentity(item)) ??
      (pairByIndex ? before.byIndex[index] : undefined),
  )
}

function lineResultId(line: SalesLineCalculationResult): unknown {
  return line.line?.id
}

function lineResultIdentity(line: SalesLineCalculationResult): object {
  return line.line
}

function adjustmentIdentity(adjustment: SalesAdjustmentDraft): object {
  return adjustment
}

function adjustmentId(adjustment: SalesAdjustmentDraft): unknown {
  return adjustment.id
}

function captureDocumentAmounts(result: SalesDocumentCalculationResult): DocumentAmountPairs {
  return {
    totals: captureAmountPairs(result.totals, SALES_DOCUMENT_AMOUNT_FIELDS),
    lines: captureItemAmountPairs(result.lines, lineResultId, lineResultIdentity, SALES_LINE_RESULT_AMOUNT_FIELDS),
    adjustments: captureItemAmountPairs(result.adjustments, adjustmentId, adjustmentIdentity, ADJUSTMENT_AMOUNT_FIELDS),
  }
}

/**
 * Picks the value a hook meant: when it changed the `<field>Exact` string, that
 * string wins; otherwise the float decides as in `resolveExactDecimal` (a hook
 * that only changed the float overrides a stale exact value). A value taken from
 * the float is rounded to `decimalPlaces`, as the fixed-scale columns did on write.
 */
function reconcileAmount(
  before: AmountPair | undefined,
  exact: unknown,
  value: unknown,
  decimalPlaces: number,
): DecimalValue | null {
  const nextExact = typeof exact === 'string' ? exactAmount(exact, undefined) : null
  if (nextExact !== null && before !== undefined) {
    const previousExact = typeof before.exact === 'string' ? exactAmount(before.exact, undefined) : null
    if (previousExact === null || !previousExact.eq(nextExact)) return nextExact
  }
  const resolved = exactAmount(exact, value)
  if (resolved === null) return null
  if (nextExact !== null && nextExact.eq(resolved)) return nextExact
  return roundDecimal(resolved, decimalPlaces)
}

function reconcileAmounts<T extends object>(
  record: T,
  fields: readonly string[],
  decimalPlaces: number,
  before?: AmountPairs,
): T {
  const values = record as Record<string, unknown>
  let synced = record
  for (const field of fields) {
    const value = reconcileAmount(before?.[field], values[`${field}Exact`], values[field], decimalPlaces)
    if (value !== null) synced = withExactAmount(synced, field, value)
  }
  return synced
}

/** Keeps every `<field>Exact` consistent with its float after a hook ran. */
function syncLineResultExactAmounts(
  result: SalesLineCalculationResult,
  decimalPlaces: number,
  before?: AmountPairs,
): SalesLineCalculationResult {
  return reconcileAmounts(result, SALES_LINE_RESULT_AMOUNT_FIELDS, decimalPlaces, before)
}

/**
 * Lines and adjustments are matched to their pre-hook amounts by `id`, so a hook
 * that reorders, filters or prepends items cannot pair one item with another's
 * stale exact value. Idless lines keep their source line identity across result
 * copies; adjustments are matched by object identity. When identities are also
 * replaced and no item carries an id, an unchanged count allows position matching.
 * Items without a match fall back to the float/exact consistency rule.
 */
function syncDocumentResultExactAmounts(
  result: SalesDocumentCalculationResult,
  decimalPlaces: number,
  before?: DocumentAmountPairs,
): SalesDocumentCalculationResult {
  const linePairs = pairItemAmounts(before?.lines, result.lines, lineResultId, lineResultIdentity)
  const adjustmentPairs = pairItemAmounts(before?.adjustments, result.adjustments, adjustmentId, adjustmentIdentity)
  return {
    ...result,
    lines: result.lines.map((line, index) => syncLineResultExactAmounts(line, decimalPlaces, linePairs[index])),
    adjustments: result.adjustments.map((adjustment, index) =>
      reconcileAmounts(adjustment, ADJUSTMENT_AMOUNT_FIELDS, decimalPlaces, adjustmentPairs[index]),
    ),
    totals: reconcileAmounts(result.totals, SALES_DOCUMENT_AMOUNT_FIELDS, decimalPlaces, before?.totals),
  }
}

class SalesCalculationRegistry {
  private lineCalculators: SalesLineCalculationHook[] = []
  private totalsCalculators: SalesTotalsCalculationHook[] = []

  registerLineCalculator(hook: SalesLineCalculationHook, opts?: { prepend?: boolean }): () => void {
    if (opts?.prepend) this.lineCalculators.unshift(hook)
    else this.lineCalculators.push(hook)
    return () => {
      this.lineCalculators = this.lineCalculators.filter((item) => item !== hook)
    }
  }

  registerTotalsCalculator(hook: SalesTotalsCalculationHook, opts?: { prepend?: boolean }): () => void {
    if (opts?.prepend) this.totalsCalculators.unshift(hook)
    else this.totalsCalculators.push(hook)
    return () => {
      this.totalsCalculators = this.totalsCalculators.filter((item) => item !== hook)
    }
  }

  async calculateLine(opts: CalculateLineOptions): Promise<SalesLineCalculationResult> {
    const { documentKind, line, context, eventBus } = opts
    const decimalPlaces = resolveDecimalPlaces(context.amountDecimalPlaces)
    let current = buildBaseLineResult(line, decimalPlaces)
    const applyHook = async (run: () => Promise<void>) => {
      const before = captureAmountPairs(current, SALES_LINE_RESULT_AMOUNT_FIELDS)
      await run()
      current = syncLineResultExactAmounts(current, decimalPlaces, before)
    }

    if (eventBus) {
      await applyHook(() =>
        eventBus.emitEvent('sales.line.calculate.before', {
          documentKind,
          line,
          context,
          result: current,
          setResult(next: SalesLineCalculationResult) {
            current = next
          },
        }),
      )
    }

    for (const hook of this.lineCalculators) {
      await applyHook(async () => {
        const next = await hook({ documentKind, line, context, current })
        if (next) current = next
      })
    }

    if (eventBus) {
      await applyHook(() =>
        eventBus.emitEvent('sales.line.calculate.after', {
          documentKind,
          line,
          context,
          result: current,
          setResult(next: SalesLineCalculationResult) {
            current = next
          },
        }),
      )
    }

    return current
  }

  async calculateDocument(opts: CalculateDocumentOptions): Promise<SalesDocumentCalculationResult> {
    const { documentKind, lines, adjustments = [], context, eventBus, existingTotals } = opts
    const resolvedLines: SalesLineCalculationResult[] = []

    for (const line of lines) {
      const result = await this.calculateLine({ documentKind, line, context, eventBus })
      resolvedLines.push(result)
    }

    let current = buildBaseDocumentResult({
      documentKind,
      lines: resolvedLines,
      adjustments,
      currencyCode: context.currencyCode,
      existingTotals,
      amountDecimalPlaces: context.amountDecimalPlaces,
    })

    const decimalPlaces = resolveDecimalPlaces(context.amountDecimalPlaces)
    const applyHook = async (run: () => Promise<void>) => {
      const before = captureDocumentAmounts(current)
      await run()
      current = syncDocumentResultExactAmounts(current, decimalPlaces, before)
    }

    if (eventBus) {
      await applyHook(() =>
        eventBus.emitEvent('sales.document.calculate.before', {
          documentKind,
          lines: resolvedLines,
          context,
          adjustments,
          result: current,
          setResult(next: SalesDocumentCalculationResult) {
            current = next
          },
        }),
      )
    }

    for (const hook of this.totalsCalculators) {
      await applyHook(async () => {
        const next = await hook({
          documentKind,
          lines: resolvedLines,
          existingAdjustments: adjustments,
          context,
          current,
          eventBus,
        })
        if (next) current = next
      })
    }

    if (eventBus) {
      await applyHook(() =>
        eventBus.emitEvent('sales.document.calculate.after', {
          documentKind,
          lines: resolvedLines,
          context,
          adjustments,
          result: current,
          setResult(next: SalesDocumentCalculationResult) {
            current = next
          },
        }),
      )
    }

    // Payment totals (paid/refunded) are authoritative inputs, not derived from
    // lines or adjustments. Totals calculators rebuild the document result from
    // lines+adjustments and would otherwise reset paid/refunded to 0 (and
    // outstanding back to the full grand total), producing a stale paid/
    // outstanding display after a payment. Re-apply the input totals last and
    // recompute outstanding against the post-calculation grand total.
    if (existingTotals) {
      const round = createRounder(decimalPlaces)
      const paidTotalAmount = maxOf(
        exactAmount(existingTotals.paidTotalAmountExact, existingTotals.paidTotalAmount) ?? ZERO,
        ZERO,
      )
      const refundedTotalAmount = maxOf(
        exactAmount(existingTotals.refundedTotalAmountExact, existingTotals.refundedTotalAmount) ?? ZERO,
        ZERO,
      )
      const grandTotalGross =
        exactAmount(current.totals.grandTotalGrossAmountExact, current.totals.grandTotalGrossAmount) ?? ZERO
      let totals = withExactAmount(current.totals, 'paidTotalAmount', paidTotalAmount)
      totals = withExactAmount(totals, 'refundedTotalAmount', refundedTotalAmount)
      totals = withExactAmount(
        totals,
        'outstandingAmount',
        round(maxOf(grandTotalGross.minus(paidTotalAmount).plus(refundedTotalAmount), ZERO)),
      )
      current.totals = totals
    }

    return current
  }
}

export function createSalesCalculationRegistry(): SalesCalculationRegistry {
  return new SalesCalculationRegistry()
}

export const salesCalculations = createSalesCalculationRegistry()

export async function calculateLine(
  opts: CalculateLineOptions
): Promise<SalesLineCalculationResult> {
  return salesCalculations.calculateLine(opts)
}

export async function calculateDocumentTotals(
  opts: CalculateDocumentOptions
): Promise<SalesDocumentCalculationResult> {
  return salesCalculations.calculateDocument(opts)
}

export function registerSalesLineCalculator(
  hook: SalesLineCalculationHook,
  opts?: { prepend?: boolean }
): () => void {
  return salesCalculations.registerLineCalculator(hook, opts)
}

export function registerSalesTotalsCalculator(
  hook: SalesTotalsCalculationHook,
  opts?: { prepend?: boolean }
): () => void {
  return salesCalculations.registerTotalsCalculator(hook, opts)
}

export function rebuildDocumentResult(params: {
  documentKind: SalesDocumentKind
  currencyCode: string
  lines: SalesLineCalculationResult[]
  adjustments: SalesAdjustmentDraft[]
  metadata?: Record<string, unknown>
  amountDecimalPlaces?: number
}): SalesDocumentCalculationResult {
  const result = buildBaseDocumentResult({
    documentKind: params.documentKind,
    lines: params.lines,
    adjustments: params.adjustments,
    currencyCode: params.currencyCode,
    amountDecimalPlaces: params.amountDecimalPlaces,
  })
  result.metadata = params.metadata ?? {}
  return result
}
