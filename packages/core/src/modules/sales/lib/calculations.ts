import {
  type SalesAdjustmentDraft,
  type SalesCalculationContext,
  type CalculateDocumentOptions,
  type CalculateLineOptions,
  type SalesDocumentCalculationResult,
  type SalesDocumentKind,
  type SalesLineCalculationHook,
  type SalesLineCalculationResult,
  type SalesLineSnapshot,
  type SalesTotalsCalculationHook,
} from './types'

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return fallback
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4
}

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

function resolveAdjustmentAmounts(
  adjustments: SalesAdjustmentDraft[],
  baseNet: number,
  baseGross: number
): SalesAdjustmentDraft[] {
  return adjustments.map((adj) => {
    const rate = toNumber(adj.rate, NaN)
    const taxRate = extractAdjustmentTaxRate(adj)
    const hasAmountNet = Number.isFinite(toNumber(adj.amountNet, NaN))
    const hasAmountGross = Number.isFinite(toNumber(adj.amountGross, NaN))
    const hasRate = Number.isFinite(rate) && !hasAmountNet && !hasAmountGross
    const hasTaxRate = taxRate !== null
    let amountNet = toNumber(adj.amountNet, NaN)
    let amountGross = toNumber(adj.amountGross, NaN)

    if (hasRate) {
      const multiplier = (rate as number) / 100
      amountNet = round(Math.max(baseNet, 0) * multiplier)
      if (adj.kind === 'tax') {
        amountGross = amountNet
      } else if (hasTaxRate) {
        amountGross = round(amountNet * (1 + (taxRate as number) / 100))
      } else {
        amountGross = round(Math.max(baseGross, 0) * multiplier)
      }
    } else {
      if (!Number.isFinite(amountNet) && Number.isFinite(amountGross) && hasTaxRate) {
        amountNet = round((amountGross as number) / (1 + (taxRate as number) / 100))
      }
      if (!Number.isFinite(amountGross) && Number.isFinite(amountNet) && hasTaxRate) {
        amountGross = round((amountNet as number) * (1 + (taxRate as number) / 100))
      }
    }

    return {
      ...adj,
      amountNet: Number.isFinite(amountNet) ? amountNet : adj.amountNet,
      amountGross: Number.isFinite(amountGross) ? amountGross : adj.amountGross,
    }
  })
}

function buildBaseLineResult(line: SalesLineSnapshot): SalesLineCalculationResult {
  const quantity = Math.max(toNumber(line.quantity, 0), 0)
  const taxRate = toNumber(line.taxRate, 0) / 100
  const unitNet =
    line.unitPriceNet ??
    (line.unitPriceGross !== null && line.unitPriceGross !== undefined
      ? toNumber(line.unitPriceGross) / (1 + taxRate)
      : 0)
  const discountPerUnit =
    line.discountAmount ??
    (line.discountPercent !== null && line.discountPercent !== undefined
      ? toNumber(line.discountPercent, 0) / 100 * toNumber(unitNet, 0)
      : 0)

  const netSubtotalBeforeDiscount = toNumber(unitNet, 0) * quantity
  const discountTotal = Math.min(Math.max(discountPerUnit * quantity, 0), netSubtotalBeforeDiscount)
  const netSubtotal = Math.max(netSubtotalBeforeDiscount - discountTotal, 0)
  const explicitTaxAmount = line.taxAmount !== null && line.taxAmount !== undefined
  let taxAmount = explicitTaxAmount
    ? toNumber(line.taxAmount, 0)
    : round(netSubtotal * Math.max(taxRate, 0))
  const grossSubtotal =
    line.totalGrossAmount !== null && line.totalGrossAmount !== undefined
      ? toNumber(line.totalGrossAmount, 0)
      : round(netSubtotal + taxAmount)
  // When tax was not supplied explicitly and the rate-derived tax is zero but
  // the gross total already embeds tax (gross > net) — e.g. a tax-class-priced
  // line whose resolved rate was not persisted — derive the tax from the
  // net/gross delta so the document-level tax total is not silently zeroed
  // while per-line net/gross stay correct (#2457).
  if (!explicitTaxAmount && taxAmount <= 0) {
    const grossNetDelta = round(grossSubtotal - netSubtotal)
    if (grossNetDelta > 0) taxAmount = grossNetDelta
  }

  return {
    line,
    netAmount: round(netSubtotal),
    grossAmount: round(grossSubtotal),
    taxAmount: round(taxAmount),
    discountAmount: round(discountTotal),
    adjustments: [],
  }
}

function buildBaseDocumentResult(params: {
  documentKind: SalesDocumentKind
  lines: SalesLineCalculationResult[]
  adjustments: SalesAdjustmentDraft[]
  currencyCode: string
  existingTotals?: { paidTotalAmount?: number | null; refundedTotalAmount?: number | null }
}): SalesDocumentCalculationResult {
  const { documentKind, lines, adjustments, currencyCode } = params
  const orderedAdjustments = [...(adjustments ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  )
  let baseSubtotalNet = 0
  let baseSubtotalGross = 0
  let subtotalNet = 0
  let subtotalGross = 0
  let discountTotal = 0
  let taxTotal = 0
  let shippingNet = 0
  let shippingGross = 0
  let surchargeTotal = 0

  for (const line of lines) {
    const net = toNumber(line.netAmount, 0)
    const gross = toNumber(line.grossAmount, 0)
    subtotalNet += net
    subtotalGross += gross
    baseSubtotalNet += net
    baseSubtotalGross += gross
    discountTotal += toNumber(line.discountAmount, 0)
    taxTotal += toNumber(line.taxAmount, 0)
  }

  const resolvedAdjustments = resolveAdjustmentAmounts(orderedAdjustments, baseSubtotalNet, baseSubtotalGross)
  const scopedAdjustments = resolvedAdjustments.filter(
    (adj) => !adj.scope || adj.scope === 'order'
  )

  for (const adj of scopedAdjustments) {
    const rawNet = toNumber(adj.amountNet, toNumber(adj.amountGross))
    const rawGross = toNumber(adj.amountGross, rawNet)
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
    const net = isNonNegativeKind ? Math.abs(rawNet) : rawNet
    const gross = isNonNegativeKind ? Math.abs(rawGross) : rawGross
    const taxRate = extractAdjustmentTaxRate(adj)
    const taxPortion = taxRate !== null ? round(gross - net) : 0
    switch (adj.kind) {
      case 'discount':
        discountTotal += net
        subtotalNet = Math.max(subtotalNet - net, 0)
        subtotalGross = Math.max(subtotalGross - gross, 0)
        if (taxPortion) {
          taxTotal = round(taxTotal - taxPortion)
        }
        break
      case 'tax':
        taxTotal += gross || net
        subtotalGross += gross || net
        break
      case 'shipping':
        shippingNet += net
        shippingGross += gross
        subtotalNet += net
        subtotalGross += gross
        if (taxPortion) {
          taxTotal += taxPortion
        }
        break
      case 'surcharge':
        surchargeTotal += net || gross
        subtotalNet += net || gross
        subtotalGross += gross || net
        if (taxPortion) {
          taxTotal += taxPortion
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
        subtotalNet += net
        subtotalGross += gross
        if (taxPortion) {
          taxTotal += taxPortion
        }
        break
    }
  }

  // Line-scoped and any other return (credit) adjustments reduce grand total.
  // Sign is normalized to negative regardless of the stored sign so a positive
  // amountNet / amountGross can never inflate totals (issue #1705).
  for (const adj of resolvedAdjustments) {
    if (adj.kind !== 'return') continue
    const net = toNumber(adj.amountNet, toNumber(adj.amountGross))
    const gross = toNumber(adj.amountGross, net)
    const netDelta = -Math.abs(net)
    const grossDelta = -Math.abs(gross)
    subtotalNet = Math.max(subtotalNet + netDelta, 0)
    subtotalGross = Math.max(subtotalGross + grossDelta, 0)
  }

  const grandTotalNet = round(subtotalNet)
  const grandTotalGross = round(subtotalGross)
  const paidTotalAmount = Math.max(toNumber(params.existingTotals?.paidTotalAmount, 0), 0)
  const refundedTotalAmount = Math.max(toNumber(params.existingTotals?.refundedTotalAmount, 0), 0)
  const outstandingAmount = Math.max(grandTotalGross - paidTotalAmount + refundedTotalAmount, 0)

  return {
    kind: documentKind,
    currencyCode,
    lines,
    adjustments: resolvedAdjustments,
    metadata: {},
    totals: {
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
    },
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
    let current = buildBaseLineResult(line)

    if (eventBus) {
      await eventBus.emitEvent('sales.line.calculate.before', {
        documentKind,
        line,
        context,
        result: current,
        setResult(next: SalesLineCalculationResult) {
          current = next
        },
      })
    }

    for (const hook of this.lineCalculators) {
      const next = await hook({ documentKind, line, context, current })
      if (next) current = next
    }

    if (eventBus) {
      await eventBus.emitEvent('sales.line.calculate.after', {
        documentKind,
        line,
        context,
        result: current,
        setResult(next: SalesLineCalculationResult) {
          current = next
        },
      })
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
    })

    if (eventBus) {
      await eventBus.emitEvent('sales.document.calculate.before', {
        documentKind,
        lines: resolvedLines,
        context,
        adjustments,
        result: current,
        setResult(next: SalesDocumentCalculationResult) {
          current = next
        },
      })
    }

    for (const hook of this.totalsCalculators) {
      const next = await hook({
        documentKind,
        lines: resolvedLines,
        existingAdjustments: adjustments,
        context,
        current,
        eventBus,
      })
      if (next) current = next
    }

    if (eventBus) {
      await eventBus.emitEvent('sales.document.calculate.after', {
        documentKind,
        lines: resolvedLines,
        context,
        adjustments,
        result: current,
        setResult(next: SalesDocumentCalculationResult) {
          current = next
        },
      })
    }

    // Payment totals (paid/refunded) are authoritative inputs, not derived from
    // lines or adjustments. Totals calculators rebuild the document result from
    // lines+adjustments and would otherwise reset paid/refunded to 0 (and
    // outstanding back to the full grand total), producing a stale paid/
    // outstanding display after a payment. Re-apply the input totals last and
    // recompute outstanding against the post-calculation grand total.
    if (existingTotals) {
      const paidTotalAmount = Math.max(toNumber(existingTotals.paidTotalAmount, 0), 0)
      const refundedTotalAmount = Math.max(toNumber(existingTotals.refundedTotalAmount, 0), 0)
      current.totals = {
        ...current.totals,
        paidTotalAmount,
        refundedTotalAmount,
        outstandingAmount: round(
          Math.max(current.totals.grandTotalGrossAmount - paidTotalAmount + refundedTotalAmount, 0)
        ),
      }
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
}): SalesDocumentCalculationResult {
  const result = buildBaseDocumentResult({
    documentKind: params.documentKind,
    lines: params.lines,
    adjustments: params.adjustments,
    currencyCode: params.currencyCode,
  })
  result.metadata = params.metadata ?? {}
  return result
}
