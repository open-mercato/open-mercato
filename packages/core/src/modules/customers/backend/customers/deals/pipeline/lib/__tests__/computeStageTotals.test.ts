import { computeStageTotals } from '../computeStageTotals'

describe('customers deals pipeline - computeStageTotals', () => {
  it('returns an empty array when there are no deals', () => {
    expect(computeStageTotals([], null)).toEqual([])
  })

  it('sums multiple deals in the same currency into a single entry', () => {
    const totals = computeStageTotals(
      [
        { valueAmount: 1000, valueCurrency: 'USD' },
        { valueAmount: 500, valueCurrency: 'USD' },
        { valueAmount: 250.5, valueCurrency: 'USD' },
      ],
      null,
    )
    expect(totals).toEqual([{ currency: 'USD', sum: 1750.5 }])
  })

  it('keeps distinct currencies as separate entries', () => {
    const totals = computeStageTotals(
      [
        { valueAmount: 1000, valueCurrency: 'USD' },
        { valueAmount: 500, valueCurrency: 'EUR' },
        { valueAmount: 200, valueCurrency: 'GBP' },
      ],
      null,
    )
    expect(totals).toHaveLength(3)
    expect(totals.map((t) => t.currency).sort()).toEqual(['EUR', 'GBP', 'USD'])
  })

  it('skips deals with null valueAmount and aggregates the rest', () => {
    const totals = computeStageTotals(
      [
        { valueAmount: 1000, valueCurrency: 'USD' },
        { valueAmount: null, valueCurrency: 'USD' },
        { valueAmount: null, valueCurrency: 'EUR' },
      ],
      null,
    )
    expect(totals).toEqual([{ currency: 'USD', sum: 1000 }])
  })

  it('defaults null valueCurrency to USD', () => {
    const totals = computeStageTotals(
      [
        { valueAmount: 100, valueCurrency: null },
        { valueAmount: 200, valueCurrency: 'USD' },
      ],
      null,
    )
    expect(totals).toEqual([{ currency: 'USD', sum: 300 }])
  })

  it('normalizes lowercase currency codes to uppercase', () => {
    const totals = computeStageTotals(
      [
        { valueAmount: 100, valueCurrency: 'usd' },
        { valueAmount: 200, valueCurrency: 'USD' },
      ],
      null,
    )
    expect(totals).toEqual([{ currency: 'USD', sum: 300 }])
  })

  it('sorts currencies alphabetically when no base currency is provided', () => {
    const totals = computeStageTotals(
      [
        { valueAmount: 100, valueCurrency: 'USD' },
        { valueAmount: 200, valueCurrency: 'EUR' },
        { valueAmount: 300, valueCurrency: 'GBP' },
      ],
      null,
    )
    expect(totals.map((t) => t.currency)).toEqual(['EUR', 'GBP', 'USD'])
  })

  it('promotes the base currency to the first position when present in totals', () => {
    const totals = computeStageTotals(
      [
        { valueAmount: 100, valueCurrency: 'USD' },
        { valueAmount: 200, valueCurrency: 'EUR' },
        { valueAmount: 300, valueCurrency: 'PLN' },
      ],
      'PLN',
    )
    expect(totals.map((t) => t.currency)).toEqual(['PLN', 'EUR', 'USD'])
  })

  it('falls back to alphabetical sort when the base currency has no deals in totals', () => {
    const totals = computeStageTotals(
      [
        { valueAmount: 100, valueCurrency: 'USD' },
        { valueAmount: 200, valueCurrency: 'EUR' },
      ],
      'PLN',
    )
    expect(totals.map((t) => t.currency)).toEqual(['EUR', 'USD'])
  })
})
