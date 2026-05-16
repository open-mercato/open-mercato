// Phase 7 — grid-aware keyboard coordinate getter.
//
// `@dnd-kit/sortable`'s `sortableKeyboardCoordinates` only steps along the
// linear sortable list; in a multi-column section grid, arrow keys cannot
// traverse columns. This module wraps the default getter with a pure
// "compute next coordinates" helper for the grid case and a DOM-aware
// `KeyboardCoordinateGetter` that detects the active draggable's parent
// section (via `data-section-key`) and decides whether to apply grid math
// or fall back to the default sortable behaviour.
//
// The pure `nextGridCoordinates` helper is exported separately so unit
// tests can pin direction → delta mapping without DOM scaffolding.

import { KeyboardCode, type KeyboardCoordinateGetter } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { FIELD_DRAGGABLE_PREFIX } from './FieldRow'

export type GridDirection = 'up' | 'down' | 'left' | 'right'

const ARROW_TO_DIRECTION: Record<string, GridDirection> = {
  [KeyboardCode.Up]: 'up',
  [KeyboardCode.Down]: 'down',
  [KeyboardCode.Left]: 'left',
  [KeyboardCode.Right]: 'right',
}

export function nextGridCoordinates(input: {
  current: { x: number; y: number }
  direction: GridDirection
  rowHeight: number
  colWidth: number
  gapPx: number
}): { x: number; y: number } {
  const { current, direction, rowHeight, colWidth, gapPx } = input
  const safeRow = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 0
  const safeCol = Number.isFinite(colWidth) && colWidth > 0 ? colWidth : 0
  const safeGap = Number.isFinite(gapPx) && gapPx >= 0 ? gapPx : 0
  const xStep = safeCol + safeGap
  const yStep = safeRow + safeGap
  switch (direction) {
    case 'up':
      return { x: current.x, y: current.y - yStep }
    case 'down':
      return { x: current.x, y: current.y + yStep }
    case 'left':
      return { x: current.x - xStep, y: current.y }
    case 'right':
      return { x: current.x + xStep, y: current.y }
    default:
      return current
  }
}

function findSectionElement(activeId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  if (!activeId.startsWith(FIELD_DRAGGABLE_PREFIX)) return null
  const fieldKey = activeId.slice(FIELD_DRAGGABLE_PREFIX.length)
  if (!fieldKey) return null
  const fieldNode = document.querySelector<HTMLElement>(`[data-field-key="${CSS.escape(fieldKey)}"]`)
  if (!fieldNode) return null
  return fieldNode.closest<HTMLElement>('[data-section-key]')
}

function readSectionColumns(section: HTMLElement): number {
  // The grid wrapper is the section's first descendant with `display: grid`.
  // We rely on `gridTemplateColumns` because Tailwind's responsive classes
  // resolve to a concrete CSS value at runtime.
  const grids = section.querySelectorAll<HTMLElement>(':scope div')
  for (const node of Array.from(grids)) {
    const style = typeof window !== 'undefined' ? window.getComputedStyle(node) : null
    if (!style) continue
    if (style.display !== 'grid') continue
    const template = style.gridTemplateColumns
    if (!template || template === 'none') continue
    return template.split(' ').filter(Boolean).length
  }
  return 1
}

function readGridGap(section: HTMLElement): number {
  const grids = section.querySelectorAll<HTMLElement>(':scope div')
  for (const node of Array.from(grids)) {
    const style = typeof window !== 'undefined' ? window.getComputedStyle(node) : null
    if (!style) continue
    if (style.display !== 'grid') continue
    const raw = style.columnGap || style.gap || '0'
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/**
 * KeyboardCoordinateGetter that adds left/right column traversal for
 * field draggables sitting inside multi-column section grids. Falls back
 * to the standard sortable coordinate getter for sections, ungrouped
 * fields, and single-column sections so existing keyboard behaviour
 * stays identical.
 */
export const gridKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const direction = ARROW_TO_DIRECTION[event.code]
  if (!direction) return sortableKeyboardCoordinates(event, args)

  const activeId = String(args.active)
  const section = findSectionElement(activeId)
  if (!section) return sortableKeyboardCoordinates(event, args)

  const columns = readSectionColumns(section)
  if (columns <= 1) return sortableKeyboardCoordinates(event, args)

  const sectionRect = section.getBoundingClientRect()
  if (!sectionRect || sectionRect.width <= 0) return sortableKeyboardCoordinates(event, args)

  const gapPx = readGridGap(section)
  const colWidth = (sectionRect.width - gapPx * (columns - 1)) / columns
  const collisionRect = args.context.collisionRect
  const rowHeight = collisionRect?.height ?? sectionRect.height / Math.max(1, columns)

  const current = args.currentCoordinates
  event.preventDefault()
  return nextGridCoordinates({
    current,
    direction,
    rowHeight,
    colWidth,
    gapPx,
  })
}
