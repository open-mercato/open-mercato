import { withProfile, displayLocale, type DisplayProfile } from './profile'

export type FormatMoneyOptions = {
  /** Locale to fall back to when the profile carries no `languageTag` (today's UI language). */
  locale?: string | null
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

function toNumeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeCurrencyCode(currencyCode: string | null | undefined): string | undefined {
  if (typeof currencyCode !== 'string') return undefined
  const trimmed = currencyCode.trim()
  return trimmed.length === 3 ? trimmed.toUpperCase() : undefined
}

/**
 * Rebuild a formatted amount with the profile's own separators.
 *
 * `Intl` has no option for this, and a blind string replace cannot work: `1.234,56` and `1,234.56`
 * use each other's characters, so replacing one at a time corrupts the other. Parts carry the role
 * of each token, so the swap is unambiguous.
 */
function applySeparators(
  parts: Intl.NumberFormatPart[],
  decimalSeparator: string | null,
  thousandsSeparator: string | null,
): string {
  return parts
    .map((part) => {
      if (part.type === 'group' && thousandsSeparator !== null) return thousandsSeparator
      if (part.type === 'decimal' && decimalSeparator !== null) return decimalSeparator
      return part.value
    })
    .join('')
}

/**
 * Render an amount in the market's money conventions.
 *
 * Returns `null` for an empty value and echoes a non-numeric string back, matching the
 * `formatCurrency` helper it supersedes so a migrated call site keeps its empty-state behavior.
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currencyCode: string | null | undefined,
  profile?: DisplayProfile | null,
  options?: FormatMoneyOptions,
): string | null {
  const numeric = toNumeric(amount)
  if (numeric === null) return typeof amount === 'string' && amount !== '' ? amount : null

  const resolved = withProfile(profile)
  const locale = displayLocale(profile, options?.locale)
  const code = normalizeCurrencyCode(currencyCode) ?? normalizeCurrencyCode(resolved.currencyCode)

  const negative = numeric < 0
  const useParentheses = negative && resolved.negativeStyle === 'parentheses'
  const magnitude = useParentheses ? Math.abs(numeric) : numeric

  const fractionOptions: Intl.NumberFormatOptions = {}
  if (options?.minimumFractionDigits !== undefined) fractionOptions.minimumFractionDigits = options.minimumFractionDigits
  if (options?.maximumFractionDigits !== undefined) fractionOptions.maximumFractionDigits = options.maximumFractionDigits

  let body: string
  let appendCode = false

  if (code) {
    const currencyDisplay = resolved.currencyDisplay === 'code' ? 'code' : 'symbol'
    try {
      const formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code,
        currencyDisplay,
        ...fractionOptions,
      })
      body = applySeparators(formatter.formatToParts(magnitude), resolved.decimalSeparator, resolved.thousandsSeparator)
      appendCode = resolved.currencyDisplay === 'symbol_and_code'
    } catch {
      const formatter = new Intl.NumberFormat(locale, fractionOptions)
      body = applySeparators(formatter.formatToParts(magnitude), resolved.decimalSeparator, resolved.thousandsSeparator)
      appendCode = true
    }
  } else {
    const formatter = new Intl.NumberFormat(locale, fractionOptions)
    body = applySeparators(formatter.formatToParts(magnitude), resolved.decimalSeparator, resolved.thousandsSeparator)
  }

  if (appendCode && code) body = `${body} ${code}`
  return useParentheses ? `(${body})` : body
}

/** Render a plain number (no currency) in the market's numeric conventions. */
export function formatNumber(
  value: string | number | null | undefined,
  profile?: DisplayProfile | null,
  options?: FormatMoneyOptions,
): string | null {
  const numeric = toNumeric(value)
  if (numeric === null) return typeof value === 'string' && value !== '' ? value : null

  const resolved = withProfile(profile)
  const locale = displayLocale(profile, options?.locale)

  const fractionOptions: Intl.NumberFormatOptions = {}
  if (options?.minimumFractionDigits !== undefined) fractionOptions.minimumFractionDigits = options.minimumFractionDigits
  if (options?.maximumFractionDigits !== undefined) fractionOptions.maximumFractionDigits = options.maximumFractionDigits

  const negative = numeric < 0
  const useParentheses = negative && resolved.negativeStyle === 'parentheses'
  const magnitude = useParentheses ? Math.abs(numeric) : numeric

  const formatter = new Intl.NumberFormat(locale, fractionOptions)
  const body = applySeparators(formatter.formatToParts(magnitude), resolved.decimalSeparator, resolved.thousandsSeparator)
  return useParentheses ? `(${body})` : body
}
