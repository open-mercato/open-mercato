// Line currency resolution and the base-amount consistency rule.
//
// Every `JournalEntryLine` stores `currencyId`, `exchangeRate` (base-currency
// units per one unit of the line's currency) and `amountCurrency` (unsigned
// magnitude in the line's own currency) next to the base-currency
// `debit`/`credit`. See .ai/specs/2026-08-18-general-ledger-core-engine.md,
// Design decisions: "Multi-currency".
//
// All arithmetic is BigInt on exact decimal strings. `Number` loses
// precision long before the column limits (numeric(19,4) / numeric(18,8)).

const AMOUNT_SCALE = 4
const RATE_SCALE = 8

/** Parses a non-negative decimal string into an integer count of 10^-scale units. */
export function toScaledUnits(value: string | null | undefined, scale: number): bigint {
  if (!value) return 0n
  const [whole, fraction = ''] = value.split('.')
  const padded = `${fraction}${'0'.repeat(scale)}`.slice(0, scale)
  return BigInt(whole || '0') * 10n ** BigInt(scale) + BigInt(padded || '0')
}

export type LineCurrencyInput = {
  currencyId?: string | null
  exchangeRate?: string | null
  amountCurrency?: string | null
  debit?: string
  credit?: string
}

export type HeaderCurrency = {
  currencyId: string
  exchangeRate?: string | null
}

export type ResolvedLineCurrency = {
  currencyId: string
  exchangeRate: string
  amountCurrency: string
}

export type LineCurrencyProblem = 'rateMissing' | 'rateNotPositive' | 'baseRateNotOne' | 'amountCurrencyMissing'

/**
 * Fills in a line's currency, rate and original amount at write time, so a
 * stored line is never null. A line that omits its currency takes the
 * header's currency and rate; a base-currency line stores rate `1` and an
 * `amountCurrency` equal to its `debit`/`credit`. A foreign-currency line
 * must carry an `amountCurrency` (it is not guessed back from the base amount).
 */
export function resolveLineCurrency(
  line: LineCurrencyInput,
  header: HeaderCurrency,
  baseCurrencyId: string,
): { ok: true; value: ResolvedLineCurrency } | { ok: false; problem: LineCurrencyProblem } {
  const currencyId = line.currencyId ?? header.currencyId
  const isBase = currencyId === baseCurrencyId

  let exchangeRate: string | null | undefined = line.exchangeRate
  if (exchangeRate == null) {
    if (isBase) exchangeRate = '1'
    else if (currencyId === header.currencyId && header.exchangeRate != null) exchangeRate = header.exchangeRate
    else return { ok: false, problem: 'rateMissing' }
  }
  const rateUnits = toScaledUnits(exchangeRate, RATE_SCALE)
  if (rateUnits <= 0n) return { ok: false, problem: 'rateNotPositive' }
  if (isBase && rateUnits !== 10n ** BigInt(RATE_SCALE)) return { ok: false, problem: 'baseRateNotOne' }

  let amountCurrency: string | null | undefined = line.amountCurrency
  if (amountCurrency == null) {
    if (!isBase) return { ok: false, problem: 'amountCurrencyMissing' }
    amountCurrency = toScaledUnits(line.debit, AMOUNT_SCALE) > 0n ? (line.debit as string) : (line.credit as string)
  }

  return { ok: true, value: { currencyId, exchangeRate, amountCurrency } }
}

/**
 * `|amountCurrency x exchangeRate - base|` must not exceed half the smallest
 * unit of the base currency (team decision 2026-10-23, not yet reviewed by a controller or maintainer).
 * A line with `amountCurrency = 0` is exempt: an exchange-difference line
 * changes the base value of an open item without changing its foreign amount.
 */
export function isLineConsistent(
  resolved: ResolvedLineCurrency,
  line: { debit?: string; credit?: string },
  baseDecimalPlaces: number,
): boolean {
  const amount = toScaledUnits(resolved.amountCurrency, AMOUNT_SCALE)
  if (amount === 0n) return true
  const rate = toScaledUnits(resolved.exchangeRate, RATE_SCALE)
  const baseAmount = toScaledUnits(line.debit, AMOUNT_SCALE) > 0n ? line.debit : line.credit
  const base = toScaledUnits(baseAmount, AMOUNT_SCALE)
  // Common scale: 10^-(AMOUNT_SCALE + RATE_SCALE).
  const product = amount * rate
  const baseScaled = base * 10n ** BigInt(RATE_SCALE)
  const diff = product > baseScaled ? product - baseScaled : baseScaled - product
  const places = Math.max(0, Math.min(baseDecimalPlaces, AMOUNT_SCALE))
  // Half of 10^-places, expressed in the common scale.
  const tolerance = 5n * 10n ** BigInt(AMOUNT_SCALE + RATE_SCALE - places - 1)
  return diff <= tolerance
}
