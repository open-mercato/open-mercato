import { amountToString, computeLineEnvelope, sumEnvelopes } from './money'

/**
 * Builds the sales-document lines for a freight billing event.
 *
 * Every line is emitted as `quantity: 1` with the halala-rounded net amount as
 * the unit price, and the human-readable breakdown ("12.5 ton × SAR 100.80") is
 * carried in the description. That makes the sales calculation service's
 * recomputation (`quantity × unitPriceNet` and tax from the rate percent)
 * degenerate to exactly the amounts freight computed with the Saudi primitives —
 * no rounding drift is possible between the freight ledger and the sales
 * document, whatever the underlying rate basis was.
 */

export type FreightDraftLineInput = {
  name: string
  description?: string | null
  netAmount: string | number
  taxRatePercent: string | number | null | undefined
  metadata?: Record<string, unknown> | null
}

export type FreightDraftLine = {
  name: string
  description?: string
  quantity: string
  unitPriceNet: string
  taxRate: string
  taxAmount: string
  totalNetAmount: string
  totalGrossAmount: string
  metadata?: Record<string, unknown>
}

export type FreightInvoiceDraft = {
  lines: FreightDraftLine[]
  subtotalNetAmount: string
  taxTotalAmount: string
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
}

export function buildInvoiceDraft(lines: FreightDraftLineInput[], fallbackTaxRatePercent: string | number): FreightInvoiceDraft {
  const built: FreightDraftLine[] = lines.map((line) => {
    const rate = line.taxRatePercent ?? fallbackTaxRatePercent
    const envelope = computeLineEnvelope(line.netAmount, rate)
    return {
      name: line.name,
      ...(line.description ? { description: line.description } : {}),
      quantity: '1',
      unitPriceNet: amountToString(envelope.net),
      taxRate: amountToString(Number(rate)),
      taxAmount: amountToString(envelope.tax),
      totalNetAmount: amountToString(envelope.net),
      totalGrossAmount: amountToString(envelope.gross),
      ...(line.metadata ? { metadata: line.metadata } : {}),
    }
  })

  const totals = sumEnvelopes(
    built.map((line) => ({
      net: Number(line.totalNetAmount),
      tax: Number(line.taxAmount),
      gross: Number(line.totalGrossAmount),
    })),
  )

  return {
    lines: built,
    subtotalNetAmount: amountToString(totals.net),
    taxTotalAmount: amountToString(totals.tax),
    grandTotalNetAmount: amountToString(totals.net),
    grandTotalGrossAmount: amountToString(totals.gross),
  }
}
