import { previewHref, type PreviewMode } from './links'

export const STATE_WIDTHS = [390, 768, 1024, 1440] as const
export type StateWidth = (typeof STATE_WIDTHS)[number]

export const NARROW_STATE_WIDTHS: readonly StateWidth[] = [390, 1440]
export const WIDE_SCREEN_QUERY = '(min-width: 1280px)'

export const FRAME_INITIAL_HEIGHT = 480
export const FRAME_MIN_HEIGHT = 120
export const FRAME_MAX_HEIGHT = 2400
export const COLUMN_GAP = 16
export const COLUMN_MIN_WIDTH = 120
export const FRAME_BORDER = 1
export const STACK_BELOW_WIDTH = 560

export type StateCell = {
  width: StateWidth
  href: string
}

export type StateRow = {
  variantId: string
  title: string
  cells: StateCell[]
}

export function defaultStateWidths(wideScreen: boolean): StateWidth[] {
  return wideScreen ? [...STATE_WIDTHS] : [...NARROW_STATE_WIDTHS]
}

export function toggleStateWidth(selected: readonly StateWidth[], width: StateWidth): StateWidth[] {
  if (!selected.includes(width)) return STATE_WIDTHS.filter((candidate) => candidate === width || selected.includes(candidate))
  if (selected.length === 1) return [...selected]
  return selected.filter((candidate) => candidate !== width)
}

export function buildStateRows(
  entryId: string,
  variants: ReadonlyArray<{ id: string; title: string }>,
  widths: readonly StateWidth[],
  mode: PreviewMode,
): StateRow[] {
  return variants.map((variant) => ({
    variantId: variant.id,
    title: variant.title,
    cells: widths.map((width) => ({ width, href: previewHref(entryId, variant.id, mode) })),
  }))
}

export function columnWidths(
  available: number,
  widths: readonly number[],
  gap: number = COLUMN_GAP,
  minimum: number = COLUMN_MIN_WIDTH,
): number[] {
  if (widths.length === 0) return []
  const space = Math.max(0, available - gap * (widths.length - 1))
  const weights = widths.map((width) => Math.sqrt(width))
  const result = widths.map(() => 0)
  let open = Array.from(widths.keys())
  let remaining = space
  while (open.length > 0) {
    const weightSum = open.reduce((sum, index) => sum + weights[index], 0)
    const pinned = open.filter((index) => {
      const share = remaining * (weights[index] / weightSum)
      return share < minimum || share > widths[index]
    })
    if (pinned.length === 0) {
      open.forEach((index) => {
        result[index] = Math.floor(remaining * (weights[index] / weightSum))
      })
      break
    }
    const first = pinned[0]
    const share = remaining * (weights[first] / weightSum)
    result[first] = share < minimum ? Math.min(minimum, widths[first]) : widths[first]
    remaining = Math.max(0, remaining - result[first])
    open = open.filter((index) => index !== first)
  }
  return result
}

export type MatrixLayout = {
  stacked: boolean
  columns: number[]
}

export function matrixLayout(available: number, widths: readonly number[]): MatrixLayout {
  if (available < STACK_BELOW_WIDTH) {
    return { stacked: true, columns: widths.map((width) => Math.max(0, Math.min(available, width))) }
  }
  return { stacked: false, columns: columnWidths(available, widths) }
}

export function frameScale(columnWidth: number, viewportWidth: number, border: number = FRAME_BORDER): number {
  if (viewportWidth <= 0) return 1
  const inner = Math.max(0, columnWidth - border * 2)
  return Math.min(1, inner / viewportWidth)
}

export function clampFrameHeight(reported: number): number {
  if (!Number.isFinite(reported)) return FRAME_MIN_HEIGHT
  return Math.min(FRAME_MAX_HEIGHT, Math.max(FRAME_MIN_HEIGHT, Math.ceil(reported)))
}

export function scaledFrameHeight(height: number, scale: number, border: number = FRAME_BORDER): number {
  return Math.ceil(height * scale) + border * 2
}
