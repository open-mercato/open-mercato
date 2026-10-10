/**
 * The VAT return, over hand-built posted lines.
 *
 * The figures matter less than the classifications: which lines become the
 * taxable base, which become tax, and whether a period whose books do not agree
 * with its return says so.
 */
import type { TaxReturnLine } from '@/modules/financial/lib/contracts'
import { buildSaudiTaxEngine } from '../tax-engine'
import { buildSaudiTaxReporting } from '../vat-return'
import {
  SAUDI_EXEMPT_VAT_CODE,
  SAUDI_INPUT_VAT_ACCOUNT,
  SAUDI_OUTPUT_VAT_ACCOUNT,
  SAUDI_OUT_OF_SCOPE_VAT_CODE,
  SAUDI_STANDARD_VAT_CODE,
  SAUDI_ZERO_RATED_VAT_CODE,
} from '../tax-codes'
import { buildSaudiFiscalCalendar } from '../fiscal-calendar'

const tax = buildSaudiTaxEngine()
const reporting = buildSaudiTaxReporting(tax)
const period = buildSaudiFiscalCalendar().filingPeriodFor('2026-05-20', 'quarterly')

const GENERATED_AT = '2026-07-01T00:00:00.000Z'

function build(lines: TaxReturnLine[]) {
  return reporting.buildReturn({ period, frequency: 'quarterly', lines, generatedAt: GENERATED_AT })
}

/** A domestic sale of 1 000.00 plus the 150.00 VAT a consistent posting carries. */
const consistentSale: TaxReturnLine[] = [
  { taxCode: SAUDI_STANDARD_VAT_CODE, accountCode: '1100', accountClass: 'asset', debit: '1150.00', credit: '0.00' },
  { taxCode: SAUDI_STANDARD_VAT_CODE, accountCode: '4000', accountClass: 'revenue', debit: '0.00', credit: '1000.00' },
  { taxCode: SAUDI_STANDARD_VAT_CODE, accountCode: SAUDI_OUTPUT_VAT_ACCOUNT, accountClass: 'liability', debit: '0.00', credit: '150.00' },
]

describe('Saudi VAT return', () => {
  it('reads a consistent sale into the standard-rated bucket with a zero delta', () => {
    const result = build(consistentSale)

    expect(result.countryCode).toBe('SA')
    expect(result.currencyCode).toBe('SAR')
    expect(result.standardRated).toEqual({ net: '1000.00', tax: '150.00' })
    expect(result.outputVat).toBe('150.00')
    expect(result.inputVat).toBe('0.00')
    expect(result.netPayable).toBe('150.00')
    expect(result.reconciliationDelta).toBe('0.00')
    expect(result.lineCount).toBe(3)
    expect(result.generatedAt).toBe(GENERATED_AT)
    expect(result.period).toMatchObject({ label: '2026-Q2', frequency: 'quarterly', fiscalYear: 2026 })
  })

  it('nets input VAT against output VAT', () => {
    const result = build([
      ...consistentSale,
      { taxCode: SAUDI_STANDARD_VAT_CODE, accountCode: '5300', accountClass: 'expense', debit: '400.00', credit: '0.00' },
      { taxCode: SAUDI_STANDARD_VAT_CODE, accountCode: SAUDI_INPUT_VAT_ACCOUNT, accountClass: 'asset', debit: '60.00', credit: '0.00' },
    ])

    expect(result.standardRated.net).toBe('1000.00')
    expect(result.inputVat).toBe('60.00')
    expect(result.outputVat).toBe('150.00')
    expect(result.netPayable).toBe('90.00')
    expect(result.reconciliationDelta).toBe('0.00')
  })

  it('reports a period in credit as a negative payable', () => {
    const result = build([
      { taxCode: SAUDI_STANDARD_VAT_CODE, accountCode: '5300', accountClass: 'expense', debit: '2000.00', credit: '0.00' },
      { taxCode: SAUDI_STANDARD_VAT_CODE, accountCode: SAUDI_INPUT_VAT_ACCOUNT, accountClass: 'asset', debit: '300.00', credit: '0.00' },
    ])

    expect(result.outputVat).toBe('0.00')
    expect(result.inputVat).toBe('300.00')
    expect(result.netPayable).toBe('-300.00')
  })

  it('separates the zero-rated, exempt and out-of-scope bases', () => {
    const result = build([
      { taxCode: SAUDI_ZERO_RATED_VAT_CODE, accountCode: '4100', accountClass: 'revenue', debit: '0.00', credit: '700.00' },
      { taxCode: SAUDI_EXEMPT_VAT_CODE, accountCode: '4200', accountClass: 'revenue', debit: '0.00', credit: '300.00' },
      { taxCode: SAUDI_OUT_OF_SCOPE_VAT_CODE, accountCode: '4300', accountClass: 'revenue', debit: '0.00', credit: '50.00' },
    ])

    expect(result.zeroRated.net).toBe('700.00')
    expect(result.exempt.net).toBe('300.00')
    expect(result.outOfScope.net).toBe('50.00')
    expect(result.standardRated.net).toBe('0.00')
    expect(result.netPayable).toBe('0.00')
  })

  /** The rule a filing error hides behind: an unexplained untaxed line is `O`. */
  it('reads an untaxed line with no stated exemption as out of scope, never zero-rated', () => {
    const result = build([
      { taxCode: 'SOMETHING-ELSE', accountCode: '4000', accountClass: 'revenue', debit: '0.00', credit: '500.00' },
    ])

    expect(result.outOfScope.net).toBe('500.00')
    expect(result.zeroRated.net).toBe('0.00')
    expect(result.exempt.net).toBe('0.00')
  })

  it('exposes a non-zero delta when a sale was posted without its VAT', () => {
    const result = build([
      { taxCode: SAUDI_STANDARD_VAT_CODE, accountCode: '4000', accountClass: 'revenue', debit: '0.00', credit: '1000.00' },
    ])

    // 1000.00 at 15% is 150.00 that the VAT account never received.
    expect(result.standardRated).toEqual({ net: '1000.00', tax: '0.00' })
    expect(result.reconciliationDelta).toBe('-150.00')
  })

  it('files the posted VAT, never the tax the rate would imply', () => {
    const result = build([
      { taxCode: SAUDI_STANDARD_VAT_CODE, accountCode: '4000', accountClass: 'revenue', debit: '0.00', credit: '1000.00' },
      { taxCode: SAUDI_STANDARD_VAT_CODE, accountCode: SAUDI_OUTPUT_VAT_ACCOUNT, accountClass: 'liability', debit: '0.00', credit: '140.00' },
    ])

    // The filed box is what the books say; the delta is what flags the shortfall.
    expect(result.standardRated.tax).toBe('140.00')
    expect(result.outputVat).toBe('140.00')
    expect(result.reconciliationDelta).toBe('-10.00')
  })

  it('ignores lines with no tax code', () => {
    const result = build([
      ...consistentSale,
      { taxCode: null, accountCode: '1000', accountClass: 'asset', debit: '0.00', credit: '0.00' },
      { taxCode: '   ', accountCode: '1000', accountClass: 'asset', debit: '0.00', credit: '0.00' },
    ])

    expect(result.lineCount).toBe(3)
    expect(result.standardRated.net).toBe('1000.00')
  })

  it('rounds each bucket to halalas rather than carrying float dust', () => {
    const result = build([
      { taxCode: SAUDI_ZERO_RATED_VAT_CODE, accountCode: '4100', accountClass: 'revenue', debit: '0.00', credit: '33.333' },
      { taxCode: SAUDI_ZERO_RATED_VAT_CODE, accountCode: '4100', accountClass: 'revenue', debit: '0.00', credit: '33.333' },
      { taxCode: SAUDI_ZERO_RATED_VAT_CODE, accountCode: '4100', accountClass: 'revenue', debit: '0.00', credit: '33.334' },
    ])

    expect(result.zeroRated.net).toBe('100.00')
  })

  it('returns an empty but well-formed return for a period with no postings', () => {
    const result = build([])

    expect(result.lineCount).toBe(0)
    expect(result.standardRated).toEqual({ net: '0.00', tax: '0.00' })
    expect(result.netPayable).toBe('0.00')
    expect(result.reconciliationDelta).toBe('0.00')
  })
})
