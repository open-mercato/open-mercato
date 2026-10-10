/**
 * Withholding tax on payments to non-residents.
 *
 * Two things ship here, and nothing else:
 *
 * - the **catalogue** — the categories ZATCA publishes, with their rates and the
 *   account the deducted amount is held in;
 * - the **arithmetic** — gross, the withheld amount and what is actually payable,
 *   each rounded to halalas, with the withheld amount posted to the withholding
 *   payable account so it is a liability until it is remitted rather than a
 *   discount on the expense.
 *
 * Wiring it into the payment path belongs to accounts payable (Phase 2); a
 * payment command that deducts tax before that phase exists would be a rule with
 * nothing holding it.
 */
import type { TaxReturnLine } from '@/modules/financial/lib/contracts'
import { roundDecimalHalfUp, subtractDecimalStrings, sumDecimalStrings } from '@/modules/financial/lib/money'
import { formatSaudDecimal } from './vat'
import {
  SAUDI_WITHHOLDING_CATEGORIES,
  findSaudiWithholdingCategory,
  type SaudiWithholdingCategory,
} from './tax-codes'

const WORKING_SCALE = 6

export type SaudiWithholdingComputation = {
  categoryCode: string
  label: string
  rate: number
  /** All three in the jurisdiction's two-decimal machine form. */
  gross: string
  withholding: string
  netPayable: string
  payableAccountCode: string
}

/**
 * Withholding on one payment. An unknown category is refused rather than treated
 * as 0%: silently withholding nothing on a payment that owes tax makes the
 * liability the tenant's, and the failure surfaces a year later at assessment.
 */
export function computeSaudiWithholding(input: {
  gross: string | number
  categoryCode: string
}): SaudiWithholdingComputation {
  const category = findSaudiWithholdingCategory(input.categoryCode)
  if (!category) {
    throw new Error(`[internal] Unknown Saudi withholding category: ${input.categoryCode}`)
  }
  const gross = roundDecimalHalfUp(input.gross, 2)
  const withholding = formatSaudDecimal(Number(gross) * category.rate)
  return {
    categoryCode: category.code,
    label: category.label,
    rate: category.rate,
    gross,
    withholding,
    netPayable: roundDecimalHalfUp(subtractDecimalStrings(gross, withholding, WORKING_SCALE), 2),
    payableAccountCode: category.payableAccountCode,
  }
}

export type SaudiWithholdingSummaryRow = {
  categoryCode: string
  label: string
  rate: number
  /** Amount held for this category over the period. */
  amount: string
  lineCount: number
}

export type SaudiWithholdingSummary = {
  currencyCode: string
  total: string
  rows: readonly SaudiWithholdingSummaryRow[]
}

/**
 * What the ledger holds for withholding over a period, grouped by category.
 *
 * Read from the same posted-line shape the VAT return consumes, so a summary can
 * never disagree with the account it summarises: only lines posted to a
 * withholding category's payable account count, which is the account the payment
 * path credits.
 */
export function buildSaudiWithholdingSummary(
  lines: readonly TaxReturnLine[],
  currencyCode: string,
): SaudiWithholdingSummary {
  const byCategory = new Map<string, { amounts: string[]; lineCount: number }>()
  for (const line of lines) {
    const category = findSaudiWithholdingCategory(line.taxCode)
    if (!category) continue
    if (line.accountCode !== category.payableAccountCode) continue
    // A payable is credited when tax is withheld, so the credit is the amount held.
    const amount = subtractDecimalStrings(line.credit, line.debit, WORKING_SCALE)
    const bucket = byCategory.get(category.code) ?? { amounts: [], lineCount: 0 }
    bucket.amounts.push(amount)
    bucket.lineCount += 1
    byCategory.set(category.code, bucket)
  }

  const rows = SAUDI_WITHHOLDING_CATEGORIES.filter((category) => byCategory.has(category.code)).map(
    (category): SaudiWithholdingSummaryRow => {
      const bucket = byCategory.get(category.code)!
      return {
        categoryCode: category.code,
        label: category.label,
        rate: category.rate,
        amount: roundDecimalHalfUp(sumDecimalStrings(bucket.amounts, WORKING_SCALE), 2),
        lineCount: bucket.lineCount,
      }
    },
  )

  return {
    currencyCode,
    total: roundDecimalHalfUp(sumDecimalStrings(rows.map((row) => row.amount), WORKING_SCALE), 2),
    rows,
  }
}

export type { SaudiWithholdingCategory }
