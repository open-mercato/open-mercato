/**
 * The ZATCA VAT return, computed from posted journal lines.
 *
 * It is a **read model**: it posts nothing, stores nothing and files nothing.
 * Filing is a manual action on the ZATCA portal, so what this owes an operator is
 * a set of figures they can tie back to the ledger, plus an honest statement of
 * the cases where the ledger does not tie.
 *
 * The classification rule is the one place a return can silently go wrong, so it
 * is derived from the tax-code catalogue rather than from the amount's sign:
 *
 * - a line posted to the account a code declares as its **sales** side is the tax
 *   collected (output VAT) for that code;
 * - a line on its **purchase** side is tax paid (input VAT);
 * - any other line carrying that code is the **taxable base**, and the account
 *   class says whether it belongs to the sales or the purchase side of the
 *   business.
 *
 * Reading the role off the catalogue is what keeps the ledger and the e-invoice
 * from disagreeing: both ask the same table where a code's tax lives.
 */
import type {
  TaxEngineContract,
  TaxReturn,
  TaxReturnBucket,
  TaxReturnInput,
  TaxReturnLine,
  TaxReportingContract,
} from '@/modules/financial/lib/contracts'
import { roundDecimalHalfUp, subtractDecimalStrings, sumDecimalStrings } from '@/modules/financial/lib/money'
import {
  SAUDI_STANDARD_VAT_CODE,
  SAUDI_DEFAULT_VAT_CATEGORY,
  classifySaudiTaxCode,
  saudiAccountForTaxCode,
} from './tax-codes'
import { SAUDI_COUNTRY_CODE, SAUDI_CURRENCY_CODE } from './number-format'

const WORKING_SCALE = 6
const HALALA_SCALE = 2

function round(value: string): string {
  return roundDecimalHalfUp(value, HALALA_SCALE)
}

/** A line's contribution in the direction that increases its own natural side. */
function naturalAmount(line: TaxReturnLine): string {
  return line.accountClass === 'liability' || line.accountClass === 'equity' || line.accountClass === 'revenue'
    ? subtractDecimalStrings(line.credit, line.debit, WORKING_SCALE)
    : subtractDecimalStrings(line.debit, line.credit, WORKING_SCALE)
}

type LineRole = 'output_vat' | 'input_vat' | 'sales_base' | 'purchase_base' | 'settlement'

/**
 * What a posted line contributes to the return.
 *
 * `settlement` is the role that keeps the arithmetic honest. A sale is posted as
 * a receivable, a revenue line and a VAT line, and all three may carry the tax
 * code — but only the last two are return boxes. Counting the receivable as
 * taxable base would report 2 150.00 of sales on a 1 000.00 invoice. So a line
 * counts as base only when its account is genuinely revenue or expense, and
 * everything else carrying the code is the counterparty settling it.
 */
export function classifySaudiReturnLine(line: TaxReturnLine): LineRole {
  const salesAccount = saudiAccountForTaxCode(line.taxCode, 'sales')
  const purchaseAccount = saudiAccountForTaxCode(line.taxCode, 'purchase')
  if (salesAccount && line.accountCode === salesAccount) return 'output_vat'
  if (purchaseAccount && line.accountCode === purchaseAccount) return 'input_vat'
  if (line.accountClass === 'revenue') return 'sales_base'
  if (line.accountClass === 'expense') return 'purchase_base'
  return 'settlement'
}

export type SaudiVatReturnOptions = {
  tax: TaxEngineContract
}

export function buildSaudiVatReturn(
  input: TaxReturnInput,
  options: SaudiVatReturnOptions,
): TaxReturn {
  const { tax } = options

  const salesBaseByCategory = new Map<string, string[]>()
  const outputVatByCategory = new Map<string, string[]>()
  const outputVatLines: string[] = []
  const inputVatLines: string[] = []
  let countedLines = 0

  for (const line of input.lines) {
    if (!line.taxCode || line.taxCode.trim().length === 0) continue
    countedLines += 1
    const category = classifySaudiTaxCode(line.taxCode)
    const role = classifySaudiReturnLine(line)
    if (role === 'output_vat') {
      const amount = naturalAmount(line)
      outputVatLines.push(amount)
      const bucket = outputVatByCategory.get(category) ?? []
      bucket.push(amount)
      outputVatByCategory.set(category, bucket)
      continue
    }
    if (role === 'input_vat') {
      inputVatLines.push(naturalAmount(line))
      continue
    }
    if (role === 'purchase_base' || role === 'settlement') continue
    const bucket = salesBaseByCategory.get(category) ?? []
    bucket.push(naturalAmount(line))
    salesBaseByCategory.set(category, bucket)
  }

  const bucketTotal = (buckets: Map<string, string[]>, category: string): string =>
    round(sumDecimalStrings(buckets.get(category) ?? [], WORKING_SCALE))

  const outputVat = round(sumDecimalStrings(outputVatLines, WORKING_SCALE))
  const inputVat = round(sumDecimalStrings(inputVatLines, WORKING_SCALE))

  const standardNet = bucketTotal(salesBaseByCategory, 'S')
  // What the catalogue says the standard-rated base *should* have produced. The
  // delta against the posted VAT is the check that a posting is not missing its
  // counterpart — the failure a silent round would hide.
  const impliedOutputVat = tax.compute({ net: standardNet, taxCode: SAUDI_STANDARD_VAT_CODE }).tax

  // The filed figure is what the books say, never what the rate would imply: a
  // return that reports the implied number agrees with itself by construction and
  // hides the very posting the delta exists to expose.
  const standardRated: TaxReturnBucket = {
    net: standardNet,
    tax: bucketTotal(outputVatByCategory, 'S'),
  }

  return {
    countryCode: SAUDI_COUNTRY_CODE,
    currencyCode: SAUDI_CURRENCY_CODE,
    period: {
      fiscalYear: input.period.fiscalYear,
      frequency: input.frequency,
      periodNumber: input.period.periodNumber,
      label: input.period.label,
      startDate: input.period.startDate,
      endDate: input.period.endDate,
    },
    standardRated,
    zeroRated: { net: bucketTotal(salesBaseByCategory, 'Z') },
    exempt: { net: bucketTotal(salesBaseByCategory, 'E') },
    outOfScope: { net: bucketTotal(salesBaseByCategory, SAUDI_DEFAULT_VAT_CATEGORY) },
    outputVat,
    inputVat,
    netPayable: round(subtractDecimalStrings(outputVat, inputVat, WORKING_SCALE)),
    lineCount: countedLines,
    reconciliationDelta: round(subtractDecimalStrings(outputVat, impliedOutputVat, WORKING_SCALE)),
    generatedAt: input.generatedAt,
  }
}

export function buildSaudiTaxReporting(tax: TaxEngineContract): TaxReportingContract {
  return {
    countryCode: SAUDI_COUNTRY_CODE,
    buildReturn: (input) => buildSaudiVatReturn(input, { tax }),
  }
}
