import {
  applyBound,
  applyPreset,
  defaultReportTitle,
  initialReportPeriod,
  isReportPeriodPreset,
  isValidReportPeriod,
  presetRange,
  spansMultipleMonths,
  type ReportPeriodState,
} from '../reportConfigState'

describe('D-4 — a preset fills an editable range', () => {
  it('starts on the current month with both dates populated', () => {
    const state = initialReportPeriod('2026-06-14')
    expect(state).toEqual({ kind: 'month', from: '2026-06-01', to: '2026-06-30' })
  })

  it('fills both bounds when a preset is applied', () => {
    const state = applyPreset({ kind: 'custom', from: '2026-06-14', to: '2026-06-14' }, 'month')
    expect(state).toEqual({ kind: 'month', from: '2026-06-01', to: '2026-06-30' })
    expect(presetRange('year', '2026-06-14')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('anchors the preset on the range being looked at, not on today', () => {
    // "Month" beside a June range must mean June, whatever the wall clock says.
    const state = applyPreset({ kind: 'custom', from: '2026-02-11', to: '2026-03-04' }, 'month')
    expect(state.from).toBe('2026-02-01')
    expect(state.to).toBe('2026-02-28')
  })

  it('drops the preset to custom the moment either bound is moved', () => {
    const month: ReportPeriodState = { kind: 'month', from: '2026-06-01', to: '2026-06-30' }
    expect(applyBound(month, 'to', '2026-07-19')).toEqual({
      kind: 'custom',
      from: '2026-06-01',
      to: '2026-07-19',
    })
    expect(applyBound(month, 'from', '2026-05-20').kind).toBe('custom')
  })

  it('does not relabel the period when the same value is re-entered', () => {
    const month: ReportPeriodState = { kind: 'month', from: '2026-06-01', to: '2026-06-30' }
    expect(applyBound(month, 'to', '2026-06-30')).toBe(month)
  })

  it('recognises only the three presets', () => {
    expect(isReportPeriodPreset('week')).toBe(true)
    expect(isReportPeriodPreset('custom')).toBe(false)
    expect(isReportPeriodPreset('quarter')).toBe(false)
  })
})

describe('report period validation', () => {
  it('rejects an inverted range and accepts a single day', () => {
    expect(isValidReportPeriod({ kind: 'custom', from: '2026-06-10', to: '2026-06-01' })).toBe(false)
    expect(isValidReportPeriod({ kind: 'custom', from: '2026-06-10', to: '2026-06-10' })).toBe(true)
    expect(isValidReportPeriod({ kind: 'custom', from: '', to: '2026-06-10' })).toBe(false)
  })

  it('notices a range crossing a month boundary — screen 13 calls it out', () => {
    expect(spansMultipleMonths({ kind: 'custom', from: '2026-06-01', to: '2026-07-19' })).toBe(true)
    expect(spansMultipleMonths({ kind: 'month', from: '2026-06-01', to: '2026-06-30' })).toBe(false)
  })
})

describe('defaultReportTitle', () => {
  it('names the customer and the range', () => {
    expect(
      defaultReportTitle('Nordvik Retail AB', { kind: 'custom', from: '2026-06-01', to: '2026-07-19' }, 'Customer'),
    ).toBe('Nordvik Retail AB · 2026-06-01 – 2026-07-19')
  })

  it('falls back rather than producing a title starting with a separator', () => {
    expect(defaultReportTitle(null, { kind: 'month', from: '2026-06-01', to: '2026-06-30' }, 'Customer')).toBe(
      'Customer · 2026-06-01 – 2026-06-30',
    )
    expect(defaultReportTitle('   ', { kind: 'month', from: '2026-06-01', to: '2026-06-30' }, 'Customer')).toBe(
      'Customer · 2026-06-01 – 2026-06-30',
    )
  })
})
