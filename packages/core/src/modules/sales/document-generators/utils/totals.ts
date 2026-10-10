const AMOUNT_SCALE = 10_000

function roundAmount(value: number): number {
  return Math.round(value * AMOUNT_SCALE) / AMOUNT_SCALE
}

export type ReconciledDocumentTotals = {
  subtotal: number
  shipping: number
  surcharge: number
  adjustments: number
  tax: number
  total: number
}

export function reconcileDocumentTotals(input: {
  lineTotals: number[]
  subtotalNet: number
  grandTotalGross: number
  shipping?: number
  surcharge?: number
}): ReconciledDocumentTotals {
  const subtotal = roundAmount(input.lineTotals.reduce((sum, amount) => sum + amount, 0))
  const shipping = roundAmount(input.shipping ?? 0)
  const surcharge = roundAmount(input.surcharge ?? 0)
  const subtotalNet = roundAmount(input.subtotalNet)
  const total = roundAmount(input.grandTotalGross)
  return {
    subtotal,
    shipping,
    surcharge,
    adjustments: roundAmount(subtotalNet - subtotal - shipping - surcharge),
    tax: roundAmount(total - subtotalNet),
    total,
  }
}
