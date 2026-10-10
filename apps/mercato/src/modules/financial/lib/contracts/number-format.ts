/**
 * How a jurisdiction writes money. Types only.
 *
 * The split that matters: **machine values never go through the display
 * formatter.** A document's QR payload, an API amount and a stored ledger value
 * are always `1234.50` — dot separator, no grouping, fixed fraction digits — and
 * only what a human reads is localized. Formatters that decide both are how a
 * grouped string ends up inside a hash.
 */

export type NumberFormatContract = {
  readonly countryCode: string
  /** ISO 4217. */
  readonly currencyCode: string
  readonly decimalSeparator: string
  readonly groupSeparator: string
  readonly fractionDigits: number
  /**
   * The canonical wire/QR/storage form: fixed fraction digits, dot separator,
   * never grouped, never localized. Safe to hash and to compare as a string.
   */
  formatMachine(value: string | number): string
  /** The form a human reads, in the given locale when the runtime supports it. */
  formatDisplay(value: string | number, locale?: string): string
}
