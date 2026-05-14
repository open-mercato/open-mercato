import { deltaPct, minutesToHours } from '../kpiMath'

describe('deltaPct', () => {
  it('returns null when previous is zero', () => {
    expect(deltaPct(50, 0)).toBeNull()
  })

  it('returns null when previous is negative (no division)', () => {
    expect(deltaPct(50, -5)).toBeNull()
  })

  it('returns positive percentage for growth', () => {
    expect(deltaPct(120, 100)).toBe(20)
  })

  it('returns negative percentage for shrinkage', () => {
    expect(deltaPct(80, 100)).toBe(-20)
  })

  it('rounds to 1 decimal', () => {
    expect(deltaPct(113, 100)).toBe(13)
    expect(deltaPct(113.5, 100)).toBe(13.5)
  })

  it('returns 0 for equal values', () => {
    expect(deltaPct(100, 100)).toBe(0)
  })
})

describe('minutesToHours', () => {
  it('converts minutes to hours with 1 decimal', () => {
    expect(minutesToHours(60)).toBe(1)
    expect(minutesToHours(90)).toBe(1.5)
    expect(minutesToHours(105)).toBe(1.8)
  })

  it('returns 0 for zero minutes', () => {
    expect(minutesToHours(0)).toBe(0)
  })

  it('handles large values', () => {
    expect(minutesToHours(600)).toBe(10)
    expect(minutesToHours(1260)).toBe(21)
  })
})
