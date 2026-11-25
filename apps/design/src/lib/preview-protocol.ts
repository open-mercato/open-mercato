export const PREVIEW_HEIGHT_MESSAGE = 'om-design-preview-height'

export type PreviewHeightMessage = {
  type: typeof PREVIEW_HEIGHT_MESSAGE
  height: number
}

export function isPreviewHeightMessage(value: unknown): value is PreviewHeightMessage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.type === PREVIEW_HEIGHT_MESSAGE && typeof candidate.height === 'number' && Number.isFinite(candidate.height)
}

export function clampWidth(width: number, min: number, max: number): number {
  if (max <= min) return Math.max(0, Math.floor(max))
  return Math.round(Math.min(Math.max(width, min), max))
}

export const PREVIEW_OVERLAY_SELECTOR =
  '[data-radix-popper-content-wrapper], [data-radix-select-viewport], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]'

const OVERLAY_GAP = 16

export function previewContentHeight(content: Element, doc: Document): number {
  let height = content.getBoundingClientRect().height
  doc.querySelectorAll<HTMLElement>(PREVIEW_OVERLAY_SELECTOR).forEach((overlay) => {
    const rect = overlay.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    height = Math.max(height, rect.top + Math.max(rect.height, overlay.scrollHeight) + OVERLAY_GAP)
  })
  return height
}
