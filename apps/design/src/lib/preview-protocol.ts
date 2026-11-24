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
