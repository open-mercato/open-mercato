/**
 * Decimal-string money arithmetic for the *jurisdiction* layer.
 *
 * The ledger already has its own 4-decimal arithmetic (`glService.ts`) because
 * posting must be exact. A country plugin rounds to a different scale — halalas
 * are 2 decimals — and it must do so on the decimal the caller wrote, never on
 * its binary approximation: `Math.round(1.005 * 100)` is `100`, because `1.005`
 * is stored as `1.00499999…`, so a float round is one halala short of the amount
 * the operator meant. Everything here is therefore string/BigInt, and nothing in
 * this file ever constructs a `number` from an amount.
 */

const AMOUNT_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?$/

export class MoneyFormatError extends Error {
  constructor(value: unknown) {
    super(`[internal] Not a decimal amount: ${String(value)}`)
    this.name = 'MoneyFormatError'
  }
}

type ParsedAmount = { negative: boolean; whole: string; fraction: string }

function parseAmount(value: string | number): ParsedAmount {
  const text = typeof value === 'number' ? numberToDecimalString(value) : value.trim()
  const match = AMOUNT_PATTERN.exec(text)
  if (!match) throw new MoneyFormatError(value)
  const [, sign, whole = '', fraction = ''] = match
  if (whole === '' && fraction === '') throw new MoneyFormatError(value)
  return { negative: sign === '-', whole: whole === '' ? '0' : whole, fraction }
}

function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) throw new MoneyFormatError(value)
  const text = String(value)
  if (text.includes('e') || text.includes('E')) throw new MoneyFormatError(value)
  return text
}

/**
 * Round to `scale` decimals, half away from zero, and render with exactly
 * `scale` fraction digits. Deterministic and total: the same input always
 * produces the same string, which is what lets a document hash stay stable.
 */
export function roundDecimalHalfUp(value: string | number, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
    throw new MoneyFormatError(`scale ${String(scale)}`)
  }
  const { negative, whole, fraction } = parseAmount(value)
  const padded = `${fraction}${'0'.repeat(scale + 1)}`
  const kept = padded.slice(0, scale)
  const guardDigit = Number(padded.charAt(scale))
  let scaled = BigInt(`${whole}${kept}`)
  if (guardDigit >= 5) scaled += 1n
  const digits = scaled.toString().padStart(scale + 1, '0')
  const rendered = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
  const isZero = /^0+(\.0+)?$/.test(rendered)
  return negative && !isZero ? `-${rendered}` : rendered
}

/** Canonical machine form: dot separator, fixed fraction digits, never grouped. */
export function formatMachineDecimal(value: string | number, fractionDigits = 2): string {
  return roundDecimalHalfUp(value, fractionDigits)
}

/** Sum decimal strings exactly, at a working scale, then round once at the end. */
export function sumDecimalStrings(values: readonly (string | number)[], workingScale = 6): string {
  let total = 0n
  const factor = 10n ** BigInt(workingScale)
  for (const value of values) {
    const { negative, whole, fraction } = parseAmount(value)
    const padded = `${fraction}${'0'.repeat(workingScale)}`.slice(0, workingScale)
    const scaled = BigInt(`${whole}${padded}`)
    total += negative ? -scaled : scaled
  }
  const negative = total < 0n
  const magnitude = negative ? -total : total
  const digits = magnitude.toString().padStart(workingScale + 1, '0')
  const rendered = `${digits.slice(0, -workingScale)}.${digits.slice(-workingScale)}`
  return negative ? `-${rendered}` : rendered
}

/** Flip a decimal's sign, preserving its written scale. `-0.00` reads as `0.00`. */
export function negateDecimal(value: string | number): string {
  const text = typeof value === 'number' ? numberToDecimalString(value) : value.trim()
  if (isZeroDecimal(text)) return text.startsWith('-') ? text.slice(1) : text
  return text.startsWith('-') ? text.slice(1) : `-${text}`
}

export function subtractDecimalStrings(left: string | number, right: string | number, workingScale = 6): string {
  return sumDecimalStrings([left, negateDecimal(right)], workingScale)
}

export function isZeroDecimal(value: string | number): boolean {
  const { whole, fraction } = parseAmount(value)
  return /^0+$/.test(whole) && /^0*$/.test(fraction)
}
