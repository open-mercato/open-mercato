export const AMOUNT_SCALE = 4
export const MAX_AMOUNT = 999_999_999

const SCALE_FACTOR = 10n ** BigInt(AMOUNT_SCALE)
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/
const UNSIGNED_DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/

type DecimalParts = { negative: boolean; whole: string; fraction: string }

export type AmountInputIssue = 'invalid' | 'too_precise' | 'out_of_range'

export type AmountInputResult = { ok: true; amount: string } | { ok: false; issue: AmountInputIssue }

function decimalTextOf(value: number | string): string | null {
  if (typeof value === 'string') return value.trim()
  if (!Number.isFinite(value)) return null
  const text = String(value)
  if (!/e/i.test(text)) return text
  if (Math.abs(value) >= 1e21) return null
  return value.toFixed(20)
}

function splitDecimal(value: number | string): DecimalParts | null {
  const text = decimalTextOf(value)
  if (text === null) return null
  const match = DECIMAL_PATTERN.exec(text)
  if (!match) return null
  return { negative: match[1] === '-', whole: match[2], fraction: match[3] ?? '' }
}

function scaledOf(parts: DecimalParts): bigint {
  const kept = parts.fraction.slice(0, AMOUNT_SCALE).padEnd(AMOUNT_SCALE, '0')
  const roundsUp = parts.fraction.length > AMOUNT_SCALE && Number(parts.fraction[AMOUNT_SCALE]) >= 5
  const magnitude = BigInt(parts.whole) * SCALE_FACTOR + BigInt(kept) + (roundsUp ? 1n : 0n)
  return parts.negative ? -magnitude : magnitude
}

function requireScaled(value: number | string): bigint {
  const parts = splitDecimal(value)
  if (!parts) throw new Error(`[internal] Invalid amount: ${value}`)
  return scaledOf(parts)
}

function formatScaled(scaled: bigint): string {
  const negative = scaled < 0n
  const magnitude = negative ? -scaled : scaled
  const whole = (magnitude / SCALE_FACTOR).toString()
  const fraction = (magnitude % SCALE_FACTOR).toString().padStart(AMOUNT_SCALE, '0').replace(/0+$/, '')
  const sign = negative && magnitude !== 0n ? '-' : ''
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`
}

export function formatAmount(value: number | string): string {
  return formatScaled(requireScaled(value))
}

export function multiplyAmount(value: number | string, quantity: number): string {
  if (!Number.isSafeInteger(quantity)) throw new Error(`[internal] Invalid quantity: ${quantity}`)
  return formatScaled(requireScaled(value) * BigInt(quantity))
}

export function parseAmountInput(value: unknown): AmountInputResult {
  if (typeof value !== 'number' && typeof value !== 'string') return { ok: false, issue: 'invalid' }
  const text = typeof value === 'number' ? (Number.isFinite(value) && !/e/i.test(String(value)) ? String(value) : null) : value.trim()
  if (text === null) return { ok: false, issue: 'invalid' }
  const match = UNSIGNED_DECIMAL_PATTERN.exec(text)
  if (!match) return { ok: false, issue: 'invalid' }
  const fraction = (match[2] ?? '').replace(/0+$/, '')
  if (fraction.length > AMOUNT_SCALE) return { ok: false, issue: 'too_precise' }
  const scaled = scaledOf({ negative: false, whole: match[1], fraction })
  if (scaled <= 0n || scaled > BigInt(MAX_AMOUNT) * SCALE_FACTOR) return { ok: false, issue: 'out_of_range' }
  return { ok: true, amount: formatScaled(scaled) }
}
