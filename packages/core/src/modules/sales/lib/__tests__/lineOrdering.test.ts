import { resequenceLinesForUpsert } from '../lineOrdering'

type TestLine = { id: string; lineNumber: number }

const orderOf = (lines: Array<{ id: string; lineNumber?: number | null }>) =>
  lines.map((line) => `${line.id}=${line.lineNumber}`).join(',')

const lines = (...entries: Array<[string, number]>): TestLine[] =>
  entries.map(([id, lineNumber]) => ({ id, lineNumber }))

describe('resequenceLinesForUpsert', () => {
  it('moves a line onto a position another line already holds', () => {
    const result = resequenceLinesForUpsert(lines(['a', 1], ['c', 2], ['b', 3], ['d', 4]), 'b', 2)
    expect(orderOf(result)).toBe('a=1,b=2,c=3,d=4')
  })

  it('moves a line later by as many positions as the target says', () => {
    const result = resequenceLinesForUpsert(lines(['a', 1], ['b', 2], ['c', 3], ['d', 4]), 'b', 4)
    expect(orderOf(result)).toBe('a=1,c=2,d=3,b=4')
  })

  it('moves a line earlier by as many positions as the target says', () => {
    const result = resequenceLinesForUpsert(lines(['a', 1], ['b', 2], ['c', 3], ['d', 4]), 'd', 2)
    expect(orderOf(result)).toBe('a=1,d=2,b=3,c=4')
  })

  it('leaves the order alone when the target is the position the line already holds', () => {
    const result = resequenceLinesForUpsert(lines(['a', 1], ['b', 2], ['c', 3], ['d', 4]), 'c', 3)
    expect(orderOf(result)).toBe('a=1,b=2,c=3,d=4')
  })

  it('clamps a target below the first position to the first position', () => {
    const result = resequenceLinesForUpsert(lines(['a', 1], ['b', 2], ['c', 3]), 'c', 0)
    expect(orderOf(result)).toBe('c=1,a=2,b=3')
  })

  it('clamps a target past the last position to the last position', () => {
    const result = resequenceLinesForUpsert(lines(['a', 1], ['b', 2], ['c', 3]), 'a', 8)
    expect(orderOf(result)).toBe('b=1,c=2,a=3')
  })

  it('inserts a line absent from the stored set at the target position', () => {
    const stored = lines(['a', 1], ['b', 2], ['c', 3])
    const result = resequenceLinesForUpsert([...stored, { id: 'new', lineNumber: 4 }], 'new', 2)
    expect(orderOf(result)).toBe('a=1,new=2,b=3,c=4')
  })

  it('keeps the stored order when no target is supplied', () => {
    const result = resequenceLinesForUpsert(lines(['a', 1], ['c', 2], ['b', 3]), 'b', null)
    expect(orderOf(result)).toBe('a=1,c=2,b=3')
  })

  it('closes gaps left by stored numbers when no target is supplied', () => {
    const result = resequenceLinesForUpsert(lines(['a', 2], ['b', 7], ['c', 9]), 'b', null)
    expect(orderOf(result)).toBe('a=1,b=2,c=3')
  })

  it('ignores a target naming a line the set does not contain', () => {
    const result = resequenceLinesForUpsert(lines(['a', 1], ['b', 2]), 'missing', 1)
    expect(orderOf(result)).toBe('a=1,b=2')
  })

  it('leaves the caller’s array untouched', () => {
    const stored = lines(['a', 1], ['b', 2], ['c', 3])
    resequenceLinesForUpsert(stored, 'c', 1)
    expect(orderOf(stored)).toBe('a=1,b=2,c=3')
  })

  it('converges in a single pass over every line of a reordered document', () => {
    const target = ['a', 'b', 'c', 'd']
    let current: TestLine[] = lines(['a', 1], ['c', 2], ['b', 3], ['d', 4])
    target.forEach((id, index) => {
      current = resequenceLinesForUpsert(current, id, index + 1)
    })
    expect(orderOf(current)).toBe('a=1,b=2,c=3,d=4')
  })
})
