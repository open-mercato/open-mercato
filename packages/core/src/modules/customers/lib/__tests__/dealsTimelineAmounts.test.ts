import {
  addTimelineAmount,
  createTimelineAmountAccumulator,
  mergeTimelineAmounts,
  summarizeTimelineAmounts,
  type DealTimelineAmountRow,
} from '../dealsTimelineAmounts'

function row(overrides: Partial<DealTimelineAmountRow>): DealTimelineAmountRow {
  return { valueAmount: 1000, valueCurrency: 'EUR', probability: 50, status: 'open', ...overrides }
}

function summarize(rows: DealTimelineAmountRow[]) {
  const accumulator = createTimelineAmountAccumulator()
  rows.forEach((entry) => addTimelineAmount(accumulator, entry))
  return summarizeTimelineAmounts(accumulator)
}

describe('dealsTimelineAmounts', () => {
  it('sums open and probability-weighted values per currency', () => {
    expect(summarize([row({ valueAmount: 1000, probability: 50 }), row({ valueAmount: 250.5, probability: 20 })])).toEqual([
      { currency: 'EUR', open: 1250.5, weighted: 550.1, won: 0 },
    ])
  })

  it('counts won deals (all spellings) only in the won total and ignores lost and closed deals', () => {
    expect(
      summarize([
        row({ status: 'win', valueAmount: 300 }),
        row({ status: 'Won', valueAmount: 200 }),
        row({ status: 'lost', valueAmount: 900 }),
        row({ status: 'loose', valueAmount: 900 }),
        row({ status: 'closed', valueAmount: 900 }),
        row({ status: 'in_progress', valueAmount: 100, probability: 10 }),
      ]),
    ).toEqual([{ currency: 'EUR', open: 100, weighted: 10, won: 500 }])
  })

  it('keeps mixed currencies apart, sorted by open total then code', () => {
    expect(
      summarize([
        row({ valueCurrency: 'usd', valueAmount: 10 }),
        row({ valueCurrency: 'PLN', valueAmount: 500 }),
        row({ valueCurrency: 'EUR', valueAmount: 10 }),
      ]).map((entry) => entry.currency),
    ).toEqual(['PLN', 'EUR', 'USD'])
  })

  it('ignores deals without a value, groups a value without currency under an empty code and clamps probability', () => {
    expect(
      summarize([
        row({ valueAmount: null }),
        row({ valueCurrency: null, valueAmount: 40, probability: 150 }),
        row({ valueCurrency: '', valueAmount: 10, probability: null }),
      ]),
    ).toEqual([{ currency: '', open: 50, weighted: 40, won: 0 }])
  })

  it('avoids floating point drift by summing in cents', () => {
    const rows = Array.from({ length: 10 }, () => row({ valueAmount: 0.1, probability: 100 }))
    expect(summarize(rows)).toEqual([{ currency: 'EUR', open: 1, weighted: 1, won: 0 }])
  })

  it('merges accumulators', () => {
    const left = createTimelineAmountAccumulator()
    const right = createTimelineAmountAccumulator()
    addTimelineAmount(left, row({ valueAmount: 100 }))
    addTimelineAmount(right, row({ valueAmount: 50, status: 'win' }))
    addTimelineAmount(right, row({ valueAmount: 20, valueCurrency: 'USD' }))
    mergeTimelineAmounts(left, right)
    expect(summarizeTimelineAmounts(left)).toEqual([
      { currency: 'EUR', open: 100, weighted: 50, won: 50 },
      { currency: 'USD', open: 20, weighted: 10, won: 0 },
    ])
  })
})
