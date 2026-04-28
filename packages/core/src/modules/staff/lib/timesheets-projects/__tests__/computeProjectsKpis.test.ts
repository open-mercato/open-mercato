import { __testDeltaPct, __testMinutesToHours } from '../computeProjectsKpis'

describe('deltaPct', () => {
  it('returns null when previous is zero', () => {
    expect(__testDeltaPct(50, 0)).toBeNull()
  })

  it('returns null when previous is negative (no division)', () => {
    expect(__testDeltaPct(50, -5)).toBeNull()
  })

  it('returns positive percentage for growth', () => {
    expect(__testDeltaPct(120, 100)).toBe(20)
  })

  it('returns negative percentage for shrinkage', () => {
    expect(__testDeltaPct(80, 100)).toBe(-20)
  })

  it('rounds to 1 decimal', () => {
    expect(__testDeltaPct(113, 100)).toBe(13)
    expect(__testDeltaPct(113.5, 100)).toBe(13.5)
  })

  it('returns 0 for equal values', () => {
    expect(__testDeltaPct(100, 100)).toBe(0)
  })
})

describe('minutesToHours', () => {
  it('converts minutes to hours with 1 decimal', () => {
    expect(__testMinutesToHours(60)).toBe(1)
    expect(__testMinutesToHours(90)).toBe(1.5)
    expect(__testMinutesToHours(105)).toBe(1.8)
  })

  it('returns 0 for zero minutes', () => {
    expect(__testMinutesToHours(0)).toBe(0)
  })

  it('handles large values', () => {
    expect(__testMinutesToHours(600)).toBe(10)
    expect(__testMinutesToHours(1260)).toBe(21)
  })
})
