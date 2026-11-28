import type { KanbanColumn } from '../../contracts/kanban'
import {
  KANBAN_CARD_DROPPABLE_PREFIX,
  KANBAN_COLUMN_DROPPABLE_PREFIX,
  applyMove,
  applyPendingMoves,
  computeToIndex,
  findCardLocation,
  isNoopMove,
  resolveDropTarget,
} from '../board-state'

const columns: KanbanColumn[] = [
  { id: 'todo', title: 'To do', count: 10, cards: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
  { id: 'doing', title: 'Doing', count: 1, cards: [{ id: 'd' }] },
  { id: 'done', title: 'Done', cards: [] },
]

function ids(board: KanbanColumn[], columnId: string): string[] {
  return board.find((column) => column.id === columnId)?.cards.map((card) => card.id) ?? []
}

describe('kanban board state', () => {
  it('finds a card location', () => {
    expect(findCardLocation(columns, 'b')).toEqual({ columnId: 'todo', index: 1 })
    expect(findCardLocation(columns, 'missing')).toBeNull()
  })

  it('moves a card to the top of another column and adjusts server counts', () => {
    const next = applyMove(columns, 'b', 'doing', 0)
    expect(ids(next, 'todo')).toEqual(['a', 'c'])
    expect(ids(next, 'doing')).toEqual(['b', 'd'])
    expect(next[0].count).toBe(9)
    expect(next[1].count).toBe(2)
    expect(next[2].count).toBeUndefined()
  })

  it('clamps the target index and leaves unknown moves untouched', () => {
    expect(ids(applyMove(columns, 'a', 'doing', 99), 'doing')).toEqual(['d', 'a'])
    expect(ids(applyMove(columns, 'a', 'doing', -3), 'doing')).toEqual(['a', 'd'])
    expect(applyMove(columns, 'missing', 'doing', 0)).toBe(columns)
    expect(applyMove(columns, 'a', 'nowhere', 0)).toBe(columns)
  })

  it('reorders inside one column without changing the count', () => {
    const next = applyMove(columns, 'a', 'todo', 2)
    expect(ids(next, 'todo')).toEqual(['b', 'c', 'a'])
    expect(next[0].count).toBe(10)
  })

  it('does not mutate the input', () => {
    applyMove(columns, 'a', 'done', 0)
    expect(ids(columns, 'todo')).toEqual(['a', 'b', 'c'])
    expect(ids(columns, 'done')).toEqual([])
  })

  it('applies pending moves in order', () => {
    const next = applyPendingMoves(columns, [
      { cardId: 'a', toColumnId: 'done', toIndex: 0 },
      { cardId: 'd', toColumnId: 'done', toIndex: 0 },
    ])
    expect(ids(next, 'done')).toEqual(['d', 'a'])
    expect(ids(next, 'doing')).toEqual([])
  })

  it('computes the insertion index relative to the cards without the dragged one', () => {
    const cards = columns[0].cards
    expect(computeToIndex(cards, 'x', 'b', false)).toBe(1)
    expect(computeToIndex(cards, 'x', 'b', true)).toBe(2)
    expect(computeToIndex(cards, 'a', 'c', true)).toBe(2)
    expect(computeToIndex(cards, 'a', 'c', false)).toBe(1)
    expect(computeToIndex(cards, 'x', null, false)).toBe(3)
    expect(computeToIndex(cards, 'a', null, false)).toBe(2)
    expect(computeToIndex(cards, 'b', 'b', true)).toBe(1)
    expect(computeToIndex(cards, 'x', 'missing', false)).toBe(3)
  })

  it('detects no-op moves', () => {
    expect(isNoopMove(columns, 'a', 'todo', 0, false)).toBe(true)
    expect(isNoopMove(columns, 'a', 'todo', 2, false)).toBe(true)
    expect(isNoopMove(columns, 'a', 'todo', 0, true)).toBe(true)
    expect(isNoopMove(columns, 'a', 'todo', 2, true)).toBe(false)
    expect(isNoopMove(columns, 'a', 'doing', 0, false)).toBe(false)
    expect(isNoopMove(columns, 'missing', 'doing', 0, false)).toBe(true)
  })

  it('resolves drop targets from droppable ids', () => {
    expect(resolveDropTarget(columns, `${KANBAN_COLUMN_DROPPABLE_PREFIX}done`)).toEqual({ columnId: 'done', overCardId: null })
    expect(resolveDropTarget(columns, `${KANBAN_CARD_DROPPABLE_PREFIX}d`)).toEqual({ columnId: 'doing', overCardId: 'd' })
    expect(resolveDropTarget(columns, `${KANBAN_COLUMN_DROPPABLE_PREFIX}nowhere`)).toBeNull()
    expect(resolveDropTarget(columns, `${KANBAN_CARD_DROPPABLE_PREFIX}missing`)).toBeNull()
    expect(resolveDropTarget(columns, 'a')).toBeNull()
    expect(resolveDropTarget(columns, null)).toBeNull()
  })

  it('simulates a pointer drop: resolve target, compute index, apply', () => {
    const target = resolveDropTarget(columns, `${KANBAN_CARD_DROPPABLE_PREFIX}d`)
    if (!target) throw new Error('[internal] expected target')
    const toIndex = computeToIndex(columns[1].cards, 'b', target.overCardId, true)
    expect(isNoopMove(columns, 'b', target.columnId, toIndex, true)).toBe(false)
    expect(ids(applyMove(columns, 'b', target.columnId, toIndex), 'doing')).toEqual(['d', 'b'])
  })
})
