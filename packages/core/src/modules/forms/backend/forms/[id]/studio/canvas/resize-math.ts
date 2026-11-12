import type { RowLayoutSpan } from './row-layout'

export const GAP_PX: Record<'sm' | 'md' | 'lg', number> = {
  sm: 8,
  md: 16,
  lg: 24,
}

export type ResizedSpanInput = {
  sectionLeft: number
  sectionWidth: number
  fieldLeft: number
  pointerClientX: number
  columns: 1 | 2 | 3 | 4
  startSpan: 1 | 2 | 3 | 4
  gapPx: number
}

function clampSpan(value: number, lo: number, hi: number): RowLayoutSpan {
  const bounded = Math.max(lo, Math.min(hi, value))
  return (bounded < 1 ? 1 : bounded > 4 ? 4 : bounded) as RowLayoutSpan
}

export function computeResizedSpan(input: ResizedSpanInput): RowLayoutSpan {
  const { sectionLeft, sectionWidth, fieldLeft, pointerClientX, columns, startSpan, gapPx } = input
  if (columns <= 1) return 1
  const safeWidth = sectionWidth > 0 ? sectionWidth : 0
  const colWidth = (safeWidth - (columns - 1) * gapPx) / columns
  if (!Number.isFinite(colWidth) || colWidth <= 0) return startSpan
  const startColIndexRaw = Math.round((fieldLeft - sectionLeft) / (colWidth + gapPx))
  const startColIndex = Math.max(0, Math.min(columns - 1, startColIndexRaw))
  const maxSpan = Math.max(1, columns - startColIndex)
  const pointerDelta = pointerClientX - fieldLeft
  const rawSpan = Math.ceil(pointerDelta / (colWidth + gapPx))
  return clampSpan(rawSpan, 1, maxSpan)
}
