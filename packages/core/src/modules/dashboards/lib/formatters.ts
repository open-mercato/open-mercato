/**
 * Last-resort currency used when the caller could not resolve a base currency
 * (currencies module disabled, or a tenant without an `is_base` row). Keeps the
 * historical rendering instead of dropping the currency label entirely.
 */
export const FALLBACK_CURRENCY = 'USD'

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

export type FormatCurrencyOptions = {
  currency?: string | null
  /** Defaults to the runtime locale; mainly an injection point for deterministic tests. */
  locale?: string
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

export type FormatCurrencyCompactOptions = {
  currency?: string | null
  locale?: string
}

/**
 * `Intl.NumberFormat` throws on malformed currency codes, and the code now comes
 * from tenant data rather than a literal, so anything that is not a well-formed
 * ISO-4217 code degrades to the fallback.
 */
export function resolveCurrencyCode(currency?: string | null): string {
  const normalized = typeof currency === 'string' ? currency.trim().toUpperCase() : ''
  return CURRENCY_CODE_PATTERN.test(normalized) ? normalized : FALLBACK_CURRENCY
}

export function formatCurrency(value: number, options: FormatCurrencyOptions = {}): string {
  const { currency, locale, minimumFractionDigits = 0, maximumFractionDigits = 0 } = options
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: resolveCurrencyCode(currency),
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value)
}

export function formatCurrencyWithDecimals(value: number, options: FormatCurrencyOptions = {}): string {
  return formatCurrency(value, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...options })
}

function formatWithSymbolPrefix(value: number, currencySymbol: string): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${currencySymbol}${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `${currencySymbol}${(value / 1_000).toFixed(1)}K`
  }
  return `${currencySymbol}${value.toFixed(0)}`
}

/**
 * Compact money label for chart axes and tooltips.
 *
 * Passing a currency code routes through `Intl` so the symbol lands where the
 * locale puts it (`1,0 mln zł`, not `zł1.0M`). The legacy string form —
 * `formatCurrencyCompact(value, '€')` — keeps prefixing the given symbol so
 * existing callers outside this module are unaffected.
 */
export function formatCurrencyCompact(
  value: number,
  options: string | FormatCurrencyCompactOptions = {},
): string {
  if (typeof options === 'string') {
    return formatWithSymbolPrefix(value, options)
  }

  const compact = Math.abs(value) >= 1_000
  return new Intl.NumberFormat(options.locale, {
    style: 'currency',
    currency: resolveCurrencyCode(options.currency),
    notation: compact ? 'compact' : 'standard',
    compactDisplay: 'short',
    minimumFractionDigits: compact ? 1 : 0,
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value)
}

export function formatCurrencySafe(
  value: unknown,
  fallback = '--',
  options: FormatCurrencyOptions = {},
): string {
  if (value === null || value === undefined) return fallback
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return formatCurrency(num, options)
}
