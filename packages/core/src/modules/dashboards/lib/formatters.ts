export type FormatCurrencyOptions = {
  currency?: string | null
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/

function normalizeCurrencyCode(currency?: string | null): string | null {
  if (typeof currency !== 'string') return null
  const trimmed = currency.trim()
  if (!CURRENCY_CODE_PATTERN.test(trimmed)) return null
  return trimmed.toUpperCase()
}

function formatDecimal(value: number, minimumFractionDigits: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'decimal',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value)
}

/**
 * Formats a monetary amount. Without a currency code the amount renders as a plain
 * number: analytics values carry no currency of their own, and labelling them with a
 * guessed one (see #4620) is worse than leaving them unlabelled.
 */
export function formatCurrency(value: number, options: FormatCurrencyOptions = {}): string {
  const { currency, minimumFractionDigits = 0, maximumFractionDigits = 0 } = options
  const code = normalizeCurrencyCode(currency)
  if (!code) return formatDecimal(value, minimumFractionDigits, maximumFractionDigits)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value)
  } catch {
    return `${formatDecimal(value, minimumFractionDigits, maximumFractionDigits)} ${code}`
  }
}

export function formatCurrencyWithDecimals(value: number, options: FormatCurrencyOptions = {}): string {
  return formatCurrency(value, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...options })
}

function resolveCurrencySymbol(currency?: string | null): string {
  const code = normalizeCurrencyCode(currency)
  if (!code) return typeof currency === 'string' ? currency : ''
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0)
    return parts.find((part) => part.type === 'currency')?.value ?? code
  } catch {
    return code
  }
}

/**
 * Compact money formatting for chart axes and tooltips. Accepts either an ISO 4217
 * code (resolved to the locale's symbol) or a ready-made symbol.
 */
export function formatCurrencyCompact(value: number, currency?: string | null): string {
  const symbol = resolveCurrencySymbol(currency)
  if (Math.abs(value) >= 1_000_000) {
    return `${symbol}${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `${symbol}${(value / 1_000).toFixed(1)}K`
  }
  return `${symbol}${value.toFixed(0)}`
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

export type CurrencyFormatters = {
  currency: string | null
  format: (value: number) => string
  formatWithDecimals: (value: number) => string
  formatCompact: (value: number) => string
  formatSafe: (value: unknown) => string
}

/**
 * Binds the resolved currency once so widgets can hand chart and KPI components a
 * stable single-argument formatter — passing `formatCurrency` by reference is what
 * made its currency option unreachable in the first place (#4620).
 */
export function createCurrencyFormatters(
  currency?: string | null,
  fallback = '--',
): CurrencyFormatters {
  const code = normalizeCurrencyCode(currency)
  return {
    currency: code,
    format: (value: number) => formatCurrency(value, { currency: code }),
    formatWithDecimals: (value: number) => formatCurrencyWithDecimals(value, { currency: code }),
    formatCompact: (value: number) => formatCurrencyCompact(value, code),
    formatSafe: (value: unknown) => formatCurrencySafe(value, fallback, { currency: code }),
  }
}
