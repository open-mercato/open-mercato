import {
  countDecimalPlaces,
  decimalToString,
  parseDecimal,
  resolveIsoCurrencyDecimalPlaces,
  type DecimalValue,
} from '@open-mercato/shared/lib/decimal'

export type FormatCurrencyOptions = {
  /** Show every decimal of the value instead of capping at the currency precision. */
  showAllDigits?: boolean
}

/**
 * Format a monetary value with an optional ISO-4217 currency code.
 *
 * Returns `null` for empty input, the original string for non-numeric input,
 * and falls back to a plain number format (optionally suffixed with the code)
 * when the currency code is missing or rejected by `Intl.NumberFormat`.
 *
 * Decimal strings are formatted exactly (no float round-trip). The value is
 * rounded to the currency precision when it is known: `decimalPlaces` (the
 * currency's configured precision), else the ISO 4217 digits of the code
 * (`8.1301` USD shows `$8.13`). Shorter values are padded to that precision
 * (`5.000` KWD, `5` JPY). For codes without a known precision (`ETH`) every
 * decimal is kept and shorter values are padded to 2; pass
 * `{ showAllDigits: true }` to keep every decimal for any currency. Without a
 * currency code the value is formatted as a plain number.
 *
 * Pass `locale` to format in the application locale (`useLocale()` in client
 * components). Omitting it keeps the runtime default, which varies per machine
 * and is therefore not assertable in tests.
 */
export function formatCurrency(
  value: string | number | null | undefined,
  currency?: string | null,
  locale?: string,
  decimalPlaces?: number | null,
  options?: FormatCurrencyOptions,
): string | null {
  if (value === null || value === undefined || value === '') return null
  const code = currency && currency.length === 3 ? currency.toUpperCase() : undefined
  const exact = parseDecimal(value)
  if (!exact) return formatUnparsedAmount(value, code, locale)
  const amount = decimalToString(exact) as Intl.StringNumericLiteral
  const digits = resolveFractionDigits(exact, code, decimalPlaces, options?.showAllDigits === true)
  return formatAmount(amount, code, locale, digits)
}

function formatAmount(
  amount: number | Intl.StringNumericLiteral,
  code: string | undefined,
  locale: string | undefined,
  digits: Intl.NumberFormatOptions,
): string {
  try {
    if (code) {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: code, ...digits }).format(amount)
    }
  } catch {
    // fall through to plain number formatting
  }
  const formatted = new Intl.NumberFormat(locale, digits).format(amount)
  return code ? `${formatted} ${code}` : formatted
}

function formatUnparsedAmount(value: string | number, code: string | undefined, locale: string | undefined): string | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return typeof value === 'string' ? value : null
  return formatAmount(numeric, code, locale, {})
}

const DEFAULT_CURRENCY_FRACTION_DIGITS = 2
const LEGACY_MAX_INTL_FRACTION_DIGITS = 20
const EXTENDED_MAX_INTL_FRACTION_DIGITS = 100

let maxIntlFractionDigits: number | null = null

function resolveMaxIntlFractionDigits(): number {
  if (maxIntlFractionDigits !== null) return maxIntlFractionDigits
  try {
    new Intl.NumberFormat('en', { maximumFractionDigits: EXTENDED_MAX_INTL_FRACTION_DIGITS })
    maxIntlFractionDigits = EXTENDED_MAX_INTL_FRACTION_DIGITS
  } catch {
    maxIntlFractionDigits = LEGACY_MAX_INTL_FRACTION_DIGITS
  }
  return maxIntlFractionDigits
}

function resolveFractionDigits(
  exact: DecimalValue,
  code: string | undefined,
  decimalPlaces: number | null | undefined,
  showAllDigits: boolean,
): Intl.NumberFormatOptions {
  const configured =
    typeof decimalPlaces === 'number' && Number.isInteger(decimalPlaces) && decimalPlaces >= 0 ? decimalPlaces : null
  const isoDigits = code ? resolveIsoCurrencyDecimalPlaces(code) : null
  if (!code && configured === null && !showAllDigits) return {}
  const currencyDigits = code ? isoDigits ?? DEFAULT_CURRENCY_FRACTION_DIGITS : configured === null ? 0 : DEFAULT_CURRENCY_FRACTION_DIGITS
  const minimum = configured === null ? currencyDigits : Math.min(currencyDigits, configured)
  const precision = configured ?? isoDigits
  const valueDigits = showAllDigits || precision === null ? countDecimalPlaces(exact) : precision
  const maximum = Math.min(Math.max(minimum, valueDigits), resolveMaxIntlFractionDigits())
  return { minimumFractionDigits: Math.min(minimum, maximum), maximumFractionDigits: maximum }
}

/**
 * Format an ISO date string as a localized short date (e.g. `Jun 9, 2026`).
 *
 * Returns `null` for empty input and echoes the original value back when it is
 * not a parseable date. Pass `locale` to format in the application locale.
 */
export function formatDate(value: string | null | undefined, locale?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}
