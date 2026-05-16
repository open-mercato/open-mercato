'use client'

import { useDroppable } from '@dnd-kit/core'

export const SECTION_DROP_PREFIX = 'section-drop:'

export function sectionDropId(sectionKey: string, columnIndex: number | null = null): string {
  return `${SECTION_DROP_PREFIX}${sectionKey}${columnIndex === null ? '' : `:${columnIndex}`}`
}

export function sectionCellDropId(sectionKey: string, rowIndex: number, columnIndex: number): string {
  return `${SECTION_DROP_PREFIX}${sectionKey}:row:${rowIndex}:col:${columnIndex}`
}

export function sectionColGapDropId(sectionKey: string, rowIndex: number, columnIndex: number): string {
  return `${SECTION_DROP_PREFIX}${sectionKey}:row:${rowIndex}:gap:${columnIndex}`
}

export function sectionRowGapDropId(sectionKey: string, rowIndex: number): string {
  return `${SECTION_DROP_PREFIX}${sectionKey}:row-gap:${rowIndex}`
}

export type ParsedSectionDrop =
  | { kind: 'legacy'; sectionKey: string; columnIndex: number | null }
  | { kind: 'cell'; sectionKey: string; rowIndex: number; columnIndex: number }
  | { kind: 'col-gap'; sectionKey: string; rowIndex: number; columnIndex: number }
  | { kind: 'row-gap'; sectionKey: string; rowIndex: number }

function parseIntStrict(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseSectionDropId(id: string): ParsedSectionDrop | null {
  if (!id.startsWith(SECTION_DROP_PREFIX)) return null
  const raw = id.slice(SECTION_DROP_PREFIX.length)
  if (!raw) return null
  const parts = raw.split(':')
  const sectionKey = parts[0]
  if (!sectionKey) return null

  if (parts.length === 1) {
    return { kind: 'legacy', sectionKey, columnIndex: null }
  }

  if (parts[1] === 'row-gap') {
    const rowIndex = parseIntStrict(parts[2])
    if (rowIndex === null) return null
    return { kind: 'row-gap', sectionKey, rowIndex }
  }

  if (parts[1] === 'row' && parts.length === 5) {
    const rowIndex = parseIntStrict(parts[2])
    const tag = parts[3]
    const columnIndex = parseIntStrict(parts[4])
    if (rowIndex === null || columnIndex === null) return null
    if (tag === 'col') {
      return { kind: 'cell', sectionKey, rowIndex, columnIndex }
    }
    if (tag === 'gap') {
      return { kind: 'col-gap', sectionKey, rowIndex, columnIndex }
    }
    return null
  }

  if (parts.length === 2) {
    const columnIndex = parseIntStrict(parts[1])
    return { kind: 'legacy', sectionKey, columnIndex: columnIndex === null ? null : columnIndex }
  }

  return null
}

export function GridSlot({
  sectionKey,
  columnIndex = null,
  isEmpty = false,
  copy,
}: {
  sectionKey: string
  columnIndex?: number | null
  isEmpty?: boolean
  copy: string
}) {
  const { isOver, setNodeRef } = useDroppable({ id: sectionDropId(sectionKey, columnIndex) })
  return (
    <div
      ref={setNodeRef}
      className={[
        'rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground transition-colors',
        isEmpty ? 'min-h-20' : 'min-h-10',
        isOver ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary/30' : 'border-border bg-muted/20',
      ].join(' ')}
    >
      {copy}
    </div>
  )
}

export function SectionCellSlot({
  sectionKey,
  rowIndex,
  columnIndex,
  copy,
}: {
  sectionKey: string
  rowIndex: number
  columnIndex: number
  copy: string
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: sectionCellDropId(sectionKey, rowIndex, columnIndex),
  })
  return (
    <div
      ref={setNodeRef}
      data-cell-row={rowIndex}
      data-cell-col={columnIndex}
      className={[
        'rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground transition-colors min-h-10',
        isOver ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary/30' : 'border-border bg-muted/20',
      ].join(' ')}
    >
      {copy}
    </div>
  )
}

export function SectionColGapDrop({
  sectionKey,
  rowIndex,
  columnIndex,
  edge,
}: {
  sectionKey: string
  rowIndex: number
  columnIndex: number
  edge: 'left' | 'right'
}) {
  const { setNodeRef } = useDroppable({
    id: sectionColGapDropId(sectionKey, rowIndex, columnIndex),
  })
  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      data-col-gap-row={rowIndex}
      data-col-gap-col={columnIndex}
      className={[
        'pointer-events-none absolute top-0 bottom-0 w-2',
        edge === 'left' ? '-left-1' : '-right-1',
      ].join(' ')}
    />
  )
}

export function SectionRowGapDrop({
  sectionKey,
  rowIndex,
}: {
  sectionKey: string
  rowIndex: number
}) {
  const { setNodeRef } = useDroppable({
    id: sectionRowGapDropId(sectionKey, rowIndex),
  })
  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      data-row-gap={rowIndex}
      className="pointer-events-none col-span-full h-0"
    />
  )
}
