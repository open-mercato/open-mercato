export type FormatCurrencyOptions = {
  currency?: string
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

export function formatCurrency(value: number, options: FormatCurrencyOptions = {}): string {
  const { currency = 'USD', minimumFractionDigits = 0, maximumFractionDigits = 0 } = options
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value)
}

export function formatCurrencyWithDecimals(value: number, options: FormatCurrencyOptions = {}): string {
  return formatCurrency(value, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...options })
}

export function formatCurrencyCompact(value: number, currencySymbol = '$'): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${currencySymbol}${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `${currencySymbol}${(value / 1_000).toFixed(1)}K`
  }
  return `${currencySymbol}${value.toFixed(0)}`
}

export function formatCurrencySafe(value: unknown, fallback = '--'): string {
  if (value === null || value === undefined) return fallback
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return formatCurrency(num)
}
