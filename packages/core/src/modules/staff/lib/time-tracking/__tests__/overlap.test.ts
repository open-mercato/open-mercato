import { findOverlaps } from '../overlap'
import type { OverlapSpan } from '../overlap'

const day = '2026-08-12'
const nextDay = '2026-08-13'

function span(id: string, date: string, start: string, end: string): OverlapSpan {
  return { id, date, start, end }
}

describe('findOverlaps', () => {
  it('does not treat touching edges as an overlap', () => {
    const candidate = span('new', day, '09:00', '10:00')
    const existing = [span('a', day, '10:00', '11:00'), span('b', day, '08:00', '09:00')]
    expect(findOverlaps(candidate, existing)).toEqual([])
  })

  it('detects a candidate fully contained in an existing entry', () => {
    const candidate = span('new', day, '10:00', '10:30')
    const overlaps = findOverlaps(candidate, [span('a', day, '09:00', '12:00')])
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0].id).toBe('a')
    expect(overlaps[0].overlapMinutes).toBe(30)
  })

  it('detects an existing entry fully contained in the candidate', () => {
    const overlaps = findOverlaps(span('new', day, '09:00', '12:00'), [span('a', day, '10:00', '10:30')])
    expect(overlaps.map((item) => item.overlapMinutes)).toEqual([30])
  })

  it('detects a partial overlap on either side', () => {
    const candidate = span('new', day, '09:00', '10:00')
    const overlaps = findOverlaps(candidate, [
      span('early', day, '08:30', '09:15'),
      span('late', day, '09:45', '11:00'),
    ])
    expect(overlaps.map((item) => [item.id, item.overlapMinutes])).toEqual([
      ['early', 15],
      ['late', 15],
    ])
  })

  it('skips the excluded id so editing an entry does not overlap itself', () => {
    const existing = [span('self', day, '09:00', '10:00'), span('other', day, '09:30', '10:30')]
    const candidate = span('self', day, '09:00', '10:00')
    expect(findOverlaps(candidate, existing, { excludeId: 'self' }).map((item) => item.id)).toEqual([
      'other',
    ])
  })

  it('ignores entries on other days', () => {
    expect(findOverlaps(span('new', day, '09:00', '10:00'), [span('a', nextDay, '09:00', '10:00')])).toEqual(
      [],
    )
  })

  it('detects a midnight-crossing candidate against an entry on the following day', () => {
    const candidate = span('new', day, '23:00', '01:00')
    const overlaps = findOverlaps(candidate, [span('a', nextDay, '00:30', '02:00')])
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0].overlapMinutes).toBe(30)
  })

  it('detects an existing midnight-crossing entry against a candidate on the following day', () => {
    const candidate = span('new', nextDay, '00:00', '01:00')
    const overlaps = findOverlaps(candidate, [span('a', day, '22:00', '00:30')])
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0].overlapMinutes).toBe(30)
  })

  it('does not flag a midnight-crossing entry that ends exactly when the next one starts', () => {
    const candidate = span('new', nextDay, '01:00', '02:00')
    expect(findOverlaps(candidate, [span('a', day, '23:00', '01:00')])).toEqual([])
  })

  it('resolves spans given as start plus duration', () => {
    const candidate: OverlapSpan = { id: 'new', date: day, start: '09:00', durationMinutes: 90 }
    const overlaps = findOverlaps(candidate, [
      { id: 'a', date: day, start: '10:00', durationMinutes: 60 },
    ])
    expect(overlaps[0].overlapMinutes).toBe(30)
  })

  it('ignores spans it cannot resolve', () => {
    expect(findOverlaps({ id: 'new', date: day, start: '09:00' }, [span('a', day, '09:00', '10:00')])).toEqual(
      [],
    )
    expect(
      findOverlaps(span('new', day, '09:00', '10:00'), [
        { id: 'a', date: day, start: 'nonsense', end: '10:00' },
        { id: 'b', date: 'not-a-date', start: '09:00', end: '10:00' },
        { id: 'c', date: day, start: '09:30', end: '09:30' },
      ]),
    ).toEqual([])
  })

  it('returns an empty list when there is nothing to compare against', () => {
    expect(findOverlaps(span('new', day, '09:00', '10:00'), [])).toEqual([])
  })
})
