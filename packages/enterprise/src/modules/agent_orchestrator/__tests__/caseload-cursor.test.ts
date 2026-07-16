/**
 * Caseload inbox cursor model (UX remediation spec 4, Phase 1) — pure-logic
 * tests for advance-to-neighbor, cursorId-following reconciliation, and
 * live-refresh selection preservation.
 */
import {
  EMPTY_CURSOR,
  advanceCursorAfterDispose,
  intersectSelection,
  reconcileCursor,
  type CursorRowLike,
  type CursorState,
} from '../backend/caseload/hooks'

function pending(id: string): CursorRowLike {
  return { id, isPending: true }
}
function done(id: string): CursorRowLike {
  return { id, isPending: false }
}
function cursorOn(rows: readonly CursorRowLike[], id: string): CursorState {
  return { cursorId: id, cursorIndex: rows.findIndex((row) => row.id === id) }
}

describe('reconcileCursor', () => {
  it('defaults a null cursor to the first row', () => {
    const rows = [pending('a'), pending('b')]
    expect(reconcileCursor(EMPTY_CURSOR, rows)).toEqual({ cursorId: 'a', cursorIndex: 0 })
  })

  it('follows the cursorId (not the index) when a refresh reorders rows', () => {
    const before = [pending('a'), pending('b'), pending('c')]
    const state = cursorOn(before, 'a')
    const reordered = [pending('b'), pending('a'), pending('c')]
    expect(reconcileCursor(state, reordered)).toEqual({ cursorId: 'a', cursorIndex: 1 })
  })

  it('moves to the nearest index when the cursor row vanished mid-list', () => {
    const before = [pending('a'), pending('b'), pending('c')]
    const state = cursorOn(before, 'b')
    const after = [pending('a'), pending('c')]
    expect(reconcileCursor(state, after)).toEqual({ cursorId: 'c', cursorIndex: 1 })
  })

  it('clamps backwards when the vanished cursor row was last', () => {
    const before = [pending('a'), pending('b'), pending('c')]
    const state = cursorOn(before, 'c')
    const after = [pending('a'), pending('b')]
    expect(reconcileCursor(state, after)).toEqual({ cursorId: 'b', cursorIndex: 1 })
  })

  it('returns the empty cursor when the row set empties', () => {
    const state = cursorOn([pending('a')], 'a')
    expect(reconcileCursor(state, [])).toEqual(EMPTY_CURSOR)
  })

  it('returns the same reference when nothing changed', () => {
    const rows = [pending('a'), pending('b')]
    const state = cursorOn(rows, 'b')
    expect(reconcileCursor(state, rows)).toBe(state)
    expect(reconcileCursor(EMPTY_CURSOR, [])).toBe(EMPTY_CURSOR)
  })
})

describe('advanceCursorAfterDispose', () => {
  it('advances to the neighbor that slides into the disposed slot (mid-list)', () => {
    const rows = [pending('a'), pending('b'), pending('c')]
    const next = advanceCursorAfterDispose(cursorOn(rows, 'b'), rows, ['b'])
    expect(next).toEqual({ cursorId: 'c', cursorIndex: 1 })
  })

  it('moves backwards at the end of the queue', () => {
    const rows = [pending('a'), pending('b'), pending('c')]
    const next = advanceCursorAfterDispose(cursorOn(rows, 'c'), rows, ['c'])
    expect(next).toEqual({ cursorId: 'b', cursorIndex: 1 })
  })

  it('skips every disposed id in a bulk dispose', () => {
    const rows = [pending('a'), pending('b'), pending('c'), pending('d')]
    const next = advanceCursorAfterDispose(cursorOn(rows, 'b'), rows, ['b', 'c'])
    expect(next).toEqual({ cursorId: 'd', cursorIndex: 1 })
  })

  it('yields the empty cursor when the queue empties', () => {
    const rows = [pending('a')]
    expect(advanceCursorAfterDispose(cursorOn(rows, 'a'), rows, ['a'])).toEqual(EMPTY_CURSOR)
  })

  it('prefers pending rows over non-pending ones when advancing', () => {
    const rows = [pending('a'), done('b'), pending('c')]
    const next = advanceCursorAfterDispose(cursorOn(rows, 'a'), rows, ['a'])
    expect(next.cursorId).toBe('c')
  })

  it('falls back to the nearest surviving row when no pending rows remain', () => {
    const rows = [done('a'), pending('b'), done('c')]
    const next = advanceCursorAfterDispose(cursorOn(rows, 'b'), rows, ['b'])
    expect(next.cursorId).toBe('c')
    expect(next.cursorIndex).toBe(1)
  })

  it('keeps the cursor when its row survived the dispose', () => {
    const rows = [pending('a'), pending('b'), pending('c')]
    const next = advanceCursorAfterDispose(cursorOn(rows, 'c'), rows, ['a'])
    expect(next).toEqual({ cursorId: 'c', cursorIndex: 1 })
  })
})

describe('intersectSelection', () => {
  it('drops ids that are no longer pending after a live refresh', () => {
    const prev = new Set(['a', 'b', 'c'])
    const next = intersectSelection(prev, ['a', 'c', 'd'])
    expect([...next].sort((left, right) => left.localeCompare(right))).toEqual(['a', 'c'])
  })

  it('returns the same reference when every selected id survived', () => {
    const prev = new Set(['a', 'b'])
    expect(intersectSelection(prev, ['a', 'b', 'c'])).toBe(prev)
  })

  it('returns the same reference for an empty selection', () => {
    const prev = new Set<string>()
    expect(intersectSelection(prev, ['a'])).toBe(prev)
  })

  it('empties the selection when a disposed row was the only one selected', () => {
    const prev = new Set(['b'])
    const next = intersectSelection(prev, ['a', 'c'])
    expect(next.size).toBe(0)
  })
})
