import { packOverlaps } from '../layout'
import { makeCalendarItem } from './fixtures'

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 5, 11, hours, minutes, 0)
}

function packedById(packed: ReturnType<typeof packOverlaps>) {
  return new Map(packed.map((entry) => [entry.item.id, entry]))
}

describe('packOverlaps', () => {
  it('returns an empty array for no items', () => {
    expect(packOverlaps([])).toEqual([])
  })

  it('keeps disjoint items in single-column clusters', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'morning', start: at(9), end: at(10) }),
      makeCalendarItem({ id: 'noon', start: at(12), end: at(13) }),
    ])
    const byId = packedById(packed)
    expect(byId.get('morning')).toMatchObject({ column: 0, columns: 1 })
    expect(byId.get('noon')).toMatchObject({ column: 0, columns: 1 })
  })

  it('packs two overlapping items side by side', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'first', start: at(9), end: at(10, 30) }),
      makeCalendarItem({ id: 'second', start: at(10), end: at(11) }),
    ])
    const byId = packedById(packed)
    expect(byId.get('first')).toMatchObject({ column: 0, columns: 2 })
    expect(byId.get('second')).toMatchObject({ column: 1, columns: 2 })
  })

  it('uses three columns for a three-way overlap', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'long', start: at(9), end: at(12) }),
      makeCalendarItem({ id: 'mid', start: at(9, 30), end: at(10, 30) }),
      makeCalendarItem({ id: 'late', start: at(10), end: at(11) }),
    ])
    const byId = packedById(packed)
    expect(byId.get('long')).toMatchObject({ column: 0, columns: 3 })
    expect(byId.get('mid')).toMatchObject({ column: 1, columns: 3 })
    expect(byId.get('late')).toMatchObject({ column: 2, columns: 3 })
  })

  it('reuses a freed column inside a cluster', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'short', start: at(9), end: at(10) }),
      makeCalendarItem({ id: 'long', start: at(9), end: at(11) }),
      makeCalendarItem({ id: 'follow-up', start: at(10), end: at(10, 30) }),
    ])
    const byId = packedById(packed)
    expect(byId.get('long')).toMatchObject({ column: 0, columns: 2 })
    expect(byId.get('short')).toMatchObject({ column: 1, columns: 2 })
    expect(byId.get('follow-up')).toMatchObject({ column: 1, columns: 2 })
  })

  it('starts a new cluster when items only touch', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'first', start: at(9), end: at(10) }),
      makeCalendarItem({ id: 'second', start: at(9), end: at(10) }),
      makeCalendarItem({ id: 'after', start: at(10), end: at(11) }),
    ])
    const byId = packedById(packed)
    expect(byId.get('first')?.columns).toBe(2)
    expect(byId.get('second')?.columns).toBe(2)
    expect(byId.get('after')).toMatchObject({ column: 0, columns: 1 })
  })

  it('keeps clusters separated by gaps independent', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'cluster-a-1', start: at(9), end: at(10) }),
      makeCalendarItem({ id: 'cluster-a-2', start: at(9, 30), end: at(10, 30) }),
      makeCalendarItem({ id: 'solo', start: at(13), end: at(14) }),
      makeCalendarItem({ id: 'cluster-b-1', start: at(15), end: at(16) }),
      makeCalendarItem({ id: 'cluster-b-2', start: at(15), end: at(16) }),
      makeCalendarItem({ id: 'cluster-b-3', start: at(15, 30), end: at(17) }),
    ])
    const byId = packedById(packed)
    expect(byId.get('cluster-a-1')?.columns).toBe(2)
    expect(byId.get('cluster-a-2')?.columns).toBe(2)
    expect(byId.get('solo')).toMatchObject({ column: 0, columns: 1 })
    expect(byId.get('cluster-b-1')?.columns).toBe(3)
    expect(byId.get('cluster-b-2')?.columns).toBe(3)
    expect(byId.get('cluster-b-3')).toMatchObject({ column: 2, columns: 3 })
  })

  it('orders equal starts by longer duration first', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'short', start: at(9), end: at(9, 30) }),
      makeCalendarItem({ id: 'long', start: at(9), end: at(11) }),
    ])
    expect(packed[0].item.id).toBe('long')
    expect(packed[0]).toMatchObject({ column: 0, columns: 2 })
    expect(packed[1].item.id).toBe('short')
    expect(packed[1]).toMatchObject({ column: 1, columns: 2 })
  })
})
