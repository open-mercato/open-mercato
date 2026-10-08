import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { ExplainValueKind } from '@open-mercato/shared/modules/insights/explain'

const NUMERIC_KINDS: ReadonlySet<ExplainValueKind> = new Set<ExplainValueKind>(['number', 'decimal', 'money'])
const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?$/
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const NULL_TOKEN = 'null:'

export function canonicalDecimal(raw: string): string | null {
  const trimmed = raw.trim()
  const match = DECIMAL_PATTERN.exec(trimmed)
  if (!match) return null
  const [, sign, integerDigits, fractionDigits = ''] = match
  if (!integerDigits && !fractionDigits) return null
  const integerPart = integerDigits.replace(/^0+/, '') || '0'
  const fractionPart = fractionDigits.replace(/0+$/, '')
  const magnitude = fractionPart ? `${integerPart}.${fractionPart}` : integerPart
  if (magnitude === '0') return '0'
  return sign === '-' ? `-${magnitude}` : magnitude
}

function numberToCanonical(value: number): string | null {
  if (!Number.isFinite(value)) return null
  if (Object.is(value, -0)) return '0'
  const text = String(value)
  if (!/e/i.test(text)) return canonicalDecimal(text)
  const fixed = Math.abs(value) < 1 ? value.toFixed(20) : BigInt(Math.trunc(value)).toString()
  return canonicalDecimal(fixed)
}

function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isNaN(time) ? null : time
  }
  if (typeof value === 'string' && (ISO_DATETIME_PATTERN.test(value) || ISO_DATE_PATTERN.test(value))) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (value instanceof Date) return JSON.stringify(Number.isNaN(value.getTime()) ? null : value.toISOString())
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  return JSON.stringify(value)
}

function canonicalNumeric(value: unknown): string | null {
  if (typeof value === 'number') return numberToCanonical(value)
  if (typeof value === 'bigint') return canonicalDecimal(value.toString())
  if (typeof value === 'string') return canonicalDecimal(value)
  return null
}

function isNumericPrimitive(value: unknown): boolean {
  return typeof value === 'number' || typeof value === 'bigint'
}

function isCanonicalDecimalString(value: string): boolean {
  const canonical = canonicalDecimal(value)
  return canonical !== null && canonical === value.trim()
}

function readsAsNumber(value: unknown, kind: ExplainValueKind, counterpart: unknown): boolean {
  if (NUMERIC_KINDS.has(kind)) return true
  if (kind !== 'custom_field') return false
  if (typeof value !== 'string') return true
  return isCanonicalDecimalString(value) || isNumericPrimitive(counterpart)
}

function canonicalBoolean(value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return value === 1 ? 'true' : value === 0 ? 'false' : null
  if (typeof value === 'string') {
    const parsed = parseBooleanToken(value)
    return parsed === null ? null : parsed ? 'true' : 'false'
  }
  return null
}

function canonicalDate(value: unknown): string | null {
  if (typeof value === 'string' && ISO_DATE_PATTERN.test(value.trim())) return value.trim()
  const timestamp = toTimestamp(value)
  if (timestamp === null) return null
  return new Date(timestamp).toISOString().slice(0, 10)
}

function canonicalDatetime(value: unknown): string | null {
  const timestamp = toTimestamp(value)
  if (timestamp === null) return null
  return new Date(timestamp).toISOString()
}

function canonicalize(value: unknown, kind: ExplainValueKind, counterpart: unknown): string {
  if (value === null || value === undefined) return NULL_TOKEN
  if (typeof value === 'string' && value.length === 0) return NULL_TOKEN
  if (readsAsNumber(value, kind, counterpart)) {
    const numeric = canonicalNumeric(value)
    if (numeric !== null) return `n:${numeric}`
  }
  if (kind === 'boolean') {
    const flag = canonicalBoolean(value)
    if (flag !== null) return `b:${flag}`
  }
  if (kind === 'date') {
    const date = canonicalDate(value)
    if (date !== null) return `d:${date}`
  }
  if (kind === 'datetime') {
    const datetime = canonicalDatetime(value)
    if (datetime !== null) return `t:${datetime}`
  }
  if (value instanceof Date) {
    const datetime = canonicalDatetime(value)
    return datetime === null ? NULL_TOKEN : `t:${datetime}`
  }
  if (typeof value === 'string') {
    if (ISO_DATETIME_PATTERN.test(value)) {
      const datetime = canonicalDatetime(value)
      if (datetime !== null) return `t:${datetime}`
    }
    return `s:${value}`
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return `s:${String(value)}`
  }
  return `j:${stableSerialize(value)}`
}

/**
 * Canonical comparison token for one value. Custom-field strings count as numbers only
 * when already written in canonical decimal form (`'1.5'`, not `'1.50'`, `'+48123'` or
 * `'007'`), because custom fields often hold identifiers and phone numbers.
 */
export function canonicalValue(value: unknown, kind: ExplainValueKind): string {
  return canonicalize(value, kind, undefined)
}

/**
 * Compares two values of one kind. For custom fields a non-canonical numeric string is
 * compared numerically only against a JS number or bigint; otherwise strings compare
 * exactly.
 */
export function valuesEqual(left: unknown, right: unknown, kind: ExplainValueKind): boolean {
  return canonicalize(left, kind, right) === canonicalize(right, kind, left)
}

export function toResponseValue(value: unknown): unknown {
  if (value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map((item) => toResponseValue(item))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue
      result[key] = toResponseValue(item)
    }
    return result
  }
  return value
}
