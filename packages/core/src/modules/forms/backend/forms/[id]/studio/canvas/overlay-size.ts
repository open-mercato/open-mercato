// Phase 4 — pure helper that returns the pixel width the DragOverlay should
// render at so what's being dragged matches the target cell's footprint.
import { GAP_PX } from './resize-math'

export function computeOverlayWidthPx(input: {
  sectionWidthPx: number
  columns: 1 | 2 | 3 | 4
  span: 1 | 2 | 3 | 4
  gap: 'sm' | 'md' | 'lg'
}): number {
  const gapPx = GAP_PX[input.gap]
  const colWidth = (input.sectionWidthPx - (input.columns - 1) * gapPx) / input.columns
  const clampedSpan = Math.max(1, Math.min(input.span, input.columns))
  return clampedSpan * colWidth + (clampedSpan - 1) * gapPx
}
