import {
  MAX_STATUS_POSITION,
  STATUS_POSITION_GAP,
  compactStatusPositions,
  nextStatusPosition,
  planStatusReorder,
} from '../statusPositions'

describe('nextStatusPosition', () => {
  it('starts a board at one full gap', () => {
    expect(nextStatusPosition([])).toBe(STATUS_POSITION_GAP)
  })

  it('appends one gap past the right-most column', () => {
    expect(nextStatusPosition([1000, 2000, 3000])).toBe(4000)
  })

  it('ignores unordered and non-finite input', () => {
    expect(nextStatusPosition([3000, 1000, Number.NaN, 2000])).toBe(4000)
  })

  it('falls back to the tightest step once the ceiling is in reach', () => {
    expect(nextStatusPosition([MAX_STATUS_POSITION - 1])).toBe(MAX_STATUS_POSITION)
    expect(nextStatusPosition([MAX_STATUS_POSITION])).toBe(MAX_STATUS_POSITION)
  })
})

describe('compactStatusPositions', () => {
  it('re-spaces an ordered id list back onto the gap grid', () => {
    expect(compactStatusPositions(['a', 'b', 'c'])).toEqual([
      { id: 'a', position: 1000 },
      { id: 'b', position: 2000 },
      { id: 'c', position: 3000 },
    ])
  })

  it('returns nothing for an empty board', () => {
    expect(compactStatusPositions([])).toEqual([])
  })
})

describe('planStatusReorder', () => {
  const board = [
    { id: 'backlog', position: 1000 },
    { id: 'progress', position: 2000 },
    { id: 'review', position: 3000 },
    { id: 'done', position: 4000 },
  ]

  it('writes a single row for a midpoint drop', () => {
    const plan = planStatusReorder(board, [{ id: 'done', position: 1500 }])
    expect(plan.compacted).toBe(false)
    expect(plan.unknownIds).toEqual([])
    expect(plan.updates).toEqual([{ id: 'done', position: 1500 }])
  })

  it('leaves untouched columns alone when the request restates their position', () => {
    const plan = planStatusReorder(board, [
      { id: 'backlog', position: 1000 },
      { id: 'progress', position: 2000 },
      { id: 'review', position: 3000 },
      { id: 'done', position: 4000 },
    ])
    expect(plan.updates).toEqual([])
    expect(plan.compacted).toBe(false)
  })

  it('returns only the rows whose stored position actually changes', () => {
    const plan = planStatusReorder(board, [
      { id: 'backlog', position: 1000 },
      { id: 'progress', position: 2500 },
      { id: 'review', position: 3000 },
      { id: 'done', position: 4000 },
    ])
    expect(plan.updates).toEqual([{ id: 'progress', position: 2500 }])
  })

  it('drops a column dragged onto a settled key ahead of that column', () => {
    const plan = planStatusReorder(board, [{ id: 'done', position: 2000 }])
    expect(plan.compacted).toBe(true)
    expect(plan.updates).toEqual([
      { id: 'done', position: 2000 },
      { id: 'progress', position: 3000 },
      { id: 'review', position: 4000 },
    ])
  })

  it('compacts the whole board when no integer fits between neighbours', () => {
    const tight = [
      { id: 'a', position: 1000 },
      { id: 'b', position: 1001 },
      { id: 'c', position: 1002 },
    ]
    const plan = planStatusReorder(tight, [{ id: 'c', position: 1000 }])
    expect(plan.compacted).toBe(true)
    expect(plan.updates).toEqual([
      { id: 'c', position: 1000 },
      { id: 'a', position: 2000 },
      { id: 'b', position: 3000 },
    ])
  })

  it('compaction still omits rows that land on the position they already hold', () => {
    const tight = [
      { id: 'a', position: 1000 },
      { id: 'b', position: 1001 },
      { id: 'c', position: 3000 },
    ]
    const plan = planStatusReorder(tight, [{ id: 'b', position: 1000 }])
    expect(plan.compacted).toBe(true)
    expect(plan.updates).toEqual([
      { id: 'b', position: 1000 },
      { id: 'a', position: 2000 },
    ])
  })

  it('compacts when a requested position is not a usable integer', () => {
    const plan = planStatusReorder(board, [{ id: 'done', position: 1500.5 }])
    expect(plan.compacted).toBe(true)
    expect(plan.updates[0]).toEqual({ id: 'done', position: 2000 })
  })

  it('reports ids that do not belong to the project instead of moving them', () => {
    const plan = planStatusReorder(board, [
      { id: 'ghost', position: 500 },
      { id: 'ghost', position: 600 },
      { id: 'done', position: 1500 },
    ])
    expect(plan.unknownIds).toEqual(['ghost'])
    expect(plan.updates).toEqual([{ id: 'done', position: 1500 }])
  })

  it('is stable when two settled columns share a position', () => {
    const collided = [
      { id: 'zulu', position: 1000 },
      { id: 'alpha', position: 1000 },
    ]
    const plan = planStatusReorder(collided, [])
    expect(plan.compacted).toBe(true)
    expect(plan.updates).toEqual([{ id: 'zulu', position: 2000 }])
  })
})
