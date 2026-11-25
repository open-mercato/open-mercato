import type { KanbanCard, KanbanColumn } from '../contracts/kanban'

export type KanbanCardLocation = { columnId: string; index: number }

export type KanbanPendingMove = { cardId: string; toColumnId: string; toIndex: number; settled?: boolean }

export const KANBAN_COLUMN_DROPPABLE_PREFIX = 'kanban-column:'
export const KANBAN_CARD_DROPPABLE_PREFIX = 'kanban-card:'

export function findCardLocation(columns: KanbanColumn[], cardId: string): KanbanCardLocation | null {
  for (const column of columns) {
    const index = column.cards.findIndex((card) => card.id === cardId)
    if (index >= 0) return { columnId: column.id, index }
  }
  return null
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length
  return Math.min(Math.max(Math.trunc(index), 0), length)
}

function adjustCount(count: number | undefined, delta: number): number | undefined {
  if (count === undefined) return undefined
  return Math.max(0, count + delta)
}

export function applyMove(
  columns: KanbanColumn[],
  cardId: string,
  toColumnId: string,
  toIndex: number,
): KanbanColumn[] {
  const source = findCardLocation(columns, cardId)
  if (!source) return columns
  if (!columns.some((column) => column.id === toColumnId)) return columns
  const card = columns.find((column) => column.id === source.columnId)?.cards[source.index] as KanbanCard
  const changesColumn = source.columnId !== toColumnId
  return columns.map((column) => {
    const isSource = column.id === source.columnId
    const isTarget = column.id === toColumnId
    if (!isSource && !isTarget) return column
    const rest = column.cards.filter((entry) => entry.id !== cardId)
    if (!isTarget) return { ...column, cards: rest, count: adjustCount(column.count, -1) }
    const cards = [...rest]
    cards.splice(clampIndex(toIndex, rest.length), 0, card)
    return { ...column, cards, count: changesColumn ? adjustCount(column.count, 1) : column.count }
  })
}

export function applyPendingMoves(columns: KanbanColumn[], moves: KanbanPendingMove[]): KanbanColumn[] {
  return moves.reduce((current, move) => applyMove(current, move.cardId, move.toColumnId, move.toIndex), columns)
}

export function computeToIndex(
  cards: KanbanCard[],
  activeCardId: string,
  overCardId: string | null,
  placeAfter: boolean,
): number {
  if (overCardId === activeCardId) {
    const own = cards.findIndex((card) => card.id === activeCardId)
    if (own >= 0) return own
  }
  const rest = cards.filter((card) => card.id !== activeCardId)
  if (overCardId === null) return rest.length
  const index = rest.findIndex((card) => card.id === overCardId)
  if (index < 0) return rest.length
  return placeAfter ? index + 1 : index
}

export function isNoopMove(
  columns: KanbanColumn[],
  cardId: string,
  toColumnId: string,
  toIndex: number,
  reorderable: boolean,
): boolean {
  const source = findCardLocation(columns, cardId)
  if (!source) return true
  if (source.columnId !== toColumnId) return false
  if (!reorderable) return true
  return source.index === toIndex
}

export type KanbanDropTarget = { columnId: string; overCardId: string | null }

export function resolveDropTarget(columns: KanbanColumn[], overId: string | null | undefined): KanbanDropTarget | null {
  if (typeof overId !== 'string') return null
  if (overId.startsWith(KANBAN_COLUMN_DROPPABLE_PREFIX)) {
    const columnId = overId.slice(KANBAN_COLUMN_DROPPABLE_PREFIX.length)
    return columns.some((column) => column.id === columnId) ? { columnId, overCardId: null } : null
  }
  if (overId.startsWith(KANBAN_CARD_DROPPABLE_PREFIX)) {
    const cardId = overId.slice(KANBAN_CARD_DROPPABLE_PREFIX.length)
    const location = findCardLocation(columns, cardId)
    return location ? { columnId: location.columnId, overCardId: cardId } : null
  }
  return null
}
