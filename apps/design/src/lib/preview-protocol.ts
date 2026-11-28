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
const ANCHORED_OVERLAY_SELECTOR = '[data-radix-popper-content-wrapper]'

export type OverlayMeasure = {
  top: number
  height: number
  scrollHeight: number
  anchored: boolean
}

export function overlayRequiredHeight(overlay: OverlayMeasure, viewportHeight: number): number {
  const contentHeight = Math.max(overlay.height, overlay.scrollHeight)
  if (overlay.anchored) return overlay.top + contentHeight + OVERLAY_GAP
  const clipped = overlay.scrollHeight > overlay.height + 1
  if (!clipped && viewportHeight > 0 && Math.abs(overlay.height - viewportHeight) <= 1) return 0
  return contentHeight + OVERLAY_GAP * 2
}

export function previewContentHeight(content: Element, doc: Document): number {
  let height = content.getBoundingClientRect().height
  const viewportHeight = doc.defaultView?.innerHeight ?? 0
  doc.querySelectorAll<HTMLElement>(PREVIEW_OVERLAY_SELECTOR).forEach((overlay) => {
    const rect = overlay.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    const anchored = overlay.matches(ANCHORED_OVERLAY_SELECTOR) || overlay.closest(ANCHORED_OVERLAY_SELECTOR) !== null || !overlay.matches('[role="dialog"], [role="alertdialog"]')
    height = Math.max(height, overlayRequiredHeight({ top: rect.top, height: rect.height, scrollHeight: overlay.scrollHeight, anchored }, viewportHeight))
  })
  return height
}
