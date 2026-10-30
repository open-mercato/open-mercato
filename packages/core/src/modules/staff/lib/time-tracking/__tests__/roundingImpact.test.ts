/** @jest-environment node */
import { projectRoundingImpact, EMPTY_ROUNDING_IMPACT } from '../roundingImpact'
import { roundMinutes } from '../rounding'

describe('projectRoundingImpact', () => {
  it('sums raw and rounded minutes across duration buckets', () => {
    const impact = projectRoundingImpact(
      [
        { durationMinutes: 62, entryCount: 3 },
        { durationMinutes: 120, entryCount: 2 },
      ],
      { unitMinutes: 15, direction: 'up' },
    )

    expect(impact.entryCount).toBe(5)
    expect(impact.rawMinutes).toBe(62 * 3 + 120 * 2)
    expect(impact.roundedMinutes).toBe(75 * 3 + 120 * 2)
    expect(impact.deltaMinutes).toBe(impact.roundedMinutes - impact.rawMinutes)
  })

  it('is identical to rounding every entry individually (D-7)', () => {
    const entries = [7, 7, 7, 22, 22, 61, 90, 90, 90, 90]
    const settings = { unitMinutes: 15, direction: 'up' } as const
    const perEntry = entries.reduce((total, minutes) => total + roundMinutes(minutes, settings), 0)

    const buckets = [...new Set(entries)].map((durationMinutes) => ({
      durationMinutes,
      entryCount: entries.filter((minutes) => minutes === durationMinutes).length,
    }))

    expect(projectRoundingImpact(buckets, settings).roundedMinutes).toBe(perEntry)
  })

  it('differs from rounding the sum, which is the rule D-7 chose against', () => {
    const buckets = [{ durationMinutes: 7, entryCount: 4 }]
    const settings = { unitMinutes: 15, direction: 'up' } as const

    // Four 7-minute entries: 4 × 15 = 60 rounded per entry, versus 28 → 30 if the
    // sum were rounded instead. The preview must show the former.
    expect(projectRoundingImpact(buckets, settings).roundedMinutes).toBe(60)
    expect(roundMinutes(28, settings)).toBe(30)
  })

  it('reports a zero delta when rounding is off', () => {
    const impact = projectRoundingImpact(
      [{ durationMinutes: 62, entryCount: 10 }],
      { unitMinutes: 0, direction: 'up' },
    )

    expect(impact.roundedMinutes).toBe(impact.rawMinutes)
    expect(impact.deltaMinutes).toBe(0)
  })

  it('can report a negative delta under nearest rounding', () => {
    const impact = projectRoundingImpact(
      [{ durationMinutes: 62, entryCount: 1 }],
      { unitMinutes: 15, direction: 'nearest' },
    )

    expect(impact.roundedMinutes).toBe(60)
    expect(impact.deltaMinutes).toBe(-2)
  })

  it('ignores buckets that carry no entries and survives unparseable counts', () => {
    const impact = projectRoundingImpact(
      [
        { durationMinutes: 62, entryCount: 0 },
        { durationMinutes: 30, entryCount: Number.NaN },
        { durationMinutes: Number.NaN, entryCount: 2 },
      ],
      { unitMinutes: 15, direction: 'up' },
    )

    expect(impact.entryCount).toBe(2)
    expect(impact.rawMinutes).toBe(0)
  })

  it('projects an empty window as all zeroes', () => {
    expect(projectRoundingImpact([], { unitMinutes: 15, direction: 'up' })).toEqual(EMPTY_ROUNDING_IMPACT)
  })

  it('accepts database bigint counts arriving as strings', () => {
    const impact = projectRoundingImpact(
      [{ durationMinutes: 60, entryCount: '4' as unknown as number }],
      { unitMinutes: 0, direction: 'up' },
    )

    expect(impact.entryCount).toBe(4)
    expect(impact.rawMinutes).toBe(240)
  })
})
