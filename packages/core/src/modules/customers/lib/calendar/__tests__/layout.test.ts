import {
  collapseDenseClusters,
  DEFAULT_MAX_PACKED_COLUMNS,
  packOverlaps,
  packedColumnGeometry,
  resolveMaxPackedColumns,
  type PackedCalendarItem,
} from '../layout'
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

describe('packOverlaps cluster index', () => {
  it('numbers clusters in chronological order and shares the index inside a cluster', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'a-1', start: at(9), end: at(10) }),
      makeCalendarItem({ id: 'a-2', start: at(9, 30), end: at(10, 30) }),
      makeCalendarItem({ id: 'b-1', start: at(13), end: at(14) }),
    ])
    const byId = packedById(packed)
    expect(byId.get('a-1')?.cluster).toBe(0)
    expect(byId.get('a-2')?.cluster).toBe(0)
    expect(byId.get('b-1')?.cluster).toBe(1)
  })
})

describe('resolveMaxPackedColumns', () => {
  it('falls back to the default when the width is unknown or unusable', () => {
    expect(resolveMaxPackedColumns(null)).toBe(DEFAULT_MAX_PACKED_COLUMNS)
    expect(resolveMaxPackedColumns(0)).toBe(DEFAULT_MAX_PACKED_COLUMNS)
    expect(resolveMaxPackedColumns(Number.NaN)).toBe(DEFAULT_MAX_PACKED_COLUMNS)
  })

  it('never drops below two slots on very narrow columns', () => {
    expect(resolveMaxPackedColumns(30)).toBe(2)
    expect(resolveMaxPackedColumns(112)).toBe(2)
  })

  it('grows with the usable width', () => {
    expect(resolveMaxPackedColumns(154)).toBe(2)
    expect(resolveMaxPackedColumns(200)).toBe(3)
    expect(resolveMaxPackedColumns(400)).toBe(6)
  })
})

describe('collapseDenseClusters', () => {
  function sixAtTen() {
    return packOverlaps(
      ['one', 'two', 'three', 'four', 'five', 'six'].map((id) =>
        makeCalendarItem({ id, start: at(10), end: at(11) }),
      ),
    )
  }

  it('leaves clusters that fit untouched', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'first', start: at(9), end: at(10, 30) }),
      makeCalendarItem({ id: 'second', start: at(10), end: at(11) }),
    ])
    const { visible, overflow } = collapseDenseClusters(packed, 2)
    expect(visible).toEqual(packed)
    expect(overflow).toEqual([])
  })

  it('keeps the first columns and collapses the rest of a dense cluster into one overflow slot', () => {
    const { visible, overflow } = collapseDenseClusters(sixAtTen(), 3)
    expect(visible.map((entry) => entry.item.id)).toEqual(['one', 'two'])
    expect(visible.every((entry) => entry.columns === 3)).toBe(true)
    expect(overflow).toHaveLength(1)
    expect(overflow[0]).toMatchObject({ cluster: 0, column: 2, columns: 3 })
    expect(overflow[0].items.map((item) => item.id)).toEqual(['three', 'four', 'five', 'six'])
    expect(overflow[0].start).toEqual(at(10))
    expect(overflow[0].end).toEqual(at(11))
  })

  it('floors the limit at two columns so a dense cluster keeps one event beside the overflow', () => {
    const { visible, overflow } = collapseDenseClusters(sixAtTen(), 1)
    expect(visible.map((entry) => entry.item.id)).toEqual(['one'])
    expect(visible[0]).toMatchObject({ column: 0, columns: 2 })
    expect(overflow).toHaveLength(1)
    expect(overflow[0]).toMatchObject({ column: 1, columns: 2 })
    expect(overflow[0].items).toHaveLength(5)
  })

  it('never collapses a pair, even when the requested limit is one', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'first', start: at(9), end: at(10, 30) }),
      makeCalendarItem({ id: 'second', start: at(10), end: at(11) }),
    ])
    const { visible, overflow } = collapseDenseClusters(packed, 1)
    expect(visible).toEqual(packed)
    expect(overflow).toEqual([])
  })

  it('spans the overflow slot over the hidden events only for chained intervals', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'long', start: at(9), end: at(13) }),
      makeCalendarItem({ id: 'mid', start: at(9, 30), end: at(10, 30) }),
      makeCalendarItem({ id: 'late', start: at(10), end: at(11) }),
      makeCalendarItem({ id: 'later', start: at(10, 15), end: at(12) }),
      makeCalendarItem({ id: 'tail', start: at(11, 30), end: at(12, 30) }),
    ])
    const { visible, overflow } = collapseDenseClusters(packed, 3)
    expect(visible.map((entry) => entry.item.id)).toEqual(['long', 'mid', 'tail'])
    expect(overflow).toHaveLength(1)
    expect(overflow[0].items.map((item) => item.id)).toEqual(['late', 'later'])
    expect(overflow[0].start).toEqual(at(10))
    expect(overflow[0].end).toEqual(at(12))
  })

  it('collapses dense clusters independently of each other', () => {
    const packed = packOverlaps([
      ...['a1', 'a2', 'a3', 'a4'].map((id) => makeCalendarItem({ id, start: at(9), end: at(10) })),
      makeCalendarItem({ id: 'solo', start: at(12), end: at(13) }),
      ...['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => makeCalendarItem({ id, start: at(15), end: at(16) })),
    ])
    const { visible, overflow } = collapseDenseClusters(packed, 3)
    expect(visible.map((entry) => entry.item.id)).toEqual(['a1', 'a2', 'solo', 'b1', 'b2'])
    expect(overflow.map((entry) => entry.items.map((item) => item.id))).toEqual([
      ['a3', 'a4'],
      ['b3', 'b4', 'b5'],
    ])
    expect(overflow[0].cluster).not.toBe(overflow[1].cluster)
  })

  it('keeps a hidden meeting hours later at its own time instead of pulling it into an earlier overflow slot', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'training', start: at(9), end: at(17) }),
      makeCalendarItem({ id: 'client-a', start: at(10), end: at(10, 45) }),
      makeCalendarItem({ id: 'client-b', start: at(10), end: at(10, 45) }),
      makeCalendarItem({ id: 'client-c', start: at(15), end: at(16) }),
    ])
    const { visible, overflow } = collapseDenseClusters(packed, 2)
    expect(visible.map((entry) => entry.item.id)).toEqual(['training', 'client-c'])
    expect(visible.find((entry) => entry.item.id === 'client-c')).toMatchObject({ column: 1, columns: 2 })
    expect(overflow).toHaveLength(1)
    expect(overflow[0].items.map((item) => item.id)).toEqual(['client-a', 'client-b'])
    expect(overflow[0].start).toEqual(at(10))
    expect(overflow[0].end).toEqual(at(10, 45))
  })

  it('gives each separate burst of hidden meetings its own overflow slot and time range', () => {
    const packed = packOverlaps([
      makeCalendarItem({ id: 'booth', start: at(12), end: at(18) }),
      makeCalendarItem({ id: 'intro-1', start: at(12), end: at(12, 30) }),
      makeCalendarItem({ id: 'intro-2', start: at(12), end: at(12, 30) }),
      makeCalendarItem({ id: 'intro-3', start: at(12, 15), end: at(12, 45) }),
      makeCalendarItem({ id: 'follow-1', start: at(17), end: at(17, 30) }),
      makeCalendarItem({ id: 'follow-2', start: at(17), end: at(17, 30) }),
      makeCalendarItem({ id: 'follow-3', start: at(17), end: at(17, 30) }),
    ])
    const { visible, overflow } = collapseDenseClusters(packed, 2)
    expect(visible.map((entry) => entry.item.id)).toEqual(['booth'])
    expect(overflow.map((entry) => entry.items.map((item) => item.id))).toEqual([
      ['intro-1', 'intro-2', 'intro-3'],
      ['follow-1', 'follow-2', 'follow-3'],
    ])
    expect(overflow.map((entry) => [entry.start, entry.end])).toEqual([
      [at(12), at(12, 45)],
      [at(17), at(17, 30)],
    ])
    expect(overflow[0].group).not.toBe(overflow[1].group)
    expect(overflow.every((entry) => entry.cluster === overflow[0].cluster)).toBe(true)
  })

  it('never produces an overflow slot holding a single event', () => {
    const packed = packOverlaps(['x', 'y', 'z', 'w'].map((id) => makeCalendarItem({ id, start: at(9), end: at(10) })))
    const { overflow } = collapseDenseClusters(packed, 3)
    expect(overflow[0].items).toHaveLength(2)
  })
})

describe('collapseDenseClusters with entries built without a cluster index', () => {
  function legacyBurst(prefix: string, hour: number): PackedCalendarItem[] {
    return ['a', 'b', 'c', 'd'].map((suffix, column) => ({
      item: makeCalendarItem({ id: `${prefix}-${suffix}`, start: at(hour), end: at(hour + 1) }),
      column,
      columns: 4,
    }))
  }

  it('accepts the original three-field shape and leaves fitting entries untouched', () => {
    const packed: PackedCalendarItem[] = [
      { item: makeCalendarItem({ id: 'solo', start: at(9), end: at(10) }), column: 0, columns: 1 },
    ]
    const { visible, overflow } = collapseDenseClusters(packed, 3)
    expect(visible).toEqual(packed)
    expect(overflow).toEqual([])
  })

  it('folds a dense burst into one overflow slot', () => {
    const { visible, overflow } = collapseDenseClusters(legacyBurst('morning', 10), 3)
    expect(visible.map((entry) => entry.item.id)).toEqual(['morning-a', 'morning-b'])
    expect(overflow).toHaveLength(1)
    expect(overflow[0].items.map((item) => item.id)).toEqual(['morning-c', 'morning-d'])
  })

  it('keeps bursts hours apart in separate overflow slots with distinct keys', () => {
    const { overflow } = collapseDenseClusters([...legacyBurst('morning', 10), ...legacyBurst('evening', 17)], 3)
    expect(overflow.map((entry) => [entry.start, entry.end])).toEqual([
      [at(10), at(11)],
      [at(17), at(18)],
    ])
    expect(new Set(overflow.map((entry) => `${entry.cluster}-${entry.group}`)).size).toBe(2)
  })
})

describe('packedColumnGeometry', () => {
  it('keeps a single column at the full width', () => {
    expect(packedColumnGeometry(0, 1)).toEqual({ insetInlineStart: 'calc(0% + 0px)', width: 'calc(100% - 0px)' })
  })

  it('shares the gap so the last column ends at the container edge', () => {
    expect(packedColumnGeometry(0, 2)).toEqual({ insetInlineStart: 'calc(0% + 0px)', width: 'calc(50% - 1px)' })
    expect(packedColumnGeometry(1, 2)).toEqual({ insetInlineStart: 'calc(50% + 1px)', width: 'calc(50% - 1px)' })
  })
})
