import { computeVatFromNet, roundToHalalas } from '../../saudi_localization/lib/saudi/vat'

/**
 * Money helpers for freight documents. Every amount is stored as a
 * `numeric(18,4)` string and every derived value goes through the Saudi
 * primitives (`roundToHalalas` / `computeVatFromNet`), so the halala arithmetic
 * on freight documents is identical to the ZATCA invoice path. Totals are summed
 * in integer halalas to keep sums exact.
 */

export type VatEnvelope = { net: number; tax: number; gross: number }

export function toAmountNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function percentToFraction(value: string | number | null | undefined): number {
  return toAmountNumber(value) / 100
}

export function toHalalas(value: number): number {
  return Math.round(roundToHalalas(value) * 100)
}

export function halalasToAmountString(halalas: number): string {
  return (halalas / 100).toFixed(2)
}

export function amountToString(value: number): string {
  return roundToHalalas(value).toFixed(2)
}

export function computeLineEnvelope(
  netAmount: string | number,
  vatRatePercent: string | number | null | undefined,
): VatEnvelope {
  const breakdown = computeVatFromNet(toAmountNumber(netAmount), percentToFraction(vatRatePercent))
  return { net: breakdown.net, tax: breakdown.vat, gross: breakdown.gross }
}

export function sumEnvelopes(envelopes: VatEnvelope[]): VatEnvelope {
  let net = 0
  let tax = 0
  let gross = 0
  for (const envelope of envelopes) {
    net += toHalalas(envelope.net)
    tax += toHalalas(envelope.tax)
    gross += toHalalas(envelope.gross)
  }
  return { net: net / 100, tax: tax / 100, gross: gross / 100 }
}

export function computeQuantityAmount(quantity: string | number, unitPriceNet: string | number): number {
  return roundToHalalas(toAmountNumber(quantity) * toAmountNumber(unitPriceNet))
}

export { roundToHalalas }
