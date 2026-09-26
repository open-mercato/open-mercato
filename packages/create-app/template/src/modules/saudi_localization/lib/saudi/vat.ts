/**
 * Saudi VAT primitives shared by the localization settings and the ZATCA
 * payload builders.
 *
 * The Kingdom applies a 15% standard rate (raised from 5% on 1 July 2020) and
 * amounts are settled in halalas, so every decimal that reaches an invoice or a
 * QR code is normalized to exactly two decimals with a dot separator — never a
 * locale-formatted string, because a comma-decimal "1,15" would be read by
 * ZATCA as two values.
 *
 * A VAT registration number issued by ZATCA is 15 digits that start and end with
 * 3. The check is strict on purpose: a wrong number would be caught by ZATCA
 * anyway, but failing at invoice generation is cheaper than discovering it during
 * a clearance rejection.
 */

export const SAUDI_STANDARD_VAT_RATE = 0.15

export const SAUDI_VAT_NUMBER_LENGTH = 15

export const SAUDI_VAT_NUMBER_PATTERN = /^3\d{13}3$/

/** Decimal amount without separators or exponent, e.g. `115`, `115.5`, `0.05`. */
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/

export function isValidSaudiVatNumber(value: string): boolean {
  return SAUDI_VAT_NUMBER_PATTERN.test(value)
}

/** Well beyond any invoice total, and inside the range JavaScript parses exactly. */
const MAX_SAUD_AMOUNT = 1e12

/**
 * Rounds to halalas (two decimals) on the decimal value the caller wrote rather
 * than on its binary approximation: `1.005` is stored as `1.00499999…`, so plain
 * `Math.round(value * 100)` yields `1.00` where an invoice must show `1.01`.
 * Re-reading the number as `"1.005e2"` makes the shift exact, because the
 * shortest decimal representation is the amount the caller meant.
 */
export function roundToHalalas(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new Error('[internal] The amount must be a finite number.')
  }
  if (Math.abs(amount) > MAX_SAUD_AMOUNT) {
    throw new Error('[internal] The amount exceeds the supported halala range.')
  }
  return Number(`${Math.round(Number(`${amount}e2`))}e-2`)
}

/**
 * A ZATCA-ready decimal string: two decimals, dot separator, no grouping.
 * Throws `[internal]` errors rather than returning a fallback — a malformed
 * amount must stop an invoice, never be silently rounded into one.
 */
export function formatSaudDecimal(value: number | string): string {
  const parsed = parseAmount(value)
  return roundToHalalas(parsed).toFixed(2)
}

function parseAmount(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('[internal] The amount must be a finite, non-negative number.')
    }
    return value
  }

  const trimmed = value.trim()
  if (!PLAIN_DECIMAL.test(trimmed)) {
    throw new Error('[internal] The amount must be a plain decimal string, for example "115.00".')
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new Error('[internal] The amount must be a finite, non-negative number.')
  }
  return parsed
}

export type SaudiVatBreakdown = {
  net: number
  vat: number
  gross: number
  rate: number
}

/**
 * VAT for a net amount, with the standard rate by default. Both derived amounts
 * are rounded to halalas, and `gross` is derived from the rounded `vat` so the
 * three numbers on an invoice always add up.
 */
export function computeVatFromNet(net: number, rate: number = SAUDI_STANDARD_VAT_RATE): SaudiVatBreakdown {
  const parsedNet = parseAmount(net)
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error('[internal] The VAT rate must be a finite, non-negative number.')
  }

  const roundedNet = roundToHalalas(parsedNet)
  const vat = roundToHalalas(roundedNet * rate)
  return { net: roundedNet, vat, gross: roundToHalalas(roundedNet + vat), rate }
}
