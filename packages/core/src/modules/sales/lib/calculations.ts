import type { EventBus } from '@open-mercato/events'
import {
  type SalesAdjustmentDraft,
  type SalesCalculationContext,
  type SalesDocumentCalculationResult,
  type SalesDocumentKind,
  type SalesLineCalculationHook,
  type SalesLineCalculationResult,
  type SalesLineSnapshot,
  type SalesTotalsCalculationHook,
} from './types'

type CalculateLineOptions = {
  documentKind: SalesDocumentKind
  line: SalesLineSnapshot
  context: SalesCalculationContext
  eventBus?: EventBus | null
}

type CalculateDocumentOptions = {
  documentKind: SalesDocumentKind
  lines: SalesLineSnapshot[]
  adjustments?: SalesAdjustmentDraft[]
  context: SalesCalculationContext
  eventBus?: EventBus | null
}

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

function buildBaseLineResult(line: SalesLineSnapshot): SalesLineCalculationResult {
  const quantity = Math.max(toNumber(line.quantity, 0), 0)
  const taxRate = toNumber(line.taxRate, 0) / 100
  const unitNet =
    line.unitPriceNet ??
    (line.unitPriceGross !== null && line.unitPriceGross !== undefined
      ? toNumber(line.unitPriceGross) / (1 + taxRate)
      : 0)
  const unitGross =
    line.unitPriceGross ??
    (line.unitPriceNet !== null && line.unitPriceNet !== undefined
      ? toNumber(line.unitPriceNet) * (1 + taxRate)
      : 0)
  const discountPerUnit =
    line.discountAmount ??
    (line.discountPercent !== null && line.discountPercent !== undefined
      ? toNumber(line.discountPercent, 0) / 100 * toNumber(unitNet, 0)
      : 0)

  const netSubtotalBeforeDiscount = toNumber(unitNet, 0) * quantity
  const discountTotal = Math.min(Math.max(discountPerUnit * quantity, 0), netSubtotalBeforeDiscount)
  const netSubtotal = Math.max(netSubtotalBeforeDiscount - discountTotal, 0)
  const taxAmount =
    line.taxAmount !== null && line.taxAmount !== undefined
      ? toNumber(line.taxAmount, 0)
      : round(netSubtotal * Math.max(taxRate, 0))
  const grossSubtotal =
    line.totalGrossAmount !== null && line.totalGrossAmount !== undefined
      ? toNumber(line.totalGrossAmount, 0)
      : round(netSubtotal + taxAmount)

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
}): SalesDocumentCalculationResult {
  const { documentKind, lines, adjustments, currencyCode } = params
  let subtotalNet = 0
  let subtotalGross = 0
  let discountTotal = 0
  let taxTotal = 0
  let shippingNet = 0
  let shippingGross = 0
  let surchargeTotal = 0

  for (const line of lines) {
    subtotalNet += toNumber(line.netAmount, 0)
    subtotalGross += toNumber(line.grossAmount, 0)
    discountTotal += toNumber(line.discountAmount, 0)
    taxTotal += toNumber(line.taxAmount, 0)
  }

  const scopedAdjustments = (adjustments ?? []).filter(
    (adj) => !adj.scope || adj.scope === 'order'
  )

  for (const adj of scopedAdjustments) {
    const net = toNumber(adj.amountNet, toNumber(adj.amountGross))
    const gross = toNumber(adj.amountGross, net)
    switch (adj.kind) {
      case 'discount':
        discountTotal += Math.abs(net)
        subtotalNet = Math.max(subtotalNet - net, 0)
        subtotalGross = Math.max(subtotalGross - gross, 0)
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
        break
      case 'surcharge':
        surchargeTotal += net || gross
        subtotalNet += net || gross
        subtotalGross += gross || net
        break
      default:
        break
    }
  }

  const grandTotalNet = round(subtotalNet)
  const grandTotalGross = round(subtotalGross)

  return {
    kind: documentKind,
    currencyCode,
    lines,
    adjustments,
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
      paidTotalAmount: 0,
      refundedTotalAmount: 0,
      outstandingAmount: grandTotalGross,
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
    const { documentKind, lines, adjustments = [], context, eventBus } = opts
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
