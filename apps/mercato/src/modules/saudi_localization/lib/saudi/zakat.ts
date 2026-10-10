/**
 * Zakat groundwork, deliberately and narrowly scoped.
 *
 * ZATCA assesses zakat on the Saudi (and GCC) share of an entity's ownership,
 * alongside the VAT and income-tax filing. The full rules — the ownership mix,
 * the additions and deductions schedules, the treatment of provisions that are
 * not deductible, and the Hijri/Gregorian year-length adjustment — are a filing
 * an accountant makes, not something to approximate silently in code.
 *
 * So this module computes **the base and the rate, and says what it left out**.
 * The base follows the sources-of-funds method at its coarsest: paid-up capital,
 * reserves, retained earnings and provisions, plus long-term liabilities, less
 * the fixed and intangible assets that are not themselves zakatable. Every input
 * is a named figure the caller passes in, so the arithmetic is auditable and a
 * tenant can see exactly which of its numbers produced the base it filed.
 *
 * The rate is the 2.5% applied to a Gregorian fiscal year; an entity filing on a
 * Hijri year uses the 2.577% equivalent, which is why the rate is returned
 * alongside the base rather than assumed by the caller.
 */
import { roundDecimalHalfUp, sumDecimalStrings, negateDecimal } from '@/modules/financial/lib/money'

/** Paid-up capital, reserves, retained earnings and non-deductible provisions. */
export type ZakatBaseInput = {
  shareCapital: string | number
  statutoryReserves: string | number
  retainedEarnings: string | number
  provisions: string | number
  longTermLiabilities: string | number
  /** Deducted: the assets the base excludes. */
  fixedAssets: string | number
  intangibleAssets: string | number
  /** Optional per-figure adjustments a tenant's assessment requires. */
  additions?: string | number
  deductions?: string | number
}

export type ZakatBaseResult = {
  /** Sources of funds, before deductions. */
  sourcesOfFunds: string
  /** What was subtracted from them. */
  deductions: string
  /** `sourcesOfFunds - deductions`, floored at zero. */
  zakatBase: string
  /** 2.5% for a Gregorian year, 2.577% for a Hijri year. */
  rate: number
  zakatDue: string
  /** Calendar-year filing by default; ZATCA assesses zakat annually. */
  filingFrequency: 'annual'
}

export const SAUDI_ZAKAT_GREGORIAN_RATE = 0.025
export const SAUDI_ZAKAT_HIJRI_RATE = 0.02577

export function computeSaudiZakatBase(
  input: ZakatBaseInput,
  options?: { rate?: number },
): ZakatBaseResult {
  const rate = options?.rate ?? SAUDI_ZAKAT_GREGORIAN_RATE
  const sourcesOfFunds = sumDecimalStrings(
    [
      input.shareCapital,
      input.statutoryReserves,
      input.retainedEarnings,
      input.provisions,
      input.longTermLiabilities,
      input.additions ?? '0',
    ],
    6,
  )
  const deductions = sumDecimalStrings(
    [input.fixedAssets, input.intangibleAssets, input.deductions ?? '0'],
    6,
  )
  const net = sumDecimalStrings([sourcesOfFunds, negateDecimal(deductions)], 6)
  // A base below zero is zero: an entity with more excluded assets than sources of
  // funds owes nothing, and reporting a negative base would invite a negative
  // assessment that the regulations do not provide for.
  const zakatBase = net.startsWith('-') ? roundDecimalHalfUp('0', 2) : roundDecimalHalfUp(net, 2)
  return {
    sourcesOfFunds: roundDecimalHalfUp(sourcesOfFunds, 2),
    deductions: roundDecimalHalfUp(deductions, 2),
    zakatBase,
    rate,
    zakatDue: roundDecimalHalfUp(Number(zakatBase) * rate, 2),
    filingFrequency: 'annual',
  }
}
