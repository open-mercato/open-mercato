/**
 * How the Kingdom writes money — and, more importantly, how it must **not**.
 *
 * Saudi documents are read in Arabic, where the decimal separator an operator
 * types can be `٫` and the grouping separator `٬`. None of that may reach a
 * machine value: a ZATCA QR payload, an invoice XML amount and a stored ledger
 * figure are always Western digits with a dot separator and two decimals, because
 * ZATCA parses them positionally. So the contract has two entry points and they
 * are not interchangeable — `formatMachine` for anything an invoice, a QR code
 * or a hash will carry, `formatDisplay` for what a human reads on screen.
 */
import type { NumberFormatContract } from '@/modules/financial/lib/contracts'
import { formatSaudDecimal } from './vat'

export const SAUDI_COUNTRY_CODE = 'SA'
export const SAUDI_CURRENCY_CODE = 'SAR'
export const SAUDI_FRACTION_DIGITS = 2

export function buildSaudiNumberFormat(): NumberFormatContract {
  return {
    countryCode: SAUDI_COUNTRY_CODE,
    currencyCode: SAUDI_CURRENCY_CODE,
    decimalSeparator: '.',
    groupSeparator: ',',
    fractionDigits: SAUDI_FRACTION_DIGITS,
    // Delegates to the pinned primitive rather than re-rounding here: the QR
    // builder and the UBL writer already call it, and two rounding paths on one
    // amount is how an invoice and its encoded total end a halala apart.
    formatMachine: (value) => formatSaudDecimal(value),
    // The default locale is the jurisdiction's, which renders Arabic-Indic
    // digits. A screen that knows the operator's UI locale passes it, so an
    // Arabic document and an English back office can show the same amount
    // differently without either of them changing the machine value.
    formatDisplay: (value, locale) => {
      const machine = formatSaudDecimal(value)
      try {
        return new Intl.NumberFormat(locale || 'ar-SA', {
          minimumFractionDigits: SAUDI_FRACTION_DIGITS,
          maximumFractionDigits: SAUDI_FRACTION_DIGITS,
        }).format(Number(machine))
      } catch {
        return machine
      }
    },
  }
}
