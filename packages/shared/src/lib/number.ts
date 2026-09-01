type LocaleNumberSeparators = { group: string; decimal: string }

const DEFAULT_SEPARATORS: LocaleNumberSeparators = { group: ',', decimal: '.' }
const separatorCache = new Map<string, LocaleNumberSeparators>()

const UNICODE_MINUS_SIGNS = /[−‒–—]/g
const WHITESPACE = /\s/g
const WHITESPACE_ONLY = /^\s+$/
const APOSTROPHE_GROUP_SEPARATORS = /['’ʼ]/g
const NORMALIZED_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i

/**
 * Group and decimal separators the given locale uses, derived from `Intl` rather than
 * assumed, so grouping characters such as the narrow no-break space (`fr-FR`) are covered.
 */
export function resolveLocaleNumberSeparators(locale?: string): LocaleNumberSeparators {
  const cacheKey = locale ?? ''
  const cached = separatorCache.get(cacheKey)
  if (cached) return cached
  let resolved = DEFAULT_SEPARATORS
  try {
    const parts = new Intl.NumberFormat(locale, {
      useGrouping: true,
      minimumFractionDigits: 1,
    }).formatToParts(12345.6)
    const group = parts.find((part) => part.type === 'group')?.value ?? DEFAULT_SEPARATORS.group
    const decimal = parts.find((part) => part.type === 'decimal')?.value ?? DEFAULT_SEPARATORS.decimal
    resolved = { group, decimal }
  } catch {
    resolved = DEFAULT_SEPARATORS
  }
  separatorCache.set(cacheKey, resolved)
  return resolved
}

function isValidGrouping(integerPart: string, separator: string): boolean {
  const digits = integerPart.replace(/^[+-]/, '')
  const segments = digits.split(separator)
  if (segments.length < 2) return true
  const [first, ...rest] = segments
  if (!/^\d{1,3}$/.test(first)) return false
  return rest.every((segment) => /^\d{3}$/.test(segment))
}

/**
 * Parses a user-typed number written in the conventions of `locale` — `110,70` under `pl-PL`,
 * `1 234,56` under `fr-FR`, `1,234.56` under `en-US`. Returns `null` when the input is not a
 * number, never a silent `0`, so callers can tell "unparseable" apart from "zero".
 *
 * Both `,` and `.` are accepted as the decimal separator whichever way the locale runs, because
 * users type the shape their keyboard offers. When only one of them appears and it is the
 * locale's GROUP separator, it is read as grouping only where the digits form valid groups of
 * three (`1.234` under `pl-PL` is 1234) and as a decimal point otherwise (`110.70` is 110.7).
 *
 * Use it only on strings a user typed. Values arriving from an API or the database are already
 * numbers and MUST NOT go through it.
 */
export function parseLocaleNumber(input: string | null | undefined, locale?: string): number | null {
  if (input == null) return null
  const trimmed = input.trim()
  if (!trimmed) return null

  const { group, decimal } = resolveLocaleNumberSeparators(locale)
  let candidate = trimmed
    .replace(UNICODE_MINUS_SIGNS, '-')
    .replace(WHITESPACE, '')
    .replace(APOSTROPHE_GROUP_SEPARATORS, '')
  if (group && !WHITESPACE_ONLY.test(group) && group !== ',' && group !== '.') {
    candidate = candidate.split(group).join('')
  }
  if (!candidate) return null

  const hasComma = candidate.includes(',')
  const hasDot = candidate.includes('.')
  let decimalSeparator: string | null = null
  if (hasComma && hasDot) {
    decimalSeparator = candidate.lastIndexOf(',') > candidate.lastIndexOf('.') ? ',' : '.'
  } else if (hasComma || hasDot) {
    const separator = hasComma ? ',' : '.'
    const segments = candidate.split(separator)
    const isLocaleGroupSeparator = separator === group && separator !== decimal
    const readAsGrouping =
      segments.length > 2 || (isLocaleGroupSeparator && /^\d{3}$/.test(segments[1]))
    decimalSeparator = readAsGrouping ? null : separator
  }

  const groupSeparator = decimalSeparator
    ? decimalSeparator === ','
      ? '.'
      : ','
    : hasComma
      ? ','
      : '.'
  const [integerPart, ...fractionParts] = decimalSeparator ? candidate.split(decimalSeparator) : [candidate]
  if (fractionParts.length > 1) return null
  if (!isValidGrouping(integerPart, groupSeparator)) return null
  if (fractionParts.length && fractionParts[0].includes(groupSeparator)) return null

  const normalized = `${integerPart.split(groupSeparator).join('')}${fractionParts.length ? `.${fractionParts[0]}` : ''}`
  if (!NORMALIZED_NUMBER.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseNumberWithDefault(
  raw: string | null | undefined,
  fallback: number,
  options?: { min?: number; integer?: boolean },
): number {
  if (raw == null) return fallback
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const value = options?.integer ? Number.parseInt(trimmed, 10) : Number(trimmed)
  if (!Number.isFinite(value)) return fallback
  const min = options?.min ?? -Infinity
  if (value < min) return fallback
  return value
}
