/**
 * Whether a ledger amount is not zero.
 *
 * Ledger amounts (`debit`, `credit`) are plain non-negative decimal strings
 * with at most four decimal places ("250.0000", "0.0000"), so a non-zero value
 * always contains a digit 1-9. The check reads the string and never converts
 * it to a JS number — the ledger's string-only rule. It is only valid for
 * that format (no sign, no exponent); if a shared decimal helper is
 * introduced for money, replace this with it.
 */
export function isNonZeroAmount(value: string): boolean {
  return /[1-9]/.test(value)
}
