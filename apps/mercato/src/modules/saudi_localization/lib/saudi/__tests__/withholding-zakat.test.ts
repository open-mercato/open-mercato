/**
 * The two "parts of the Saudi market" that are not VAT: withholding on payments
 * to non-residents, and the zakat base. Both are money arithmetic, so both are
 * pinned to halalas.
 */
import type { TaxReturnLine } from '@/modules/financial/lib/contracts'
import { SAUDI_WHT_PAYABLE_ACCOUNT } from '../tax-codes'
import { buildSaudiWithholdingSummary, computeSaudiWithholding } from '../withholding'
import {
  SAUDI_ZAKAT_GREGORIAN_RATE,
  SAUDI_ZAKAT_HIJRI_RATE,
  computeSaudiZakatBase,
} from '../zakat'

describe('Saudi withholding tax', () => {
  it('deducts the category rate and reports what is actually payable', () => {
    expect(computeSaudiWithholding({ gross: '10000.00', categoryCode: 'SA-WHT-SERVICES' })).toEqual({
      categoryCode: 'SA-WHT-SERVICES',
      label: 'Services',
      rate: 0.05,
      gross: '10000.00',
      withholding: '500.00',
      netPayable: '9500.00',
      payableAccountCode: SAUDI_WHT_PAYABLE_ACCOUNT,
    })
  })

  it('applies the royalty rate and rounds on the decimal written', () => {
    const result = computeSaudiWithholding({ gross: '1234.567', categoryCode: 'SA-WHT-ROYALTIES' })
    expect(result.gross).toBe('1234.57')
    // 15% of the rounded gross, not of the unrounded input.
    expect(result.withholding).toBe('185.19')
    expect(result.netPayable).toBe('1049.38')
  })

  it('keeps gross = withholding + payable at halala precision', () => {
    for (const gross of ['0.03', '9.99', '100.05', '33333.33']) {
      const result = computeSaudiWithholding({ gross, categoryCode: 'SA-WHT-MANAGEMENT' })
      const sum = Number(result.withholding) + Number(result.netPayable)
      expect(Number(sum.toFixed(2))).toBe(Number(result.gross))
    }
  })

  it('refuses an unknown category instead of quietly withholding nothing', () => {
    expect(() => computeSaudiWithholding({ gross: '100', categoryCode: 'SA-WHT-NOPE' })).toThrow(
      /Unknown Saudi withholding category/,
    )
  })

  describe('period summary', () => {
    const lines: TaxReturnLine[] = [
      {
        taxCode: 'SA-WHT-SERVICES',
        accountCode: SAUDI_WHT_PAYABLE_ACCOUNT,
        accountClass: 'liability',
        debit: '0.00',
        credit: '500.00',
      },
      {
        taxCode: 'SA-WHT-ROYALTIES',
        accountCode: SAUDI_WHT_PAYABLE_ACCOUNT,
        accountClass: 'liability',
        debit: '0.00',
        credit: '185.19',
      },
      // The expense side of the same payment carries the code too, but it is not
      // where the held amount lives.
      { taxCode: 'SA-WHT-SERVICES', accountCode: '5300', accountClass: 'expense', debit: '10000.00', credit: '0.00' },
    ]

    it('sums what the ledger holds per category and ignores the expense side', () => {
      const summary = buildSaudiWithholdingSummary(lines, 'SAR')

      expect(summary.currencyCode).toBe('SAR')
      expect(summary.total).toBe('685.19')
      expect(summary.rows).toEqual([
        { categoryCode: 'SA-WHT-SERVICES', label: 'Services', rate: 0.05, amount: '500.00', lineCount: 1 },
        { categoryCode: 'SA-WHT-ROYALTIES', label: 'Royalties', rate: 0.15, amount: '185.19', lineCount: 1 },
      ])
    })

    it('omits categories nothing was withheld against', () => {
      const summary = buildSaudiWithholdingSummary([], 'SAR')
      expect(summary.rows).toEqual([])
      expect(summary.total).toBe('0.00')
    })
  })
})

describe('Saudi zakat base', () => {
  const figures = {
    shareCapital: '500000.00',
    statutoryReserves: '100000.00',
    retainedEarnings: '250000.00',
    provisions: '50000.00',
    longTermLiabilities: '120000.00',
    fixedAssets: '300000.00',
    intangibleAssets: '20000.00',
  }

  it('computes sources of funds, deductions and the base at the Gregorian rate', () => {
    const result = computeSaudiZakatBase(figures)

    // 500 000 + 100 000 + 250 000 + 50 000 + 120 000
    expect(result.sourcesOfFunds).toBe('1020000.00')
    expect(result.deductions).toBe('320000.00')
    expect(result.zakatBase).toBe('700000.00')
    expect(result.rate).toBe(SAUDI_ZAKAT_GREGORIAN_RATE)
    expect(result.zakatDue).toBe('17500.00')
    expect(result.filingFrequency).toBe('annual')
  })

  it('applies the Hijri-year rate when asked, without changing the base', () => {
    const gregorian = computeSaudiZakatBase(figures)
    const hijri = computeSaudiZakatBase(figures, { rate: SAUDI_ZAKAT_HIJRI_RATE })

    expect(hijri.zakatBase).toBe(gregorian.zakatBase)
    expect(hijri.rate).toBe(SAUDI_ZAKAT_HIJRI_RATE)
    expect(Number(hijri.zakatDue)).toBeGreaterThan(Number(gregorian.zakatDue))
  })

  it('floors a base below zero rather than reporting a negative assessment', () => {
    const result = computeSaudiZakatBase({
      shareCapital: '1000.00',
      statutoryReserves: '0',
      retainedEarnings: '0',
      provisions: '0',
      longTermLiabilities: '0',
      fixedAssets: '5000.00',
      intangibleAssets: '0',
    })

    expect(result.zakatBase).toBe('0.00')
    expect(result.zakatDue).toBe('0.00')
    expect(result.deductions).toBe('5000.00')
  })

  it('folds caller adjustments into the two sides they belong to', () => {
    const result = computeSaudiZakatBase({ ...figures, additions: '30000.00', deductions: '10000.00' })

    expect(result.sourcesOfFunds).toBe('1050000.00')
    expect(result.deductions).toBe('330000.00')
    expect(result.zakatBase).toBe('720000.00')
  })

  it('rounds the base to halalas before applying the rate', () => {
    const result = computeSaudiZakatBase({
      shareCapital: '100.005',
      statutoryReserves: '0',
      retainedEarnings: '0',
      provisions: '0',
      longTermLiabilities: '0',
      fixedAssets: '0',
      intangibleAssets: '0',
    })

    expect(result.zakatBase).toBe('100.01')
    expect(result.zakatDue).toBe('2.50')
  })
})
